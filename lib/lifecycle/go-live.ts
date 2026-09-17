import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, muns, munSubmissions, munVersions, verificationIssues } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { notifyPipelineEvent } from '@/lib/notifications/pipeline-events'
import { buildPublicMunUrl, resolveAdminEmails, resolveMunNotificationContext } from '@/lib/notifications/resolve-recipients'
import { addBusinessDays, computeSlaState, DEFAULT_BUSINESS_CALENDAR, type SlaState } from './sla'
import { validateMunForSubmission, type ValidationCheck } from './validation'
import { transitionMun } from './mun-state-machine'
import { recomputeMunProgress } from './module-completion'
import { buildSnapshot } from './organizer-confirmation'

// Same Drizzle transaction-callback param type used across lib/lifecycle —
// kept as a local alias rather than an import so this module doesn't take on
// an extra dependency just for a type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// -----------------------------------------------------------------------------
// go-live.ts — Submission gate, review decisions, go-live queue, and the
// idempotent/concurrency-safe publish action (design doc Section 4.1 and
// Section 5.2/5.3, PRD §24/§31-33).
// -----------------------------------------------------------------------------
//
// `submitMunForReview` is the organizer-facing entry point that runs the
// Task 9 automated validation engine and, on success, opens the
// `mun_submissions` SLA clock. See the design doc's Section 4.1 for the
// exact numbered sequence this function implements — the step numbers in the
// comments below correspond to that section.
//
// `reviewSubmission`, `enqueueForGoLive`, `getGoLiveQueue`, and
// `publishFromQueue` (Task 11) pick up from there: Gate 2's content-review
// decision, the admin go-live queue, and the single most consequential write
// path in the whole plan — the concurrency-safe, idempotent publish. See
// design doc Section 5.3 for the exact 8-step publish sequence.
//
// NOTIFICATION WIRING (Task 12 Step 5): every `notifyPipelineEvent(...)` call
// in this file happens AFTER its triggering `db.transaction(...)` has
// already returned/committed — never inside it. A notification failure must
// never roll back a state change. `notifyPipelineEvent` itself already never
// throws on delivery failure (it catches per-recipient), but the
// `resolveAdminEmails`/`resolveMunNotificationContext` calls DO hit the DB
// and could theoretically fail (e.g. a dropped connection right after the
// triggering transaction committed) — those are wrapped in their own
// try/catch, logged, and swallowed, so a notification-resolution failure can
// never surface as an error from the caller's perspective on an
// already-successful state change.
// -----------------------------------------------------------------------------

// Statuses a mun can realistically be submitted from. READY_FOR_SUBMISSION
// and ONBOARDING are the two "not yet submitted" progress states (spec
// Section 1.5); ACTION_REQUIRED is the automated-validation-failure loop
// this same function creates; CONTENT_SUBMITTED covers a resubmission that
// crashed after step 2 but before step 3 committed (recovery path — see
// ALLOWED_TRANSITIONS's CONTENT_SUBMITTED -> ACTION_REQUIRED edge).
const SUBMITTABLE_STATUSES = ['ONBOARDING', 'ACTION_REQUIRED', 'READY_FOR_SUBMISSION', 'CONTENT_SUBMITTED'] as const

// Terminal submission statuses — mirrors the partial-unique-index predicate
// on mun_submissions (schema.ts: mun_submissions_active_per_mun_uq) exactly.
// Kept as a separate raw-SQL predicate (rather than `inArray`/`notInArray`)
// so the two stay trivially comparable side by side; if one changes without
// the other, that's a bug to catch in review, not silently drift apart.
const ACTIVE_SUBMISSION_PREDICATE = sql`${munSubmissions.status} NOT IN ('PUBLISHED','REJECTED','WITHDRAWN')`

export interface SubmitMunForReviewResult {
  passed: boolean
  blockers: ValidationCheck[]
  submissionId?: string
  /** True when this passing submission followed an earlier ACTION_REQUIRED loop (drives NEW_SUBMISSION vs RESUBMISSION). Undefined on the failed-validation path. */
  isResubmission?: boolean
}

/**
 * Fire-and-forget notification helper shared by every call site in this
 * file. Wraps the recipient-resolution + `notifyPipelineEvent` call in its
 * own try/catch and logs (never throws) — see the file header comment for
 * why. Never awaited by the caller in a way that blocks its return value.
 */
