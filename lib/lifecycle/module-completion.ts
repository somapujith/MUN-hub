import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import type { MunModule, MunStatus, ModuleCompletionStatus, ModuleVerificationState } from '@/lib/db/schema-enums'
import { getModuleDefinition, TRACKED_MODULES } from './module-registry'
import { getModuleVerificationState } from './module-verification'
import { transitionMun } from './mun-state-machine'
import { triggerReverificationIfNeeded } from './reverification'

// -----------------------------------------------------------------------------
// module-completion — progress/completion engine (design doc Section 3.2/3.3)
// -----------------------------------------------------------------------------
//
// Two orthogonal axes recap (see module-verification.ts / schema.ts comments):
//   - `state`             — reviewer-facing: has MUNHub verified this module?
//   - `completionStatus`  — organizer-facing: have you filled this in
//                            correctly? THIS file computes that axis.
//
// `onModuleDataChanged` is the single choke point every module-mutation
// action calls at the end of a successful write. It is intentionally the only
// writer of the completion columns — nothing else should ever `UPDATE
// mun_module_verifications SET completion_status = ...` directly.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ONBOARDING_STATUSES: MunStatus[] = ['ONBOARDING', 'ACTION_REQUIRED', 'READY_FOR_SUBMISSION']

export interface ValidationIssue {
  key: string
  label: string
  passed: boolean
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  message?: string
}

export interface ModuleCompletionResult {
  completionStatus: ModuleCompletionStatus
  completionPercentage: number
  blockingIssueCount: number
  issues: ValidationIssue[]
}

export interface ModuleProgressRow {
  key: MunModule
  completionStatus: ModuleCompletionStatus
  completionPercentage: number
  blockingIssueCount: number
  isRequired: boolean
  verificationState: ModuleVerificationState
}

export interface MunProgress {
  overallPercentage: number
  requiredTotal: number
  requiredComplete: number
  blockingIssueCount: number
  modules: ModuleProgressRow[]
  lifecycleStatus: MunStatus
}

/**
 * Computes ONE module's completion result by calling its registry
 * definition's `validate` function.
 *
 * STUB, DELIBERATE AND TEMPORARY (Task 8, lands ahead of Task 9): the
 * `validate` field does not exist on `ModuleDefinition` yet — Task 9 adds it.
 * Until then every module trivially "passes": COMPLETE / 100% / zero
 * blocking issues / no issues. This is not a hardcoded "is Task 9 done yet"
 * check — it is `moduleDefinition.validate?.(ctx)` with the undefined case
 * handled, so the day Task 9 adds real validators to the registry, this
 * function starts doing real work with zero changes here or at any call
 * site.
 */
export async function computeModuleCompletion(
  munId: string,
  moduleKey: MunModule,
  ctx?: unknown,
): Promise<ModuleCompletionResult> {
  const moduleDefinition = getModuleDefinition(moduleKey) as {
    validate?: (context: unknown) => ModuleCompletionResult | Promise<ModuleCompletionResult>
  }

  const result = await moduleDefinition.validate?.(ctx)
  if (result) return result

  // --- BEGIN TEMPORARY STUB (remove once every registry entry has `validate`) ---
  return {
    completionStatus: 'COMPLETE',
    completionPercentage: 100,
    blockingIssueCount: 0,
    issues: [],
  }
  // --- END TEMPORARY STUB ---
}

/** Persists one module's freshly-computed completion result to its `mun_module_verifications` row. */
async function persistModuleCompletion(
  tx: Tx,
  munId: string,
  moduleKey: MunModule,
  result: ModuleCompletionResult,
): Promise<void> {
  await tx
    .update(munModuleVerifications)
    .set({
      completionStatus: result.completionStatus,
      completionPercentage: result.completionPercentage,
      blockingIssueCount: result.blockingIssueCount,
      lastComputedAt: new Date(),
      completedAt: result.completionStatus === 'COMPLETE' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleKey)))
}

/**
 * Aggregates completion across all `TRACKED_MODULES` for one mun, persisting
 * each module's freshly-computed row along the way.
 *
 * `overallPercentage` is module-count based — (required modules COMPLETE) /
 * (required modules total) — NOT an average of per-module percentages. Per
 * design doc Section 3.2: averaging would let the percentage bar and the
 * "12/15 complete" count disagree (e.g. one module moving 40%→60% shifts the
 * average while the COMPLETE count stays the same). Module-count based means
 * the two numbers always describe the same fact.
 */
