import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import type { MunModule, MunStatus, ModuleCompletionStatus, ModuleVerificationState } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { notifyPipelineEvent } from '@/lib/notifications/pipeline-events'
import { resolveMunNotificationContext } from '@/lib/notifications/resolve-recipients'
import { getModuleDefinition, TRACKED_MODULES } from './module-registry'
import { getModuleVerificationState } from './module-verification'
import { transitionMun } from './mun-state-machine'
import { isHighImpactModule, triggerReverificationIfNeeded } from './reverification'
import { loadValidationContext, type MunValidationContext, type ModuleValidationResult } from './validation'

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
// mun_module_verifications SET completion_status = ...` directly, EXCEPT
// `assertModuleNotLocked` below, which writes the `LOCKED` completionStatus
// value specifically (a distinct concern: reflecting "this module is frozen
// during active review" for the dashboard, not recomputing real completion).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ONBOARDING_STATUSES: MunStatus[] = ['ONBOARDING', 'ACTION_REQUIRED', 'READY_FOR_SUBMISSION']

/**
 * Statuses where the mun is under active MUNHub review (Task 12 Step 4,
 * design doc Section 9's "critical-field locking" follow-up, applied here to
 * exactly the HIGH_IMPACT_FIELDS-non-empty modules). While a mun sits in one
 * of these, an ORGANIZER edit to a high-impact module must be rejected —
 * changing the very data a reviewer is currently looking at would silently
 * invalidate their in-progress review.
 */
const UNDER_ACTIVE_REVIEW_STATUSES: MunStatus[] = [
  'CONTENT_SUBMITTED',
  'AUTOMATED_VALIDATION',
  'ORGANIZER_CONFIRMATION',
  'VERIFICATION',
]

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
 * LOCKED-state enforcement (Task 12 Step 4, design doc Section 9). Call at
 * the TOP of every organizer-facing update action whose module has a
 * non-empty `HIGH_IMPACT_FIELDS` list (see reverification.ts's
 * `isHighImpactModule` — the single source of truth for which modules this
 * applies to): mun-config.ts's updateMunDetails/updateCommittee/
 * updatePortfolio/updateRegistrationProduct (create/delete too, since a
 * create or delete changes the same underlying data a reviewer is looking
 * at just as much as an update does), executive-board.ts, mun-documents.ts,
 * mun-schedule.ts, mun-contact.ts, and payment-settlement.ts's
 * upsertPaymentSettings.
 *
 * Modules with an EMPTY `HIGH_IMPACT_FIELDS` list (BRANDING,
 * REGISTRATION_FORM, FINAL_REVIEW) are deliberately NOT locked — by the same
 * design-doc reasoning that keeps them out of re-verification: cosmetic/
 * cheap-to-fix changes shouldn't be frozen mid-review, and REGISTRATION_FORM
 * has its own narrower structural exception instead (registration-form.ts).
 *
 * Throws `Error('Forbidden')` if `session` is null (never trust an
 * unauthenticated caller to even learn a mun's status). Admin/ops roles
 * (ADMIN, SUPER_ADMIN, OPERATIONS) are NEVER blocked — a reviewer correcting
 * a typo on the very mun they're reviewing is a legitimate workflow this
 * function must not get in the way of; only an ORGANIZER-role caller (or any
 * other non-privileged role) is rejected. Throws `Error('Mun not found')` if
 * `munId` doesn't resolve, matching `assertOwnsOrAdmin`'s existing behavior
 * for the same case elsewhere in this codebase.
 *
 * When it does reject, the thrown message names the module and explains that
 * review is in progress — organizer-facing UI can show this directly rather
 * than a bare "Forbidden".
 */
export async function assertModuleNotLocked(munId: string, moduleKey: MunModule, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN' || session.role === 'OPERATIONS') return
  if (!isHighImpactModule(moduleKey)) return

  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')

  if (UNDER_ACTIVE_REVIEW_STATUSES.includes(mun.status)) {
    // A reviewer who sends a module back is asking for exactly these edits.
    const [row] = await db
      .select({ state: munModuleVerifications.state })
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleKey)))
      .limit(1)
    if (row?.state === 'CHANGES_REQUESTED') return
    throw new Error(
      `The "${moduleKey}" module is locked while this mun is under MUNHub review (current status: ${mun.status}) — changes to this module are blocked until review completes. Contact MUNHub support if this is urgent.`,
    )
  }
}