function notifyAfterCommit(work: () => Promise<void>): void {
  work().catch((error) => {
    console.error('[go-live] pipeline notification failed', error)
  })
}

/**
 * Organizer submits a mun for MUNHub review (PRD §24). Row-locks the mun,
 * asserts ownership, runs the full 15-module automated validation engine
 * (Task 9), and either:
 *
 *   - FAILS: persists every failing check as a `verification_issues` row
 *     (source: AUTOMATED), transitions the mun to ACTION_REQUIRED, and
 *     COMMITS (the issue rows must survive — this is a valid returned
 *     result, not a thrown error).
 *   - PASSES: transitions the mun to ORGANIZER_CONFIRMATION and opens the
 *     `mun_submissions` SLA clock (one business day out), returning the new
 *     submission id.
 *
 * All of this runs inside ONE `db.transaction`, with the mun row-locked
 * (`for('update')`) as the very first statement — this is what makes the
 * partial-unique-index proof in go-live.test.ts work: two concurrent callers
 * serialize on the mun row lock, and whichever commits its `mun_submissions`
 * insert second collides with `mun_submissions_active_per_mun_uq` and
 * throws a Postgres unique-violation error. The pre-check below only makes
 * the common (non-racing) case throw a friendlier message — it is NOT the
 * primary defense; the DB constraint is.
 *
 * On the PASSES path, fires `SUBMISSION_RECEIVED` to the organizer and
 * `NEW_SUBMISSION` to admins/ops AFTER the transaction commits (Task 12).
 */
