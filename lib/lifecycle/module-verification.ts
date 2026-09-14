import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, muns, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import type { MunModule, ModuleVerificationState, VerificationSeverity } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { getModuleDefinition, TRACKED_MODULES } from './module-registry'
import { transitionMun } from './mun-state-machine'

// Same Drizzle transaction-callback param type used by lib/lifecycle/
// mun-state-machine.ts — kept as a local alias rather than an import so this
// module doesn't take on an extra dependency just for a type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface ModuleVerification {
  id: string
  munId: string
  moduleName: MunModule
  state: ModuleVerificationState
  organizerConfirmedAt: Date | null
  lastReviewedAt: Date | null
  lastReviewedBy: string | null
  isRequired: boolean
}

/**
 * Returns the current verification state for a module on a mun, lazily
 * creating a NOT_SUBMITTED row if none exists yet — callers never have to
 * pre-seed rows for a newly created mun.
 *
 * Race-safe: a concurrent first-touch from two callers used to be plain
 * read-then-insert, which either duplicated rows (before the Task 3 unique
 * constraint) or throws on the naive insert (after it) — neither of which is
 * correct, the second caller should just see the winner's row. Fixed with
 * `onConflictDoNothing` + a follow-up select, so the row exists either way:
 * either this insert won, or someone else's did and we read theirs.
 *
 * Accepts an optional `tx` (Drizzle transaction) — when given, every read
 * and the lazy-create insert run against it instead of the module-level
 * `db` singleton, so this call's writes participate in the caller's
 * transaction and roll back with it. Defaults to `db` when omitted,
 * preserving the exact standalone behavior every existing caller already
 * relies on. Added because `onModuleDataChanged` (module-completion.ts)
 * previously called this without threading its own `tx` through — a real
 * atomicity gap: if the caller's outer transaction later rolled back, this
 * function's lazy-create insert would NOT roll back with it, having run on
 * a separate connection. Latent until a caller wraps `onModuleDataChanged`
 * in an outer transaction (Task 10's `submitMunForReview` is exactly that
 * caller per the plan) — fixed here ahead of that.
 */
export async function getModuleVerificationState(
  munId: string,
  moduleName: MunModule,
  tx?: Tx,
): Promise<ModuleVerification> {
  const client = tx ?? db

  const [existing] = await client
    .select()
    .from(munModuleVerifications)
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))
    .limit(1)

  if (existing) return existing

  await client
    .insert(munModuleVerifications)
    .values({ munId, moduleName, state: 'NOT_SUBMITTED', isRequired: getModuleDefinition(moduleName).defaultRequired })
    .onConflictDoNothing({ target: [munModuleVerifications.munId, munModuleVerifications.moduleName] })

  const [row] = await client
    .select()
    .from(munModuleVerifications)
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))
    .limit(1)

  if (!row) {
    // Unreachable in practice: the insert either wrote the row or lost a
    // race to a concurrent insert of the exact same (munId, moduleName)
    // that must itself have committed a row. If this throws, something is
    // wrong at the DB layer (e.g. the row was deleted between the insert
    // and this select) — that's a real bug, not a case to paper over.
    throw new Error(
      `Internal error: module verification row for mun "${munId}" / module "${moduleName}" is missing after insert`,
    )
  }
  return row
}

/**
 * Organizer's per-module "I confirm..." statement (PRD Sections 5/6/8).
 * Owning organizer or admin only. Only legal from NOT_SUBMITTED or
 * CHANGES_REQUESTED — a module already PENDING_REVIEW/VERIFIED can't be
 * re-confirmed without a reviewer first sending it back.
 *
 * Row-locked: two concurrent confirm attempts on the same module (e.g. a
 * double-click, or an organizer and an admin acting on the same module at
 * once) used to both read the pre-write state and both pass the precondition
 * check before either wrote — same bug class as the 2026-09-13 `transitionMun`
 * fix. Now wrapped in a transaction that re-reads the row `FOR UPDATE` and
 * re-checks the precondition under the lock.
 */