/**
 * Sets `completionStatus = 'LOCKED'` on every high-impact tracked module's
 * `mun_module_verifications` row for `munId` — the display-facing
 * counterpart to `assertModuleNotLocked`'s enforcement. Called from
 * `onModuleDataChanged`'s aggregate recompute path (via
 * `recomputeMunProgress`) whenever the mun is currently in one of the
 * `UNDER_ACTIVE_REVIEW_STATUSES`, so the organizer dashboard reflects LOCKED
 * without requiring a separate write path that could drift out of sync with
 * the real enforcement rule above.
 */
function isModuleLockedForStatus(
  moduleKey: MunModule,
  munStatus: MunStatus,
  moduleState: ModuleVerificationState | undefined,
): boolean {
  return (
    isHighImpactModule(moduleKey) &&
    UNDER_ACTIVE_REVIEW_STATUSES.includes(munStatus) &&
    moduleState !== 'CHANGES_REQUESTED'
  )
}

/**
 * Adapts a Task 9 `ModuleValidationResult` (`{ moduleKey, checks, passed }`)
 * into this file's `ModuleCompletionResult` (`{ completionStatus,
 * completionPercentage, blockingIssueCount, issues }`) — two different
 * shapes for two different audiences (validation.ts's is the raw pass/fail
 * checklist PRD §24/§8 render directly; this file's is the organizer-facing
 * completion axis on `mun_module_verifications`), derived from the exact
 * same `checks` array so they can never disagree about the underlying facts.
 *
 * `completionPercentage` here is satisfied-required-checks / total-required-
 * checks (BLOCKER-severity checks only count as "required" for this
 * module-local percentage — a failing HIGH/MEDIUM/LOW informational check
 * doesn't drag a module's own completion bar down, matching
 * `modulePassed`'s pass/fail rule one level up). A module with zero BLOCKER
 * checks (there is always at least one per validator in this registry, but
 * this guards the corner case defensively) is treated as 100% complete.
 *
 * `completionStatus` is COMPLETE when every BLOCKER check passed, else
 * ACTION_REQUIRED — IN_PROGRESS/NOT_STARTED/LOCKED are states this pure
 * adapter cannot itself determine (LOCKED needs review-state awareness,
 * NOT_STARTED/IN_PROGRESS need "has the organizer touched this module at
 * all" awareness) — LOCKED is now materialized by `persistModuleCompletion`
 * below (Task 12), overriding this function's COMPLETE/ACTION_REQUIRED
 * result when the mun is under active review; NOT_STARTED/IN_PROGRESS remain
 * the caller's responsibility, unchanged from Task 8.
 */
function toModuleCompletionResult(result: ModuleValidationResult): ModuleCompletionResult {
  const blockerChecks = result.checks.filter((c) => c.severity === 'BLOCKER')
  const totalRequired = blockerChecks.length
  const satisfiedRequired = blockerChecks.filter((c) => c.passed).length
  const completionPercentage = totalRequired === 0 ? 100 : Math.round((satisfiedRequired / totalRequired) * 100)
  const blockingIssueCount = totalRequired - satisfiedRequired

  return {
    completionStatus: result.passed ? 'COMPLETE' : 'ACTION_REQUIRED',
    completionPercentage,
    blockingIssueCount,
    issues: result.checks
      .filter((c) => !c.passed)
      .map((c) => ({ key: c.key, label: c.label, passed: c.passed, severity: c.severity, message: c.message })),
  }
}

/**
 * Computes ONE module's completion result by calling its registry
 * definition's `validate` function against a `MunValidationContext`.
 *
 * Task 9 note: `validate` is now attached to every `MODULE_REGISTRY` entry
 * (lib/lifecycle/validators/*.ts), so this function does real work instead
 * of the Task 8 stub. `ctx` is optional and, when omitted, is loaded via
 * `loadValidationContext(munId)` — but callers that already need the
 * context for multiple modules in the same call (`recomputeMunProgress`)
 * MUST pass a pre-loaded `ctx` through, or every one of the 15 modules would
 * re-run the full batched load, turning "one batched read" into fifteen.
 */