export async function submitMunForReview(munId: string, session: Session | null): Promise<SubmitMunForReviewResult> {
  if (!session) throw new Error('Forbidden')

  const result = await db.transaction(async (tx) => {
    // Step 1: row-lock the mun first, then check status + ownership against
    // the LOCKED row — checking ownership before the lock would leave a
    // TOCTOU gap where a concurrent transfer-of-ownership (were one to ever
    // exist) or a second submitMunForReview call could race this check.
    const [mun] = await tx.select().from(muns).where(eq(muns.id, munId)).for('update').limit(1)
    if (!mun) throw new Error('Mun not found')

    if (session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN' && mun.organizerId !== session.userId) {
      throw new Error('Forbidden')
    }

    if (!SUBMITTABLE_STATUSES.includes(mun.status as (typeof SUBMITTABLE_STATUSES)[number])) {
      throw new Error(`Cannot submit mun for review from status ${mun.status}`)
    }

    // Friendly pre-check mirroring the partial unique index's predicate
    // exactly. Not the primary defense (see docstring) — under a real race
    // the mun row lock above already serializes concurrent callers of THIS
    // function against each other, so this mostly guards against a stray
    // active row left by a different code path.
    const [existingActive] = await tx
      .select({ id: munSubmissions.id })
      .from(munSubmissions)
      .where(and(eq(munSubmissions.munId, munId), ACTIVE_SUBMISSION_PREDICATE))
      .limit(1)
    if (existingActive) {
      throw new Error('This mun already has an active submission in review')
    }

    // Step 2: CONTENT_SUBMITTED (audit-logged). ALLOWED_TRANSITIONS only
    // permits CONTENT_SUBMITTED from ONBOARDING or READY_FOR_SUBMISSION —
    // ACTION_REQUIRED has no direct edge to it (mun-state-machine.ts:110).
    // A mun sitting in ACTION_REQUIRED here means a PRIOR submitMunForReview
    // call already failed automated validation and put it there (module-
    // level ACTION_REQUIRED during ordinary onboarding never reaches this
    // function per validateMunForSubmission's own gate) — so hop it through
    // READY_FOR_SUBMISSION first, audit-logged as its own step, rather than
    // widening ALLOWED_TRANSITIONS with an ACTION_REQUIRED -> CONTENT_SUBMITTED
    // edge that would blur the state machine's own documented shape. If the
    // mun is already CONTENT_SUBMITTED (crash-recovery path), skip both hops.
    if (mun.status === 'ACTION_REQUIRED') {
      await transitionMun(munId, 'READY_FOR_SUBMISSION', session.userId, 'Resubmitting for review', undefined, tx)
    }
    if (mun.status !== 'CONTENT_SUBMITTED') {
      await transitionMun(munId, 'CONTENT_SUBMITTED', session.userId, 'Organizer submitted for review', undefined, tx)
    }

    // Step 3: AUTOMATED_VALIDATION (audit-logged — brief, PRD-observable state).
    await transitionMun(munId, 'AUTOMATED_VALIDATION', session.userId, 'Running automated validation', undefined, tx)

    // Step 4: run the Task 9 validation engine (stage defaults to SUBMIT).
    const validationResult = await validateMunForSubmission(munId)

    // Step 5: mark PRIOR unresolved AUTOMATED-source issues resolved BEFORE
    // inserting new ones, so a resubmission doesn't accumulate stale machine
    // issues. REVIEWER-sourced issues are untouched — only a human reviewer
    // clears those.
    await tx
      .update(verificationIssues)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(
        and(
          eq(verificationIssues.munId, munId),
          eq(verificationIssues.source, 'AUTOMATED'),
          eq(verificationIssues.resolved, false),
        ),
      )

    if (validationResult.blockers.length > 0) {
      await tx.insert(verificationIssues).values(
        validationResult.blockers.map((blocker) => ({
          munId,
          moduleName: validationResult.modules.find((m) => m.checks.includes(blocker))?.moduleKey ?? 'FINAL_REVIEW',
          severity: blocker.severity,
          reason: blocker.message ?? blocker.label,
          raisedBy: session.userId,
          code: blocker.key,
          source: 'AUTOMATED',
        })),
      )
    }

    if (!validationResult.passed) {
      // Step 6: FAILURE — transition to ACTION_REQUIRED and COMMIT (not
      // abort). The issue rows above must survive, so this is a normal
      // return, not a thrown error.
      await transitionMun(munId, 'ACTION_REQUIRED', session.userId, 'Automated validation failed', undefined, tx)
      return { passed: false as const, blockers: validationResult.blockers }
    }

    // Step 7: SUCCESS — transition to ORGANIZER_CONFIRMATION and open the
    // mun_submissions SLA clock.
    await transitionMun(munId, 'ORGANIZER_CONFIRMATION', session.userId, 'Automated validation passed', undefined, tx)

    const progress = await recomputeMunProgress(munId, session.userId, tx)

    const [priorSubmission] = await tx
      .select({ versionNumber: munSubmissions.versionNumber })
      .from(munSubmissions)
      .where(eq(munSubmissions.munId, munId))
      .orderBy(desc(munSubmissions.versionNumber))
      .limit(1)

    const nextVersion = (priorSubmission?.versionNumber ?? 0) + 1
    const now = new Date()
    const slaDeadline = addBusinessDays(now, 1, DEFAULT_BUSINESS_CALENDAR)

    const [submission] = await tx
      .insert(munSubmissions)
      .values({
        munId,
        submittedBy: session.userId,
        versionNumber: nextVersion,
        status: 'SUBMITTED',
        progressPercentage: progress.overallPercentage,
        submittedAt: now,
        slaDeadline,
        slaState: 'ON_TRACK',
      })
      .returning()

    // nextVersion > 1 means an earlier mun_submissions row already exists
    // for this mun (a prior pass through this same function reached
    // SUBMITTED at least once) — the signal this is a resubmission after
    // changes, not a first-time submission. Computed here, inside the
    // transaction, rather than re-deriving it from the pre-lock `mun.status`
    // read above so it can't drift from what actually got persisted.
    return { passed: true as const, blockers: [], submissionId: submission.id, isResubmission: nextVersion > 1 }
  })

  // Outside the transaction, after commit (Task 12 Step 5). Only on the
  // PASSES path — a failed submission stays in ACTION_REQUIRED, which is
  // covered by the existing progress-engine MODULE_ACTION_REQUIRED path
  // elsewhere, not a SUBMISSION_RECEIVED/NEW_SUBMISSION event here.
  if (result.passed) {
    notifyAfterCommit(async () => {
      const context = await resolveMunNotificationContext(munId)
      await notifyPipelineEvent({
        type: 'SUBMISSION_RECEIVED',
        munId,
        organizerEmail: context.organizerEmail,
        munName: context.munName,
      })
      const adminEmails = await resolveAdminEmails()
      // NEW_SUBMISSION and RESUBMISSION are mutually exclusive per the
      // PipelineEvent union's own copy ("has been submitted" vs "has been
      // resubmitted after changes") — never fire both for the same call.
      await notifyPipelineEvent(
        result.isResubmission
          ? { type: 'RESUBMISSION', munId, munName: context.munName, adminEmails }
          : { type: 'NEW_SUBMISSION', munId, munName: context.munName, adminEmails },
      )
    })
  }

  return result
}