export async function recomputeMunProgress(munId: string, actorId?: string, tx?: Tx): Promise<MunProgress> {
  const run = async (transaction: Tx): Promise<MunProgress> => {
    const [mun] = await transaction.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
    if (!mun) throw new Error('Mun not found')

    // Ensure every tracked module has a row before we read/aggregate — cheap
    // no-op for modules already touched (see getModuleVerificationState).
    // `transaction` is threaded through so the lazy-create insert
    // participates in and rolls back with this transaction instead of
    // running on a separate connection outside it.
    for (const moduleKey of TRACKED_MODULES) {
      await getModuleVerificationState(munId, moduleKey, transaction)
    }

    const rows = await transaction
      .select()
      .from(munModuleVerifications)
      .where(eq(munModuleVerifications.munId, munId))
    const rowsByModule = new Map(rows.map((r) => [r.moduleName, r]))

    const moduleProgress: ModuleProgressRow[] = []

    for (const moduleKey of TRACKED_MODULES) {
      const existingRow = rowsByModule.get(moduleKey)
      const isRequired = existingRow ? existingRow.isRequired : getModuleDefinition(moduleKey).defaultRequired

      const result = await computeModuleCompletion(munId, moduleKey)
      await persistModuleCompletion(transaction, munId, moduleKey, result)

      moduleProgress.push({
        key: moduleKey,
        completionStatus: result.completionStatus,
        completionPercentage: result.completionPercentage,
        blockingIssueCount: result.blockingIssueCount,
        isRequired,
        verificationState: existingRow?.state ?? 'NOT_SUBMITTED',
      })
    }

    const requiredModules = moduleProgress.filter((m) => m.isRequired)
    const requiredTotal = requiredModules.length
    const requiredComplete = requiredModules.filter((m) => m.completionStatus === 'COMPLETE').length
    const overallPercentage = requiredTotal === 0 ? 100 : Math.round((requiredComplete / requiredTotal) * 100)

    // Unresolved BLOCKER-severity issues across all tracked modules (not just
    // required ones — an optional module's blocker still needs to surface
    // somewhere, and this is the one place that aggregates issue counts).
    const blockerRows = await transaction
      .select({ id: verificationIssues.id })
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, munId), eq(verificationIssues.severity, 'BLOCKER'), eq(verificationIssues.resolved, false)))
    const blockingIssueCount = blockerRows.length

    return {
      overallPercentage,
      requiredTotal,
      requiredComplete,
      blockingIssueCount,
      modules: moduleProgress,
      lifecycleStatus: mun.status,
    }
  }

  if (tx) return run(tx)
  return db.transaction((transaction) => run(transaction))
}

/**
 * The single choke-point hook called at the end of EVERY module-data
 * mutation across the codebase (mun-config.ts, accommodation.ts, and all
 * Task 5/6 module action files). Does exactly four things, in order:
 *
 *   1. Recompute + persist that ONE module's completion row.
 *   2. Recompute the mun's aggregate progress.
 *   3. If (and only if) the mun is currently ONBOARDING, ACTION_REQUIRED, or
 *      READY_FOR_SUBMISSION, materialize the correct one of those three based
 *      on the new aggregate. Never touches a mun in any other status (under
 *      review, verified, published, live, etc.) — this is a hard safety
 *      boundary enforced by an exact 3-element membership check, not an
 *      exclusion list.
 *   4. Call the existing `triggerReverificationIfNeeded` for the
 *      post-verification high-impact-change path.
 *
 * Runs inside `tx` when the caller already has an open transaction, otherwise
 * opens its own. **All four steps — including step 1's row lazy-create
 * (`getModuleVerificationState`) and step 4's re-verification writes
 * (`triggerReverificationIfNeeded`, and the `transitionMun` call inside it)
 * — run against that same transaction handle**, so every write this function
 * makes commits atomically with the caller's own write and rolls back
 * together if the caller's transaction rolls back. (Fixed after initial
 * landing: `getModuleVerificationState` and `triggerReverificationIfNeeded`
 * previously had no `tx` parameter at all and always ran against the
 * module-level `db` singleton, so when called from here they silently ran on
 * a separate connection outside any caller's transaction — a real atomicity
 * gap, latent only because no caller yet wrapped `onModuleDataChanged` in an
 * outer transaction. Both functions now accept and honor an optional `tx`.)
 *
 * ---
 * Design decision — does a mun in ONBOARDING move to ACTION_REQUIRED the
 * moment a required module is still incomplete, or does it stay ONBOARDING
 * until the organizer attempts to submit?
 *
 * Per design doc Section 1.5 ("ACTION_REQUIRED and READY_FOR_SUBMISSION are
 * derived-but-materialized states during onboarding only"): "the mun sits in
 * ONBOARDING while the organizer works; the progress engine (§3) flips it to
 * ACTION_REQUIRED when blocking issues exist and READY_FOR_SUBMISSION when
 * validation passes clean." The spec's own worked example is symmetric in
 * the other direction too — "an organizer who breaks a previously-complete
 * module goes READY_FOR_SUBMISSION → ACTION_REQUIRED" — which only makes
 * sense if ACTION_REQUIRED is also the resting state for "required work
 * remains, no blocking issues yet raised by a human reviewer" during
 * ordinary onboarding, not a state reserved for after a failed submission
 * attempt. Concretely here: "blocking issues" for this materialization means
 * "required modules that are not yet COMPLETE" (there are no BLOCKER-
 * severity `verification_issues` rows during ONBOARDING — those are
 * on-submission automated-validation artifacts from Task 9/§4, not something
 * that exists while the organizer is still filling the dashboard in) — so a
 * fresh mun with zero modules touched is, correctly, "required work remains"
 * i.e. ACTION_REQUIRED-shaped by this same rule.
 *
 * However: `onModuleDataChanged` only runs at the END of an actual module
 * mutation. A mun that has never had any module touched never reaches this
 * function at all, so it simply stays at whatever status it was created
 * with (ONBOARDING) until the first module write — at which point this
 * function computes the real aggregate and flips it to ACTION_REQUIRED (data
 * still incomplete after that first touch, which is the overwhelmingly
 * common case — 1 of 15 modules does not clear the bar) or
 * READY_FOR_SUBMISSION (all 15 required modules already COMPLETE, only
 * plausible once `validate` is real in Task 9 and every module happens to
 * already satisfy it). ONBOARDING is therefore never a transition TARGET of
 * this function — only ACTION_REQUIRED and READY_FOR_SUBMISSION are — which
 * matches the brief's explicit instruction that "ONBOARDING is never
 * transitioned TO by this function." The mun can still return to ONBOARDING
 * via other paths (e.g. an explicit organizer action), just not from here.
 * ---
 */