export async function computeModuleCompletion(
  munId: string,
  moduleKey: MunModule,
  ctx?: MunValidationContext,
): Promise<ModuleCompletionResult> {
  const context = ctx ?? (await loadValidationContext(munId))
  const moduleDefinition = getModuleDefinition(moduleKey)
  const result = moduleDefinition.validate(context)
  return toModuleCompletionResult(result)
}

/**
 * Persists one module's freshly-computed completion result to its
 * `mun_module_verifications` row. Overrides the computed COMPLETE/
 * ACTION_REQUIRED `completionStatus` with `LOCKED` when the mun is currently
 * under active review AND this module is high-impact (Task 12) — LOCKED is a
 * display fact about "is this module currently frozen", layered on top of,
 * not instead of, the real completion computation (the completion percentage
 * and blocking-issue count are still the real computed values underneath).
 */
async function persistModuleCompletion(
  tx: Tx,
  munId: string,
  moduleKey: MunModule,
  result: ModuleCompletionResult,
  munStatus: MunStatus,
  moduleState: ModuleVerificationState | undefined,
): Promise<void> {
  const completionStatus: ModuleCompletionStatus = isModuleLockedForStatus(moduleKey, munStatus, moduleState)
    ? 'LOCKED'
    : result.completionStatus

  await tx
    .update(munModuleVerifications)
    .set({
      completionStatus,
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
 *
 * Loads the validation context ONCE (Task 9) and reuses it for all 15
 * `computeModuleCompletion` calls below — the whole point of "one batched
 * read, then 15 pure functions" (design doc Section 4) would be defeated if
 * this loop re-fetched the context on every iteration.
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

    // Single batched read for this whole aggregation pass — see this
    // function's docstring.
    // Read through this transaction so the context matches the rows it writes.
    const validationContext = await loadValidationContext(munId, transaction)

    const moduleProgress: ModuleProgressRow[] = []
    const failingKeysByModule = new Map<string, Set<string>>()
    // LOCKED hides whether the module is filled in; count the real result so
    // the progress bar doesn't drop to zero while the mun is under review.
    const completeModules = new Set<MunModule>()

    for (const moduleKey of TRACKED_MODULES) {
      const existingRow = rowsByModule.get(moduleKey)
      const isRequired = existingRow ? existingRow.isRequired : getModuleDefinition(moduleKey).defaultRequired

      const result = await computeModuleCompletion(munId, moduleKey, validationContext)
      failingKeysByModule.set(moduleKey, new Set(result.issues.map((issue) => issue.key)))
      if (result.completionStatus === 'COMPLETE') completeModules.add(moduleKey)
      await persistModuleCompletion(transaction, munId, moduleKey, result, mun.status, existingRow?.state)

      moduleProgress.push({
        key: moduleKey,
        completionStatus: isModuleLockedForStatus(moduleKey, mun.status, existingRow?.state)
          ? 'LOCKED'
          : result.completionStatus,
        completionPercentage: result.completionPercentage,
        blockingIssueCount: result.blockingIssueCount,
        isRequired,
        verificationState: existingRow?.state ?? 'NOT_SUBMITTED',
      })
    }

    // An AUTOMATED issue is a failed check from a submission attempt; once
    // that check passes again the issue is stale, so resolve it here rather
    // than leaving the dashboard counting blockers the organizer already fixed.
    // FINAL_REVIEW is skipped: its one check counts the other open issues.
    const openAutomated = validationContext.unresolvedIssues.filter(
      (issue) => issue.source === 'AUTOMATED' && issue.code != null && issue.moduleName !== 'FINAL_REVIEW',
    )
    const fixedIssueIds = openAutomated
      .filter((issue) => !failingKeysByModule.get(issue.moduleName)?.has(issue.code!))
      .map((issue) => issue.id)
    if (fixedIssueIds.length > 0) {
      await transaction
        .update(verificationIssues)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(inArray(verificationIssues.id, fixedIssueIds), eq(verificationIssues.resolved, false)))
    }

    const requiredModules = moduleProgress.filter((m) => m.isRequired)
    const requiredTotal = requiredModules.length
    const requiredComplete = requiredModules.filter((m) => completeModules.has(m.key)).length
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
 * Step 1's `computeModuleCompletion` call below does NOT pass a pre-loaded
 * context, unlike step 2's `recomputeMunProgress` — the two loads are
 * unavoidably separate here because step 1 needs to persist and read back
 * BEFORE step 2 recomputes the aggregate from the (now-updated)
 * `mun_module_verifications` rows; step 2 then does its own single batched
 * load internally and reuses it across all 15 modules. Net: two context
 * loads per `onModuleDataChanged` call (one here, one inside
 * `recomputeMunProgress`), not sixteen.
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
 * still incomplete after that first touch — the overwhelmingly common case
 * now that `validate` performs real checks, Task 9) or READY_FOR_SUBMISSION
 * (all 15 required modules already COMPLETE). ONBOARDING is therefore never
 * a transition TARGET of this function — only ACTION_REQUIRED and
 * READY_FOR_SUBMISSION are — which matches the brief's explicit instruction
 * that "ONBOARDING is never transitioned TO by this function." The mun can
 * still return to ONBOARDING via other paths (e.g. an explicit organizer
 * action), just not from here.
 * ---
 */
export async function onModuleDataChanged(munId: string, moduleKey: MunModule, actorId: string, tx?: Tx): Promise<void> {
  // Set inside `run()` when this call is the one that flips the mun to
  // READY_FOR_SUBMISSION (never on a recompute that leaves it there
  // unchanged) — read below, only in the self-transacting branch, to fire
  // the READY_FOR_SUBMISSION pipeline notification after that transaction
  // has actually committed. Every current call site (checked: accommodation,
  // executive-board, mun-branding, mun-config, mun-contact, mun-documents,
  // mun-schedule, payment-settlement, registration-form) calls this with no
  // `tx` argument, so this covers 100% of real usage today; the `tx`-supplied
  // branch below intentionally does not notify (see its comment) since this
  // function can't know when a caller-supplied transaction commits.
  let justBecameReadyForSubmission = false

  const run = async (transaction: Tx): Promise<void> => {
    // Ensure the row exists before computing/persisting against it.
    // `transaction` threaded through — see getModuleVerificationState's
    // docstring for why this matters.
    const moduleRow = await getModuleVerificationState(munId, moduleKey, transaction)

    const [mun] = await transaction.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
    if (!mun) throw new Error('Mun not found')

    // 1. Recompute and persist that ONE module's completion row.
    const moduleResult = await computeModuleCompletion(munId, moduleKey)
    await persistModuleCompletion(transaction, munId, moduleKey, moduleResult, mun.status, moduleRow.state)

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
        if (targetStatus === 'READY_FOR_SUBMISSION') justBecameReadyForSubmission = true
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
    // Caller-supplied transaction: this function can't know when it will
    // commit (that's the caller's own boundary), so — matching every other
    // notify site in this codebase's "never fire before commit" rule — it
    // deliberately does not notify here. Moot today: no real call site
    // passes a `tx` (see the comment above `justBecameReadyForSubmission`).
    await run(tx)
  } else {
    await db.transaction((transaction) => run(transaction))

    // Fired here, after the transaction above has actually committed — same
    // fire-and-forget-with-logging convention as go-live.ts's
    // `notifyAfterCommit` (a notification failure must never surface as a
    // failure of the module write that triggered it).
    if (justBecameReadyForSubmission) {
      resolveMunNotificationContext(munId)
        .then((context) =>
          notifyPipelineEvent({ type: 'READY_FOR_SUBMISSION', munId, organizerEmail: context.organizerEmail, munName: context.munName }),
        )
        .catch((error) => {
          console.error('[module-completion] pipeline notification failed', error)
        })
    }
  }
}