// -----------------------------------------------------------------------------
// Task 11 — review decisions, go-live queue, idempotent publish.
// -----------------------------------------------------------------------------

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const
const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

/** Loads the mun's one active (non-terminal) mun_submissions row, row-locked. */
async function lockActiveSubmission(tx: Tx, munId: string) {
  const [submission] = await tx
    .select()
    .from(munSubmissions)
    .where(and(eq(munSubmissions.munId, munId), ACTIVE_SUBMISSION_PREDICATE))
    .for('update')
    .limit(1)
  return submission
}

/**
 * Loads the mun's most recent `mun_submissions` row, row-locked, with NO
 * status filter — used only by `publishFromQueue`. Unlike
 * `lockActiveSubmission` (used by `reviewSubmission`/`enqueueForGoLive`,
 * which only ever act on a still-active submission), `publishFromQueue`
 * MUST be able to find the submission even after a prior call already
 * marked it PUBLISHED — that is exactly the row an idempotent replay needs
 * to look up. Filtering this lookup by `ACTIVE_SUBMISSION_PREDICATE` would
 * make every replay after the first successful publish throw "No active
 * submission found" instead of returning the existing result, defeating
 * step 2 of the publish sequence entirely.
 */
async function lockLatestSubmission(tx: Tx, munId: string) {
  const [submission] = await tx
    .select()
    .from(munSubmissions)
    .where(eq(munSubmissions.munId, munId))
    .orderBy(desc(munSubmissions.versionNumber))
    .for('update')
    .limit(1)
  return submission
}

export type ReviewSubmissionDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'

export interface ReviewSubmissionOptions {
  notes?: string
  reason?: string
  issues?: { severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }[]
}

/**
 * Gate 2 content-review decision (design doc Section 5, PRD §31-32) —
 * OPERATIONS/ADMIN/SUPER_ADMIN only. **Never route this through
 * `reviewMunApplication`** (lib/actions/admin-review.ts) — that is Gate 1
 * (organizer-application approval, a completely different table and a
 * completely different point in the mun lifecycle). Mixing the two gates up
 * is exactly the collision the Gate-1/Gate-2 separation in this design
 * exists to prevent — see mun-state-machine.ts's header comment.
 *
 * Row-locks the **`mun_submissions` row**, not the mun row — the submission
 * is the entity actually being decided on here, and it is also what
 * `reviewStartedAt`/`reviewerId`/`decidedAt` live on. Re-checks the
 * submission's status under the lock before writing (the same lesson Task 7
 * learned the hard way with `reviewModule`: a lock only serializes the two
 * writes, it does not by itself stop the second caller from blindly
 * clobbering the first caller's already-committed decision unless the
 * precondition is re-checked after acquiring the lock).
 *
 *   - APPROVED: mun -> VERIFIED, submission -> APPROVED, `decidedAt`/
 *     `approvedAt` set. Notification: `APPROVED` to organizer.
 *   - CHANGES_REQUESTED: mun -> ACTION_REQUIRED, submission ->
 *     CHANGES_REQUESTED, SLA paused (`slaPausedAt` + `slaState = PAUSED`),
 *     and any `opts.issues` recorded as `verification_issues` rows
 *     (source: REVIEWER). Notification: `CHANGES_REQUESTED` to organizer —
 *     `moduleName` is `'FINAL_REVIEW'` (this is a mun-level Gate 2 decision,
 *     not a per-module one) and `reason` is `opts.notes`, or a summary of
 *     `opts.issues` if `opts.notes` wasn't given.
 *   - REJECTED: requires a non-empty `opts.reason` (PRD §28) — throws
 *     before the transaction even opens if missing/empty. mun -> REJECTED,
 *     submission -> REJECTED, `rejectionReason` stored, `decidedAt` set.
 *     Notification: the `PipelineEvent` union has no dedicated REJECTED
 *     variant (checked — the 11 organizer + 6 admin events cover
 *     ONBOARDING_STARTED through SLA_DELAY plus the 4 admin-facing ones;
 *     none fit a terminal "your mun was rejected" notice). Of the two
 *     closest shapes, `APPROVED`'s carries no explanation field at all,
 *     which would be actively misleading for a rejection (silently
 *     dropping `opts.reason` on the floor); `CHANGES_REQUESTED`'s shape
 *     does carry a `reason` field the organizer genuinely needs to see, so
 *     this reuses `CHANGES_REQUESTED` for the REJECTED case rather than
 *     `APPROVED` — an imperfect fit (subject line reads "Changes requested"
 *     for what is actually a terminal rejection), but strictly less
 *     misleading than the alternative, and it is the documented, deliberate
 *     choice per Task 12's brief rather than an oversight. A dedicated
 *     REJECTED event is the correct long-term fix and is a natural
 *     candidate for whoever owns the next `PipelineEvent` revision.
 *
 * Writes one `admin_actions` row in the same transaction as the decision:
 * `MUN_APPROVED`, `MUN_CHANGES_REQUESTED`, or `MUN_REJECTED` respectively —
 * all three are dedicated `adminActionEnum` values scoped to this Gate 2
 * mun-level decision (added post-review: an earlier draft of this function
 * reused `MODULE_REVIEWED` for the CHANGES_REQUESTED case, which was wrong
 * — `MODULE_REVIEWED` is reserved for a future *per-module* review audit
 * trail, a different concept, and reusing it here collided with that
 * reservation inside the same commit that introduced it). `targetType`/
 * `targetId` (`mun_submission`/the submission id) keep the audit trail
 * unambiguous regardless.
 */