export async function confirmModule(munId: string, moduleName: MunModule, session: Session | null): Promise<ModuleVerification> {
  await assertOwnsOrAdmin(munId, session)

  // Ensures a row exists before we try to lock it — cheap no-op if one
  // already does (see getModuleVerificationState).
  await getModuleVerificationState(munId, moduleName)

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))
      .for('update')
      .limit(1)

    if (!current) {
      throw new Error(`Internal error: module verification row for mun "${munId}" / module "${moduleName}" is missing`)
    }

    if (current.state !== 'NOT_SUBMITTED' && current.state !== 'CHANGES_REQUESTED') {
      throw new Error(`Module "${moduleName}" cannot be confirmed from its current state (${current.state})`)
    }

    const [updated] = await tx
      .update(munModuleVerifications)
      .set({ state: 'PENDING_REVIEW', organizerConfirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(munModuleVerifications.id, current.id))
      .returning()
    return updated
  })
}

export interface IssueInput {
  severity: VerificationSeverity
  reason: string
  previousValue?: string
  newValue?: string
}

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

/**
 * MUNHub reviewer decision on a module (PRD Section 15). Records any issues
 * raised, flips the module's state, and — if the decision is VERIFIED —
 * checks whether all required tracked modules are now VERIFIED and
 * auto-advances the mun to VERIFIED if so.
 *
 * Row-locked the same way as `confirmModule`: two admins reviewing the same
 * module concurrently used to both read PENDING_REVIEW, both pass the state
 * check, and both write — silently corrupting state or duplicating
 * `verificationIssues` rows. Now the read-check-write sequence and the issue
 * inserts all happen inside one transaction against a `FOR UPDATE`-locked
 * row, and the issues are inserted as a single batched multi-row insert
 * rather than a loop of individual inserts.
 *
 * Precondition, re-checked under the lock (mirrors `confirmModule`): the
 * module must still be PENDING_REVIEW at the moment this transaction gets
 * the lock. Without this check, the lock only serializes the two writes —
 * it does not stop the second (now-unblocked) call from silently
 * overwriting whatever the first call just committed, with no error and no
 * signal that its own review was based on stale state. That's a strictly
 * worse failure than throwing: a reviewer's VERIFIED decision could be
 * clobbered by a concurrent REJECTED decision (or vice versa) after
 * `checkAllModulesVerified` had already acted on the now-discarded VERIFIED
 * write and auto-advanced the mun — leaving `muns.status` and the module's
 * real (post-clobber) state permanently inconsistent.
 */
export async function reviewModule(
  munId: string,
  moduleName: MunModule,
  decision: 'VERIFIED' | 'CHANGES_REQUESTED' | 'REJECTED',
  issues: IssueInput[],
  session: Session | null,
): Promise<ModuleVerification> {
  requireRole(session, [...REVIEW_ROLES])

  // Ensures a row exists before we try to lock it — cheap no-op if one
  // already does (see getModuleVerificationState).
  await getModuleVerificationState(munId, moduleName)

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))
      .for('update')
      .limit(1)

    if (!current) {
      throw new Error(`Internal error: module verification row for mun "${munId}" / module "${moduleName}" is missing`)
    }

    if (current.state !== 'PENDING_REVIEW') {
      throw new Error(
        `Module "${moduleName}" was already reviewed (current state: ${current.state}) — reload and try again`,
      )
    }

    if (issues.length > 0) {
      await tx.insert(verificationIssues).values(
        issues.map((issue) => ({
          munId,
          moduleName,
          severity: issue.severity,
          reason: issue.reason,
          previousValue: issue.previousValue,
          newValue: issue.newValue,
          raisedBy: session.userId,
        })),
      )
    }

    const [row] = await tx
      .update(munModuleVerifications)
      .set({ state: decision, lastReviewedAt: new Date(), lastReviewedBy: session.userId, updatedAt: new Date() })
      .where(eq(munModuleVerifications.id, current.id))
      .returning()
    return row
  })

  if (decision === 'VERIFIED') {
    await checkAllModulesVerified(munId, session.userId)
  }

  return updated
}