export async function onModuleDataChanged(munId: string, moduleKey: MunModule, actorId: string, tx?: Tx): Promise<void> {
  const run = async (transaction: Tx): Promise<void> => {
    // Ensure the row exists before computing/persisting against it.
    // `transaction` threaded through — see getModuleVerificationState's
    // docstring for why this matters.
    await getModuleVerificationState(munId, moduleKey, transaction)

    // 1. Recompute and persist that ONE module's completion row.
    const moduleResult = await computeModuleCompletion(munId, moduleKey)
    await persistModuleCompletion(transaction, munId, moduleKey, moduleResult)

    // 2. Recompute the mun's aggregate progress (reuses the same per-module
    // logic, including re-persisting every module's row — see
    // recomputeMunProgress's docstring for why that's acceptable here: it's
    // the one path that must stay a single source of truth).
    const progress = await recomputeMunProgress(munId, actorId, transaction)

    // 3. Only materialize the ONBOARDING/ACTION_REQUIRED/READY_FOR_SUBMISSION
    // flip if the mun is CURRENTLY one of exactly those three statuses. Never
    // touch a mun under review, verified, published, live, etc — hard safety
    // boundary, checked by exact membership in this 3-element set.
    if (ONBOARDING_STATUSES.includes(progress.lifecycleStatus)) {
      const allRequiredComplete = progress.requiredTotal > 0 && progress.requiredComplete === progress.requiredTotal
      const targetStatus: MunStatus = allRequiredComplete && progress.blockingIssueCount === 0 ? 'READY_FOR_SUBMISSION' : 'ACTION_REQUIRED'

      if (targetStatus !== progress.lifecycleStatus) {
        await transitionMun(
          munId,
          targetStatus,
          actorId,
          `Progress engine: ${progress.requiredComplete}/${progress.requiredTotal} required modules complete, ${progress.blockingIssueCount} blocking issue(s)`,
          undefined,
          transaction,
        )
      }
    }

    // 4. Existing high-impact-change re-verification path. `before`/`after`
    // are intentionally empty here — the actual before/after field diff
    // already happens at each mutation's own `triggerReverificationIfNeeded`
    // call site (mun-config.ts, etc.) using the real row snapshots. This
    // choke point exists so that Task-5/6 module files which do NOT yet call
    // `triggerReverificationIfNeeded` directly still get the post-
    // verification high-impact path exercised for whichever modules
    // Task 12 later gives a non-empty `HIGH_IMPACT_FIELDS` entry; modules
    // with no entry yet (empty list default) are correctly no-ops via
    // `detectHighImpactChange`'s `fields.some(...)` over an empty array.
    // `transaction` threaded through so its reads/writes (and its own
    // `transitionMun` call, if any) participate in this transaction instead
    // of running on a separate one.
    await triggerReverificationIfNeeded(moduleKey, {}, {}, munId, actorId, transaction)
  }

  if (tx) {
    await run(tx)
  } else {
    await db.transaction((transaction) => run(transaction))
  }
}