export async function reviewSubmission(
  munId: string,
  decision: ReviewSubmissionDecision,
  opts: ReviewSubmissionOptions,
  session: Session | null,
): Promise<typeof munSubmissions.$inferSelect> {
  requireRole(session, [...REVIEW_ROLES])

  if (decision === 'REJECTED' && (!opts.reason || opts.reason.trim().length === 0)) {
    throw new Error('A non-empty reason is required to reject a submission')
  }

  const updated = await db.transaction(async (tx) => {
    const submission = await lockActiveSubmission(tx, munId)
    if (!submission) {
      throw new Error('No active submission found for this mun')
    }

    const now = new Date()
    const reviewStartedAt = submission.reviewStartedAt ?? now

    if (opts.issues && opts.issues.length > 0) {
      await tx.insert(verificationIssues).values(
        opts.issues.map((issue) => ({
          munId,
          moduleName: 'FINAL_REVIEW' as const,
          severity: issue.severity,
          reason: issue.reason,
          raisedBy: session.userId,
          source: 'REVIEWER',
        })),
      )
    }

    if (decision === 'APPROVED') {
      await transitionMun(munId, 'VERIFIED', session.userId, opts.notes, undefined, tx)

      const [row] = await tx
        .update(munSubmissions)
        .set({
          status: 'APPROVED',
          reviewStartedAt,
          reviewerId: session.userId,
          decidedAt: now,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(munSubmissions.id, submission.id))
        .returning()

      await recordAdminAction(tx, session.userId, 'MUN_APPROVED', 'mun_submission', submission.id, opts.notes, {
        munId,
      })

      return row
    }

    if (decision === 'CHANGES_REQUESTED') {
      await transitionMun(munId, 'ACTION_REQUIRED', session.userId, opts.notes, undefined, tx)

      const [row] = await tx
        .update(munSubmissions)
        .set({
          status: 'CHANGES_REQUESTED',
          reviewStartedAt,
          reviewerId: session.userId,
          slaPausedAt: now,
          slaState: 'PAUSED',
          updatedAt: now,
        })
        .where(eq(munSubmissions.id, submission.id))
        .returning()

      // Dedicated Gate 2 mun-level enum value — see docstring. Do NOT reuse
      // MODULE_REVIEWED here: that value is reserved for a future
      // per-module review audit trail (module-verification.ts), a distinct
      // concept from this mun-level Gate 2 decision.
      await recordAdminAction(tx, session.userId, 'MUN_CHANGES_REQUESTED', 'mun_submission', submission.id, opts.notes, {
        munId,
      })

      return row
    }

    // REJECTED — opts.reason validated non-empty above.
    await transitionMun(munId, 'REJECTED', session.userId, opts.notes, opts.reason, tx)

    const [row] = await tx
      .update(munSubmissions)
      .set({
        status: 'REJECTED',
        reviewStartedAt,
        reviewerId: session.userId,
        decidedAt: now,
        rejectionReason: opts.reason,
        updatedAt: now,
      })
      .where(eq(munSubmissions.id, submission.id))
      .returning()

    await recordAdminAction(tx, session.userId, 'MUN_REJECTED', 'mun_submission', submission.id, opts.reason, {
      munId,
    })

    return row
  })

  // Outside the transaction, after commit (Task 12 Step 5).
  notifyAfterCommit(async () => {
    const context = await resolveMunNotificationContext(munId)

    if (decision === 'APPROVED') {
      await notifyPipelineEvent({ type: 'APPROVED', munId, organizerEmail: context.organizerEmail, munName: context.munName })
      return
    }

    // CHANGES_REQUESTED and REJECTED both use the CHANGES_REQUESTED event
    // shape — see the docstring above for why REJECTED reuses it (no
    // dedicated REJECTED variant exists in the PipelineEvent union).
    const reason =
      opts.reason ??
      opts.notes ??
      (opts.issues && opts.issues.length > 0 ? opts.issues.map((issue) => issue.reason).join('; ') : 'See review notes.')

    await notifyPipelineEvent({
      type: 'CHANGES_REQUESTED',
      munId,
      organizerEmail: context.organizerEmail,
      munName: context.munName,
      moduleName: 'FINAL_REVIEW',
      reason,
    })
  })

  return updated
}

/**
 * Admin moves a VERIFIED mun into the go-live queue (design doc Section 5.3)
 * — ADMIN/SUPER_ADMIN only. Row-locks the active submission (the thing
 * `queuedAt` lives on) before transitioning the mun.
 */
export async function enqueueForGoLive(munId: string, session: Session | null): Promise<typeof munSubmissions.$inferSelect> {
  requireRole(session, [...PUBLISH_ROLES])

  return db.transaction(async (tx) => {
    const submission = await lockActiveSubmission(tx, munId)
    if (!submission) {
      throw new Error('No active submission found for this mun')
    }

    await transitionMun(munId, 'GO_LIVE_QUEUE', session.userId, undefined, undefined, tx)

    const [updated] = await tx
      .update(munSubmissions)
      .set({ queuedAt: new Date(), updatedAt: new Date() })
      .where(eq(munSubmissions.id, submission.id))
      .returning()

    return updated
  })
}

export interface GoLiveQueueParams {
  limit?: number
  offset?: number
}

export interface GoLiveQueueRow {
  munId: string
  munName: string
  munStatus: string
  submissionId: string
  submissionStatus: string
  submittedAt: Date | null
  slaDeadline: Date
  slaState: SlaState
  queuedAt: Date | null
}

export interface GoLiveQueueResult {
  results: GoLiveQueueRow[]
  total: number
}

// Same "grows with platform volume, not per-mun" reasoning as
// admin-review.ts's getReviewQueue/getModuleReviewQueue — default page size
// 20, matching that convention exactly.
const DEFAULT_PAGE_SIZE = 20

const COMPLETED_SUBMISSION_STATUSES = ['PUBLISHED']

/**
 * Paginated go-live queue: joins mun + active submission data. `slaState` is
 * **computed on read** via `computeSlaState(input, now, submittedAt)` rather
 * than trusting the stored column — the stored column is only a point-in-
 * time snapshot from whenever a transition last wrote it, and a queue view
 * needs the CURRENT state (design doc Section 5.2). Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN, same bar as `getReviewQueue`.
 */
export async function getGoLiveQueue(params: GoLiveQueueParams = {}, session: Session | null): Promise<GoLiveQueueResult> {
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? DEFAULT_PAGE_SIZE
  const offset = params.offset ?? 0
  const now = new Date()

  const rows = await db
    .select({
      munId: muns.id,
      munName: muns.name,
      munStatus: muns.status,
      submissionId: munSubmissions.id,
      submissionStatus: munSubmissions.status,
      submittedAt: munSubmissions.submittedAt,
      slaDeadline: munSubmissions.slaDeadline,
      slaPausedAt: munSubmissions.slaPausedAt,
      slaPausedTotalMs: munSubmissions.slaPausedTotalMs,
      queuedAt: munSubmissions.queuedAt,
    })
    .from(munSubmissions)
    .innerJoin(muns, eq(munSubmissions.munId, muns.id))
    .where(ACTIVE_SUBMISSION_PREDICATE)
    .orderBy(desc(munSubmissions.submittedAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(munSubmissions)
    .where(ACTIVE_SUBMISSION_PREDICATE)

  const results: GoLiveQueueRow[] = rows.map((row) => ({
    munId: row.munId,
    munName: row.munName,
    munStatus: row.munStatus,
    submissionId: row.submissionId,
    submissionStatus: row.submissionStatus,
    submittedAt: row.submittedAt,
    slaDeadline: row.slaDeadline,
    queuedAt: row.queuedAt,
    slaState: computeSlaState(
      {
        slaDeadline: row.slaDeadline,
        status: row.submissionStatus,
        slaPausedAt: row.slaPausedAt,
        slaPausedTotalMs: row.slaPausedTotalMs,
        completedStatuses: COMPLETED_SUBMISSION_STATUSES,
      },
      now,
      row.submittedAt ?? undefined,
    ),
  }))

  return { results, total: count }
}

export interface PublishFromQueueResult {
  mun: typeof muns.$inferSelect
  submission: typeof munSubmissions.$inferSelect
  munVersionId: string | null
  replay: boolean
}

/**
 * The single most consequential write path in the whole plan — makes a mun
 * LIVE on the public marketplace. Entirely inside ONE `db.transaction`,
 * following design doc Section 5.3's 8-step sequence exactly:
 *
 *   1. `SELECT ... FOR UPDATE` the `mun_submissions` row — NOT the mun row.
 *      The submission row is the serialization point because it's the row
 *      carrying `publishIdempotencyKey`; locking the thing you're about to
 *      conditionally write is the only lock that actually helps here. Uses
 *      `lockLatestSubmission` (no status filter) rather than
 *      `lockActiveSubmission` — a replay after the submission is already
 *      PUBLISHED must still find this row.
 *   2. If already PUBLISHED (or `idempotencyKey` matches the stored one):
 *      return the EXISTING result unchanged — an idempotent replay, not an
 *      error (PRD §40.11).
 *   3. Re-run `validateMunForSubmission(munId, { stage: 'PUBLISH' })` against
 *      LIVE current data — never trust the earlier admin approval, since
 *      the data may have moved since. A failure throws naming the specific
 *      failing checks, and the transaction rolls back entirely: the mun
 *      must never be left sitting in PUBLISHING from a failed attempt (that
 *      is why `PUBLISHING -> GO_LIVE_QUEUE` exists only as a manual admin
 *      recovery path for a genuine crash-between-commits scenario, not the
 *      normal failure path — no automatic recovery logic is built here).
 *   4. `transitionMun -> PUBLISHING` (audit-logged, `externalTx`).
 *   5. Create the `mun_versions` snapshot (reusing `buildSnapshot` from
 *      organizer-confirmation.ts rather than duplicating the read); set
 *      `submission.munVersionId`.
 *   6. `transitionMun -> PUBLISHED` — `mun-state-machine.ts`'s existing
 *      `runTransition` already sets `publishedAt` as a side effect of this
 *      transition, so this function does not set it again redundantly.
 *   7. Update the submission row: `status = 'PUBLISHED'`, `publishedAt`,
 *      `slaState = 'COMPLETED'`, `publishIdempotencyKey` persisted — the
 *      caller-supplied key if one was passed, otherwise a server-generated
 *      one (`crypto.randomUUID()`), so every published submission always
 *      ends up with a real idempotency key on it even if the caller never
 *      supplied one.
 *   8. Write an `admin_actions` row with `MUN_PUBLISHED`.
 *
 * ADMIN/SUPER_ADMIN only, same bar as the rest of the publish surface.
 *
 * On the success, NON-REPLAY path only, fires `PUBLISHED` to the organizer
 * with a `publicUrl` built via `buildPublicMunUrl` (Task 12 Step 5) — a
 * replay must NOT re-notify, since nothing new actually happened.
 */
export async function publishFromQueue(
  munId: string,
  session: Session | null,
  idempotencyKey?: string,
): Promise<PublishFromQueueResult> {
  requireRole(session, [...PUBLISH_ROLES])

  const result = await db.transaction(async (tx) => {
    // Step 1: FOR UPDATE lock on the submission row — the serialization
    // point for this whole function. Two concurrent publishFromQueue calls
    // for the same mun serialize here; whichever gets the lock second sees
    // the first caller's already-committed PUBLISHED status in step 2. No
    // status filter on this lookup (see lockLatestSubmission's docstring) —
    // a post-publish replay must still find the row.
    const submission = await lockLatestSubmission(tx, munId)
    if (!submission) {
      throw new Error('No submission found for this mun')
    }

    // Step 2: idempotent replay — either the submission is already
    // PUBLISHED, or the caller supplied the exact idempotency key already
    // stored on it. Either way, return the existing result unchanged rather
    // than throwing or re-running the publish sequence.
    const isReplay =
      submission.status === 'PUBLISHED' ||
      (idempotencyKey !== undefined && idempotencyKey === submission.publishIdempotencyKey)
    if (isReplay) {
      const [mun] = await tx.select().from(muns).where(eq(muns.id, munId)).limit(1)
      if (!mun) throw new Error('Mun not found')
      return { mun, submission, munVersionId: submission.munVersionId, replay: true }
    }

    // Step 3: re-validate against LIVE data at the PUBLISH stage. Do not
    // trust the earlier admin approval — approval happened at T-1day and
    // the data may have moved (e.g. payment verification regressed).
    const revalidation = await validateMunForSubmission(munId, { stage: 'PUBLISH' })
    if (!revalidation.passed) {
      const failing = revalidation.blockers.map((blocker) => blocker.label).join('; ')
      throw new Error(`Cannot publish — validation fails at PUBLISH stage: ${failing}`)
    }

    // Step 4: PUBLISHING (audit-logged, participates in this transaction).
    await transitionMun(munId, 'PUBLISHING', session.userId, undefined, undefined, tx)

    // Step 5: snapshot into mun_versions, reusing the same builder Gate 3
    // uses rather than duplicating the 12-table read.
    const snapshot = await buildSnapshot(munId)
    const [priorVersion] = await tx
      .select({ versionNumber: munVersions.versionNumber })
      .from(munVersions)
      .where(eq(munVersions.munId, munId))
      .orderBy(desc(munVersions.versionNumber))
      .limit(1)
    const nextVersionNumber = (priorVersion?.versionNumber ?? 0) + 1

    const [version] = await tx
      .insert(munVersions)
      .values({ munId, versionNumber: nextVersionNumber, snapshotJson: snapshot })
      .returning()

    // Step 6: PUBLISHED. mun-state-machine.ts's runTransition sets
    // publishedAt as an existing side effect of this transition — not
    // re-set here.
    const updatedMun = await transitionMun(munId, 'PUBLISHED', session.userId, undefined, undefined, tx)

    // Step 7: finalize the submission row. Persist the caller-supplied
    // idempotency key if given, otherwise generate one server-side so a
    // published submission always carries a real key.
    const finalIdempotencyKey = idempotencyKey ?? crypto.randomUUID()
    const now = new Date()

    const [updatedSubmission] = await tx
      .update(munSubmissions)
      .set({
        status: 'PUBLISHED',
        publishedAt: now,
        slaState: 'COMPLETED',
        publishIdempotencyKey: finalIdempotencyKey,
        munVersionId: version.id,
        updatedAt: now,
      })
      .where(eq(munSubmissions.id, submission.id))
      .returning()

    // Step 8: admin_actions audit row.
    await recordAdminAction(tx, session.userId, 'MUN_PUBLISHED', 'mun', munId, undefined, {
      submissionId: submission.id,
      munVersionId: version.id,
    })

    return { mun: updatedMun, submission: updatedSubmission, munVersionId: version.id, replay: false }
  })

  // Outside the transaction, after commit (Task 12 Step 5). Only on the
  // success, non-replay path.
  if (!result.replay) {
    notifyAfterCommit(async () => {
      const context = await resolveMunNotificationContext(munId)
      // PUBLISHING and PUBLISHED both happened inside the transaction above
      // (steps 4 and 6) — the house rule that notifications only fire after
      // commit (see file header) means there's no earlier point to fire
      // PUBLISHING at, so it's sent here, immediately before PUBLISHED,
      // preserving their transaction-order sequence rather than firing
      // PUBLISHED first.
      await notifyPipelineEvent({ type: 'PUBLISHING', munId, organizerEmail: context.organizerEmail, munName: context.munName })
      await notifyPipelineEvent({
        type: 'PUBLISHED',
        munId,
        organizerEmail: context.organizerEmail,
        munName: context.munName,
        publicUrl: buildPublicMunUrl(context.slug),
      })
    })
  }

  return result
}
