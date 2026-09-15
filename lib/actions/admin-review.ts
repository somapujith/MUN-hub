import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, munSubmissions, organizerApplications, verificationLogs } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { recordAdminAction } from '@/lib/audit/log'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import { publishFromQueue, type PublishFromQueueResult } from '@/lib/lifecycle/go-live'
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
  limit?: number
  offset?: number
}

export interface ReviewQueueResult {
  results: Mun[]
  total: number
}

/**
 * Muns awaiting ops/admin action, for the review queue dashboard. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN — actor is derived from the caller-supplied
 * `session` (resolved by the HTTP layer from the request), never trusted
 * from any other input.
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
  const whereClause = inArray(muns.status, ['SUBMITTED', 'UNDER_REVIEW'])

  const results = await db
    .select()
    .from(muns)
    .where(whereClause)
    .orderBy(desc(muns.createdAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(muns)
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

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) {
    throw new Error('Mun not found')
  }

  if (mun.status === 'SUBMITTED') {
    await transitionMun(munId, 'UNDER_REVIEW', session.userId)
  }

  return transitionMun(munId, decision, session.userId, notes, internalNotes)
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
 */
export async function reinstateMun(munId: string, session: Session | null): Promise<Mun> {
  requireRole(session, [...PUBLISH_ROLES])

  return transitionMun(munId, 'VERIFICATION', session.userId)
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

/**
 * All PENDING_REVIEW module-verification rows across every mun, joined to
 * the mun's name, for the MUNHub Verification Console (PRD Section 15).
 * Requires OPERATIONS/ADMIN/SUPER_ADMIN.
 *
 * Paginated (default 20/page) — same reasoning as `getReviewQueue`: this
 * grows with total platform submission volume, not per-mun. Backed by
 * `mun_module_verifications_state_idx` (added alongside this change).
 */
export async function getModuleReviewQueue(
  params: ReviewQueueParams = {},
  session: Session | null,
): Promise<ModuleReviewQueueResult> {
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const whereClause = eq(munModuleVerifications.state, 'PENDING_REVIEW')

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
    .orderBy(desc(munModuleVerifications.organizerConfirmedAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(munModuleVerifications)
    .where(whereClause)

  return { results, total: count }
}
