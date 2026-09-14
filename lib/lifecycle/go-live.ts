import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munSubmissions, verificationIssues } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { addBusinessDays, DEFAULT_BUSINESS_CALENDAR } from './sla'
import { validateMunForSubmission, type ValidationCheck } from './validation'
import { transitionMun } from './mun-state-machine'
import { recomputeMunProgress } from './module-completion'

// -----------------------------------------------------------------------------
// go-live.ts — Submission gate (design doc Section 4.1, PRD §24/§31-33)
// -----------------------------------------------------------------------------
//
// `submitMunForReview` is the organizer-facing entry point that runs the
// Task 9 automated validation engine and, on success, opens the
// `mun_submissions` SLA clock. See the design doc's Section 4.1 for the
// exact numbered sequence this function implements — the step numbers in the
// comments below correspond to that section.
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
 */
export async function submitMunForReview(munId: string, session: Session | null): Promise<SubmitMunForReviewResult> {
  if (!session) throw new Error('Forbidden')

  return db.transaction(async (tx) => {
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
    const result = await validateMunForSubmission(munId)

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

    if (result.blockers.length > 0) {
      await tx.insert(verificationIssues).values(
        result.blockers.map((blocker) => ({
          munId,
          moduleName: result.modules.find((m) => m.checks.includes(blocker))?.moduleKey ?? 'FINAL_REVIEW',
          severity: blocker.severity,
          reason: blocker.message ?? blocker.label,
          raisedBy: session.userId,
          code: blocker.key,
          source: 'AUTOMATED',
        })),
      )
    }

    if (!result.passed) {
      // Step 6: FAILURE — transition to ACTION_REQUIRED and COMMIT (not
      // abort). The issue rows above must survive, so this is a normal
      // return, not a thrown error.
      await transitionMun(munId, 'ACTION_REQUIRED', session.userId, 'Automated validation failed', undefined, tx)
      return { passed: false, blockers: result.blockers }
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

    return { passed: true, blockers: [], submissionId: submission.id }
  })
}
