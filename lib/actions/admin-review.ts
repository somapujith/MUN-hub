import { and, desc, eq, getTableColumns, ilike, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  muns,
  munModuleVerifications,
  munSubmissions,
  organizerApplications,
  payments,
  registrations,
  users,
  verificationLogs,
} from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { recordAdminAction } from '@/lib/audit/log'
import { runInBackground } from '@/lib/background-tasks'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import { openReviewRound, publishFromQueue, type PublishFromQueueResult } from '@/lib/lifecycle/go-live'
import { loadValidationContext, type MunValidationContext } from '@/lib/lifecycle/validation'
import { notifyOrganizerApplicationEvent } from '@/lib/notifications/organizer-application-events'
import { resolveMunNotificationContext } from '@/lib/notifications/resolve-recipients'
import type { ApplicationStatus, ModuleVerificationState } from '@/lib/db/schema-enums'
import type { Mun, MunWithApplication } from '@/lib/types'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const
const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

// Mirrors go-live.ts's ACTIVE_SUBMISSION_PREDICATE / the partial-unique-index
// predicate on mun_submissions exactly — "does this mun have an active
// (non-terminal) submission row" is the signal `publishMun` uses to decide
// whether to delegate to `publishFromQueue` or fall back to the old direct
// transitionMun call.
const ACTIVE_SUBMISSION_PREDICATE = sql`${munSubmissions.status} NOT IN ('PUBLISHED','REJECTED','WITHDRAWN')`

export interface ReviewQueueParams {
  /** Default 'SUBMITTED' — the pending queue (covers mun.status SUBMITTED and UNDER_REVIEW alike, since the application row stays SUBMITTED until a decision is recorded). */
  status?: ApplicationStatus
  /** Matches the MUN name or the organizer's name/email. */
  search?: string
  limit?: number
  offset?: number
}

export interface ReviewQueueResult {
  results: Mun[]
  total: number
}

/**
 * Gate-1 organizer applications, for the review queue dashboard — filtered by
 * the application's own decision status (`organizerApplications.status`),
 * not `muns.status`: an APPROVED application's mun moves on to ONBOARDING and
 * beyond, so `muns.status` alone can't answer "was this application
 * approved" once Gate 1 is behind it. Requires OPERATIONS/ADMIN/SUPER_ADMIN
 * — actor is derived from the caller-supplied `session` (resolved by the
 * HTTP layer from the request), never trusted from any other input.
 *
 * Paginated (default 20/page) — this grows with total platform submission
 * volume, not per-mun, so it needs a bound before real organizer counts
 * (flagged during frontend review: unbounded at 500+ organizers would mean
 * a multi-thousand-row render on every /admin/review hit).
 */