/**
 * If every required tracked module is VERIFIED and the mun is currently in
 * VERIFICATION, transitions it to VERIFIED via the shared state machine
 * (which writes the audit log row). `actorId` is the reviewer whose
 * `reviewModule` call triggered this check — `verificationLogs.reviewerId`
 * is a NOT NULL FK to a real user, so this can't be a synthetic "system"
 * actor.
 *
 * Correctness point the old 4-module version got away with by luck: a
 * required module with NO row at all (never touched) must fail the check
 * immediately, not be silently skipped by `.every()`. `.every()` over a
 * list that's simply missing an expected member is not the same as
 * checking presence — at 15 modules it is no longer safe to assume every
 * caller has touched every module first.
 */
export async function checkAllModulesVerified(munId: string, actorId: string): Promise<boolean> {
  const rows = await db.select().from(munModuleVerifications).where(eq(munModuleVerifications.munId, munId))
  const rowsByModule = new Map(rows.map((r) => [r.moduleName, r]))

  const requiredTrackedModules = TRACKED_MODULES.filter((moduleKey) => {
    const row = rowsByModule.get(moduleKey)
    // A required module with no row yet is required-by-default (per the
    // registry) until a row says otherwise, so treat "no row" as required
    // for the purposes of this filter — it then correctly fails the
    // presence check below rather than being silently excluded.
    return row ? row.isRequired : getModuleDefinition(moduleKey).defaultRequired
  })

  const allRowsPresent = requiredTrackedModules.every((moduleKey) => rowsByModule.has(moduleKey))
  if (!allRowsPresent) return false

  const allVerified = requiredTrackedModules.every((moduleKey) => rowsByModule.get(moduleKey)?.state === 'VERIFIED')
  if (!allVerified) return false

  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || mun.status !== 'VERIFICATION') return false

  await transitionMun(munId, 'VERIFIED', actorId, 'All modules verified')
  return true
}

const REQUIREMENT_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

/**
 * Admin-only toggle for a module's per-mun `isRequired` flag (PRD Section 6:
 * "optional modules may be configured by MUNHub"). `FINAL_REVIEW` must
 * always stay required — rejecting an attempt to make it optional here,
 * rather than relying on every future caller to remember that rule.
 *
 * Writes an `admin_actions` audit row (`MODULE_REQUIREMENT_CHANGED`) in the
 * same transaction as the flag flip.
 */
export async function setModuleRequirement(
  munId: string,
  moduleKey: MunModule,
  isRequired: boolean,
  session: Session | null,
): Promise<ModuleVerification> {
  requireRole(session, [...REQUIREMENT_ROLES])

  if (moduleKey === 'FINAL_REVIEW' && !isRequired) {
    throw new Error('FINAL_REVIEW cannot be made optional')
  }

  // Ensures a row exists before we try to update it — cheap no-op if one
  // already does (see getModuleVerificationState).
  await getModuleVerificationState(munId, moduleKey)

  return db.transaction(async (tx: Tx) => {
    const [current] = await tx
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleKey)))
      .for('update')
      .limit(1)

    if (!current) {
      throw new Error(`Internal error: module verification row for mun "${munId}" / module "${moduleKey}" is missing`)
    }

    const [updated] = await tx
      .update(munModuleVerifications)
      .set({ isRequired, updatedAt: new Date() })
      .where(eq(munModuleVerifications.id, current.id))
      .returning()

    await tx.insert(adminActions).values({
      actorId: session.userId,
      action: 'MODULE_REQUIREMENT_CHANGED',
      targetType: 'mun_module_verification',
      targetId: current.id,
      reason: `Set ${moduleKey} isRequired=${isRequired} on mun ${munId}`,
      metadata: { munId, moduleKey, isRequired, previousIsRequired: current.isRequired },
    })

    return updated
  })
}