export async function getReviewQueue(
  params: ReviewQueueParams = {},
  session: Session | null,
): Promise<ReviewQueueResult> {
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const status = params.status ?? 'SUBMITTED'
  const q = params.search?.trim()
  const whereClause = and(
    eq(organizerApplications.status, status),
    q
      ? or(ilike(muns.name, `%${pattern(q)}%`), ilike(users.name, `%${pattern(q)}%`), ilike(users.email, `%${pattern(q)}%`))
      : undefined,
  )

  const results = await db
    .select(getTableColumns(muns))
    .from(muns)
    .innerJoin(organizerApplications, eq(organizerApplications.munId, muns.id))
    .innerJoin(users, eq(organizerApplications.organizerId, users.id))
    .where(whereClause)
    .orderBy(desc(muns.createdAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(muns)
    .innerJoin(organizerApplications, eq(organizerApplications.munId, muns.id))
    .innerJoin(users, eq(organizerApplications.organizerId, users.id))
    .where(whereClause)

  return { results, total: count }
}

/**
 * Full ops-only detail for one mun: the mun row, its organizer application,
 * and its complete verification log history INCLUDING internalNotes — this
 * is the internal review view, unlike the public MUN detail page. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN.
 */
export async function getMunForReview(munId: string, session: Session | null): Promise<MunWithApplication> {
  requireRole(session, [...REVIEW_ROLES])

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) {
    throw new Error('Mun not found')
  }

  const [application] = await db
    .select()
    .from(organizerApplications)
    .where(eq(organizerApplications.munId, munId))
    .limit(1)

  const logs = await db
    .select()
    .from(verificationLogs)
    .where(eq(verificationLogs.munId, munId))
    .orderBy(desc(verificationLogs.createdAt))

  return {
    ...mun,
    organizerApplication: application ?? null,
    verificationLogs: logs,
  }
}

/**
 * Records an ops/admin review decision on a mun, transitioning its status via
 * `transitionMun` (which validates the transition and writes the audit log
 * row). Requires OPERATIONS/ADMIN/SUPER_ADMIN.
 *
 * `getReviewQueue` surfaces muns in both SUBMITTED and UNDER_REVIEW — but the
 * lifecycle only allows a decision (APPROVED/REJECTED/CHANGES_REQUESTED) from
 * UNDER_REVIEW, not directly from SUBMITTED. Calling this on a SUBMITTED mun
 * therefore first claims it into UNDER_REVIEW (its own audit-logged
 * transition, actor = the deciding reviewer) before applying the decision, so
 * ops/admin can act on a queue row in one call instead of needing a separate
 * "claim" action.
 *
 * An APPROVED decision also performs the Gate 1 exit (APPROVED -> ONBOARDING),
 * so the returned mun is in ONBOARDING and the organizer can start building
 * it. The decision is mirrored onto `organizer_applications.status` /
 * `reviewNotes`. REJECTED and CHANGES_REQUESTED require non-empty `notes`
 * (the reason shown to the organizer). All of it is one transaction; each
 * status hop writes its own `verificationLogs` row, and those rows are what
 * `listAdminActions` (admin-audit.ts) surfaces as APPLICATION_* entries.
 *
 * **Gate 1 only.** This is organizer-APPLICATION review (SUBMITTED/
 * UNDER_REVIEW muns, `organizer_applications`), never mun-content review.
 * Gate 2's content-review decision is `reviewSubmission`
 * (lib/lifecycle/go-live.ts), which acts on `mun_submissions` rows instead —
 * the two must never be routed through each other (mun-state-machine.ts's
 * header comment has the full Gate-1/Gate-2 explanation).
 */
export async function reviewMunApplication(
  munId: string,
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
  notes: string | undefined,
  internalNotes: string | undefined,
  session: Session | null,
): Promise<Mun> {
  requireRole(session, [...REVIEW_ROLES])

  // A rejection or a change request must tell the organizer why (Admin PRD
  // §8). Only an approval may be recorded without a note.
  const trimmedNotes = notes?.trim() || undefined
  if (decision !== 'APPROVED' && !trimmedNotes) {
    throw new Error('A reason is required to reject or request changes')
  }

  // Everything below commits (or rolls back) as one unit: the optional
  // SUBMITTED -> UNDER_REVIEW claim, the decision itself, the APPROVED ->
  // ONBOARDING Gate 1 exit, and the organizer_applications status mirror.
  // Each status hop is its own audit-logged transition (verificationLogs).
  const updated = await db.transaction(async (tx) => {
    const [mun] = await tx.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
    if (!mun) {
      throw new Error('Mun not found')
    }

    if (mun.status === 'SUBMITTED') {
      await transitionMun(munId, 'UNDER_REVIEW', session.userId, undefined, undefined, tx)
    }

    let result = await transitionMun(munId, decision, session.userId, trimmedNotes, internalNotes, tx)

    await tx
      .update(organizerApplications)
      .set({ status: decision, reviewNotes: trimmedNotes ?? null })
      .where(eq(organizerApplications.munId, munId))

    if (decision === 'APPROVED') {
      // Gate 1 exit — an approved organizer lands straight in the
      // onboarding workspace. APPROVED itself is not a submittable state.
      result = await transitionMun(munId, 'ONBOARDING', session.userId, undefined, undefined, tx)
    }

    return result
  })

  // After commit, never inside the transaction above (Task 12 Step 5
  // convention — see lib/lifecycle/go-live.ts's file header). The Gate-1
  // decision itself is an OrganizerApplicationEvent, never PipelineEvent's
  // Gate-2-scoped APPROVED/CHANGES_REQUESTED (see that file's header for
  // why).
  notifyReviewDecisionAfterCommit(munId, decision, trimmedNotes)

  return updated
}

export interface BulkApplicationDecisionResult {
  id: string
  ok: boolean
  error?: string
}

/**
 * Bulk-approve wrapper around `reviewMunApplication` — approve-only. Reject
 * and changes-requested both require a per-item reason (Admin PRD §8), which
 * doesn't fit a single bulk action, so those stay single-item on purpose.
 *
 * Thin on purpose: no new transaction, no duplicated transition/audit/
 * notification logic — every id in `munIds` just calls the existing
 * `reviewMunApplication(munId, 'APPROVED', ...)` one at a time, inside its
 * own try/catch, so one item that can no longer be approved (already
 * decided by someone else since the queue was loaded, an invalid state
 * transition, etc.) doesn't abort the rest of the batch. Returns a per-id
 * result so the caller can show exactly which ones succeeded and why any
 * failed. Requires the same role bar as `reviewMunApplication`, checked once
 * up front so an unauthorized caller fails fast instead of failing once per
 * id in the loop.
 */
export async function bulkApproveMunApplications(
  munIds: string[],
  session: Session | null,
): Promise<BulkApplicationDecisionResult[]> {
  requireRole(session, [...REVIEW_ROLES])

  const results: BulkApplicationDecisionResult[] = []
  for (const munId of munIds) {
    try {
      await reviewMunApplication(munId, 'APPROVED', undefined, undefined, session)
      results.push({ id: munId, ok: true })
    } catch (error) {
      results.push({ id: munId, ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  return results
}

function notifyReviewDecisionAfterCommit(
  munId: string,
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
  reason: string | undefined,
): void {
  // `runInBackground` keeps this alive past the response on Workers.
  runInBackground('admin-review pipeline notification', async () => {
    const context = await resolveMunNotificationContext(munId)

    if (decision === 'APPROVED') {
      await notifyOrganizerApplicationEvent({
        type: 'APPLICATION_APPROVED',
        munId,
        organizerEmail: context.organizerEmail,
        munName: context.munName,
      })
      return
    }

    await notifyOrganizerApplicationEvent({
      type: decision === 'REJECTED' ? 'APPLICATION_REJECTED' : 'APPLICATION_CHANGES_REQUESTED',
      munId,
      organizerEmail: context.organizerEmail,
      munName: context.munName,
      // Non-APPROVED decisions require a non-empty `notes` earlier in this
      // function, so `reason` is guaranteed defined on this branch.
      reason: reason ?? 'See review notes.',
    })
  })
}

/**
 * Publishes a mun (VERIFIED -> PUBLISHED). Stricter than review: only
 * ADMIN/SUPER_ADMIN — operations can review applications but only admin
 * publishes to the public marketplace.
 *
 * As of the verification/confirmation trust layer, this requires VERIFIED
 * (not VERIFICATION) — a mun only reaches VERIFIED once all 4 tracked
 * modules pass module-level review (see lib/lifecycle/module-verification.ts's
 * `checkAllModulesVerified`), which is a stricter bar than the old flat
 * mun-level VERIFICATION state.
 *
 * Task 11 change: when this mun has an active `mun_submissions` row (i.e. it
 * went through the go-live pipeline's submission gate), this delegates to
 * `publishFromQueue` for the full concurrency-safe, idempotent, re-validated
 * publish sequence (design doc Section 5.3). When no active submission row
 * exists — a mun published before this slice existed, or seed data created
 * directly in VERIFIED/PUBLISHED status with no submission row at all — this
 * falls back to the original direct `transitionMun` call unchanged, which is
 * why the pre-existing `publishMun` test (admin-review.test.ts) still passes
 * without modification.
 */
export async function publishMun(munId: string, session: Session | null): Promise<Mun> {
  requireRole(session, [...PUBLISH_ROLES])

  const [activeSubmission] = await db
    .select({ id: munSubmissions.id })
    .from(munSubmissions)
    .where(and(eq(munSubmissions.munId, munId), ACTIVE_SUBMISSION_PREDICATE))
    .limit(1)

  if (activeSubmission) {
    const result: PublishFromQueueResult = await publishFromQueue(munId, session)
    return result.mun as Mun
  }

  return transitionMun(munId, 'PUBLISHED', session.userId)
}

/**
 * Pulls a PUBLISHED mun off the marketplace — a pure visibility toggle, no
 * re-verification needed since the content hasn't changed.
 *
 * **Behavior change (Task 11, 2026-09-14, deliberate):** this used to target
 * VERIFIED. It now targets **UNPUBLISHED** (spec Section 1.4) — a status
 * added specifically to distinguish "admin pulled this off the marketplace"
 * from VERIFIED ("content verified, not yet ever published"). Retargeting to
 * VERIFIED conflated those two meanings and, per `ALLOWED_TRANSITIONS`,
 * VERIFIED would have let the mun skip straight back through
 * `enqueueForGoLive`/`publishFromQueue`'s submission-row bookkeeping in a way
 * that didn't reflect it had already been live. UNPUBLISHED's own transition
 * map (`mun-state-machine.ts`) allows both `GO_LIVE_QUEUE` (re-publish) and
 * `VERIFICATION` (re-review) from here, and is intentionally NOT reachable
 * once registrations exist — use `suspendMun` for a live mun with active
 * registrations instead. **The existing test for this function was updated
 * to expect UNPUBLISHED, not silently left asserting the old VERIFIED
 * target** (see admin-review.test.ts).
 *
 * Same role bar as `publishMun` (ADMIN/SUPER_ADMIN only). The status change
 * and its `admin_actions` audit row commit atomically: both run against one
 * transaction opened here and handed into `transitionMun` as `externalTx`.
 */
export async function unpublishMun(munId: string, session: Session | null): Promise<Mun> {
  requireRole(session, [...PUBLISH_ROLES])

  return db.transaction(async (tx) => {
    const updated = await transitionMun(munId, 'UNPUBLISHED', session.userId, undefined, undefined, tx)
    await recordAdminAction(tx, session.userId, 'MUN_UNPUBLISHED', 'mun', munId)
    return updated
  })
}

/**
 * Suspends a mun (reversible hide + stop new registrations) — reachable from
 * PUBLISHED onward per `ALLOWED_TRANSITIONS`. Requires a non-empty `reason`,
 * recorded on both the `admin_actions` row and, via `transitionMun`, the
 * `verificationLogs` row. Same role bar as `publishMun`. Status change +
 * audit row commit atomically, same pattern as `unpublishMun`.
 */
export async function suspendMun(munId: string, reason: string, session: Session | null): Promise<Mun> {
  requireRole(session, [...PUBLISH_ROLES])

  return db.transaction(async (tx) => {
    const updated = await transitionMun(munId, 'SUSPENDED', session.userId, undefined, reason, tx)
    await recordAdminAction(tx, session.userId, 'MUN_SUSPENDED', 'mun', munId, reason)
    return updated
  })
}

/**
 * Reinstates a suspended mun — sends it back through VERIFICATION rather than
 * straight to VERIFIED/PUBLISHED, so it's re-checked before going live again.
 * Same role bar as `publishMun`. No separate `admin_actions` row: the
 * `verificationLogs` row `transitionMun` already writes is the audit trail
 * for this transition, mirroring how every other lifecycle transition (e.g.
 * `reviewMunApplication`) is recorded.
 *
 * Opens a fresh Gate-2 review round in the same transaction
 * (`openReviewRound`). A previously published mun's only submission is
 * PUBLISHED (terminal), so without one there is nothing for `reviewSubmission`
 * to act on, no module sitting in PENDING_REVIEW, and `enqueueForGoLive`
 * refuses status VERIFICATION — the mun would be stuck in VERIFICATION with
 * CANCELLED as the only exit while delegates still held paid seats.
 */
export async function reinstateMun(munId: string, session: Session | null): Promise<Mun> {
  requireRole(session, [...PUBLISH_ROLES])

  return db.transaction(async (tx) => {
    const updated = await transitionMun(munId, 'VERIFICATION', session.userId, undefined, undefined, tx)
    await openReviewRound(tx, munId, session.userId)
    return updated
  })
}

export interface ModuleReviewQueueRow {
  id: string
  munId: string
  munName: string
  moduleName: string
  state: string
  organizerConfirmedAt: Date | null
}

export interface ModuleReviewQueueResult {
  results: ModuleReviewQueueRow[]
  total: number
}

export interface ModuleReviewQueueParams {
  /** Default 'PENDING_REVIEW' — the pending queue. */
  status?: ModuleVerificationState
  /** Matches the MUN name. */
  search?: string
  limit?: number
  offset?: number
}

/**
 * Module-verification rows across every mun, joined to the mun's name, for
 * the MUNHub Verification Console (PRD Section 15). Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN.
 *
 * Paginated (default 20/page) — same reasoning as `getReviewQueue`: this
 * grows with total platform submission volume, not per-mun. The default
 * `status` ('PENDING_REVIEW') is backed by `mun_module_verifications_state_idx`.
 */
export async function getModuleReviewQueue(
  params: ModuleReviewQueueParams = {},
  session: Session | null,
): Promise<ModuleReviewQueueResult> {
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const status = params.status ?? 'PENDING_REVIEW'
  const q = params.search?.trim()
  const whereClause = and(
    eq(munModuleVerifications.state, status),
    q ? ilike(muns.name, `%${pattern(q)}%`) : undefined,
  )

  const results = await db
    .select({
      id: munModuleVerifications.id,
      munId: munModuleVerifications.munId,
      munName: muns.name,
      moduleName: munModuleVerifications.moduleName,
      state: munModuleVerifications.state,
      organizerConfirmedAt: munModuleVerifications.organizerConfirmedAt,
    })
    .from(munModuleVerifications)
    .innerJoin(muns, eq(munModuleVerifications.munId, muns.id))
    .where(whereClause)
    .orderBy(sql`${munModuleVerifications.organizerConfirmedAt} DESC NULLS LAST`)
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(munModuleVerifications)
    .innerJoin(muns, eq(munModuleVerifications.munId, muns.id))
    .where(whereClause)

  return { results, total: count }
}

export interface AdminMunModuleContent {
  munId: string
  munName: string
  context: MunValidationContext
}

/**
 * Everything an organizer has submitted for one MUN, across all 15 tracked
 * modules, in one batched read — the Verification Console today only shows
 * per-module status metadata (`getAdminMunDetail`'s `modules` array: state/
 * completion%/blocking-issue-count), never the actual field content a
 * reviewer needs to check. `loadValidationContext` (lib/lifecycle/
 * validation.ts) already does exactly this "one batched read" for the
 * automated validation engine — this just exposes that same context to
 * admins verbatim, rather than re-fetching or duplicating any of what it
 * already loads (mun row, committees, portfolios, registration products,
 * executive board, form fields, masked payment settings, documents,
 * schedule, contact, media, accommodation options+fields).
 *
 * Requires OPERATIONS/ADMIN/SUPER_ADMIN — same bar as `getModuleReviewQueue`.
 * Deliberately checks the role directly rather than going through
 * `assertOwnsOrAdmin` (lib/lifecycle/module-completion.ts): that helper does
 * not cover OPERATIONS (a documented, pre-existing scope boundary — see
 * CLAUDE.md's LOCKED-enforcement section), which would silently lock ops
 * staff out of this console. Throws 'Mun not found' (propagated from
 * `loadValidationContext`) for a non-existent mun.
 */
export async function getAdminMunModuleContent(
  munId: string,
  session: Session | null,
): Promise<AdminMunModuleContent> {
  requireRole(session, [...REVIEW_ROLES])

  const context = await loadValidationContext(munId)

  return {
    munId,
    munName: context.mun.name,
    context,
  }
}

export interface RegistrationsQueueParams {
  q?: string
  limit?: number
  offset?: number
}

export interface RegistrationsQueueRow {
  id: string
  delegateName: string
  delegateEmail: string
  munName: string
  status: string
  paymentStatus: string | null
  createdAt: Date
}

export interface RegistrationsQueueResult {
  results: RegistrationsQueueRow[]
  total: number
}

/** Escapes ILIKE wildcards so a search for "a_b" or "100%" matches literally. */
function pattern(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * Platform-wide, paginated registrations list for the admin console's
 * Registrations page — distinct from `admin-search.ts`'s
 * `searchRegistrations`, which requires a non-empty query and returns an
 * unpaginated 50-row cap (that one's for the ops "look up one registration"
 * search box). This is the browse view the admin console mock's page
 * comment flagged as "?q= search wiring deferred": works with no `q` at all
 * (paginated, default 20/page, newest first — same reasoning as
 * `getReviewQueue`), and an optional `q` narrows across delegate name /
 * delegate email / mun name / registration id using the same
 * ILIKE-or-exact-id predicate shape as
 * `searchRegistrations`. Requires OPERATIONS/ADMIN/SUPER_ADMIN.
 */
export async function getRegistrationsQueue(
  params: RegistrationsQueueParams = {},
  session: Session | null,
): Promise<RegistrationsQueueResult> {
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const q = params.q?.trim()
  const whereClause = q
    ? or(
        ilike(users.name, `%${pattern(q)}%`),
        ilike(users.email, `%${pattern(q)}%`),
        ilike(muns.name, `%${pattern(q)}%`),
        eq(registrations.id, q),
      )
    : undefined

  const results = await db
    .select({
      id: registrations.id,
      delegateName: users.name,
      delegateEmail: users.email,
      munName: muns.name,
      status: registrations.status,
      paymentStatus: payments.status,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(whereClause)
    .orderBy(desc(registrations.createdAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(whereClause)

  return { results, total: count }
}
