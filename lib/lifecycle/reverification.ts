import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, munPaymentSettings } from '@/lib/db/schema'
import type { MunModule, MunStatus } from '@/lib/db/schema-enums'
import { getModuleVerificationState } from './module-verification'
import { transitionMun } from './mun-state-machine'

// Same Drizzle transaction-callback param type used across lib/lifecycle/ —
// kept as a local alias rather than an import so this module doesn't take on
// an extra dependency just for a type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * PRD Section 16 / design doc Section 6's high-impact field list, per
 * module. Exhaustive `Record<MunModule, string[]>` (restored from Task 2's
 * temporary `Partial<>` widening) — every one of the 19 `MunModule` enum
 * values (15 PRD-key tracked modules + 4 legacy pre-PRD keys) MUST have an
 * entry, even if that entry is `[]`. This is a deliberate forcing function:
 * adding a 16th module key to the enum without adding a row here is now a
 * COMPILE ERROR, not a silent "no field on this module ever triggers
 * re-verification" gap that only shows up as a missed fraud/data-integrity
 * case in production.
 *
 * `BRANDING`/`REGISTRATION_FORM`/`FINAL_REVIEW` are deliberately `[]` — see
 * design doc Section 6 ("a logo swap forcing a live mun back into review
 * would make organizers avoid fixing a bad logo"). `REGISTRATION_FORM` has
 * one structural exception (field deletion / optional-to-required flip)
 * that this pure field-diff function cannot see — handled directly in
 * lib/actions/registration-form.ts, not here (see that file's comment).
 *
 * Also doubles (via `isHighImpactModule` below) as the source of truth for
 * which modules get LOCKED-state enforcement during active review (Task 12
 * Step 4) — a module whose list here is non-empty is exactly a module whose
 * data organizers must not be able to silently change out from under an
 * in-progress review.
 */
const HIGH_IMPACT_FIELDS: Record<MunModule, string[]> = {
  BASIC_INFO: ['name', 'edition'],
  DATES_VENUE: ['startDate', 'endDate', 'venue', 'city', 'country', 'registrationDeadline'],
  BRANDING: [],
  COMMITTEES: ['name', 'capacity', 'agenda'],
  PORTFOLIOS: ['name', 'availability'],
  EXECUTIVE_BOARD: ['name', 'role', 'committeeId'],
  REGISTRATION_TYPES: ['name', 'registrationType', 'status'],
  REGISTRATION_FORM: [],
  PRICING_CAPACITY: ['price', 'capacity', 'deadline', 'earlyBirdPrice', 'earlyBirdDeadline'],
  PAYMENT_SETTLEMENT: [
    'accountNumberLast4',
    'ifsc',
    'legalName',
    'panLast4',
    'refundPolicy',
    'gateway',
    'currency',
  ],
  RULES_DOCUMENTS: ['url'],
  SCHEDULE: ['startsAt', 'endsAt'],
  ACCOMMODATION: ['price', 'capacity', 'name', 'status'],
  CONTACT: ['officialEmail', 'phone'],
  FINAL_REVIEW: [],
  // Legacy pre-PRD keys (retained, remapped via drizzle/0010) — kept
  // resolving to empty lists so old rows/tests still work, not deleted.
  mun_details: [],
  committees: [],
  portfolios: [],
  registration_products: [],
}

const POST_VERIFICATION_STATUSES: MunStatus[] = [
  'VERIFIED',
  'PUBLISHED',
  'UNPUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
]

/**
 * True iff `moduleName` has a non-empty `HIGH_IMPACT_FIELDS` list — i.e. it
 * is one of the modules `assertModuleNotLocked` (module-completion.ts)
 * enforces LOCKED-state edit rejection for during active review. Exported
 * so the locking logic has exactly one source of truth for "which modules
 * count as high-impact", rather than a second hardcoded module list drifting
 * out of sync with this file's real `HIGH_IMPACT_FIELDS` table.
 */
export function isHighImpactModule(moduleName: MunModule): boolean {
  return (HIGH_IMPACT_FIELDS[moduleName] ?? []).length > 0
}

/**
 * Pure function — no I/O. Compares only the fields on `HIGH_IMPACT_FIELDS`
 * for the given module between two field snapshots.
 */
export function detectHighImpactChange(
  moduleName: MunModule,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  const fields = HIGH_IMPACT_FIELDS[moduleName] ?? []
  return fields.some((field) => {
    if (!(field in after)) return false
    const beforeValue = before[field]
    const afterValue = after[field]
    if (beforeValue instanceof Date && afterValue instanceof Date) {
      return beforeValue.getTime() !== afterValue.getTime()
    }
    return beforeValue !== afterValue
  })
}

/**
 * Called from mun-config.ts's update actions after a successful update, and
 * from `onModuleDataChanged` (module-completion.ts). If the change is
 * high-impact AND the mun has already passed verification (VERIFIED or
 * later), flips the affected module back to PENDING_REVIEW and the mun back
 * to VERIFICATION (PRD Section 16's re-verification flow). A no-op if the
 * mun hasn't been verified yet — there's nothing to "re"-verify.
 *
 * Accepts an optional `tx` (Drizzle transaction) — when given, every read
 * and write here (including the `transitionMun` call) runs against it
 * instead of the module-level `db` singleton, so this function's effects
 * participate in and roll back with the caller's transaction. Defaults to
 * `db` when omitted, preserving the exact standalone behavior every existing
 * caller already relies on. Added alongside the same fix in
 * `getModuleVerificationState` (module-verification.ts) — both were
 * previously called by `onModuleDataChanged` without threading its `tx`
 * through, a real atomicity gap for the first caller that wraps
 * `onModuleDataChanged` in an outer transaction (Task 10's
 * `submitMunForReview`, per the plan).
 *
 * Fixed latent bug (Task 12): the module-state `UPDATE ... WHERE
 * moduleName = ...` used to run directly with no guarantee a row existed
 * for that (munId, moduleName) pair yet — a module never touched by the
 * organizer (no lazy-create ever ran for it) meant this UPDATE silently
 * matched zero rows, and the module's `state` stayed whatever it was
 * (frequently NOT_SUBMITTED) instead of flipping to PENDING_REVIEW, even
 * though the mun itself still correctly moved back to VERIFICATION. Now
 * routes through `getModuleVerificationState(munId, moduleName, tx)` first
 * so the row is guaranteed to exist before the UPDATE runs. Note this call
 * is intentionally given `tx` (not `client`) — `getModuleVerificationState`
 * only accepts an actual Drizzle transaction (or nothing, defaulting to the
 * module-level `db`), not the base `db` client typed as a transaction.
 *
 * Payment-change special case (Task 12, design doc Section 6): when the
 * high-impact change is on `PAYMENT_SETTLEMENT`, this is the single
 * highest-consequence entry in the whole re-verification table — the fraud
 * vector is getting approved with a clean bank account, then swapping in a
 * different one post-approval. So in addition to the generic module/mun
 * flip, this ALSO resets `mun_payment_settings.verificationState` back to
 * `PENDING` for this mun, inside the SAME transaction as the module state
 * flip — there must never be a window where the account still reads as
 * VERIFIED while the module itself is back under review.
 */
export async function triggerReverificationIfNeeded(
  moduleName: MunModule,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  munId: string,
  actorId: string,
  tx?: Tx,
): Promise<void> {
  if (!detectHighImpactChange(moduleName, before, after)) return

  const client = tx ?? db

  const [mun] = await client.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || !POST_VERIFICATION_STATUSES.includes(mun.status)) return

  // Ensure the module's verification row exists before updating it — fixes
  // the latent no-op bug described above.
  await getModuleVerificationState(munId, moduleName, tx)

  await client
    .update(munModuleVerifications)
    .set({ state: 'PENDING_REVIEW', updatedAt: new Date() })
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))

  // Payment-change special case — see docstring. Runs against the same
  // `client` (tx when given) as the module flip above, so both writes commit
  // or roll back together with no intermediate inconsistent state.
  if (moduleName === 'PAYMENT_SETTLEMENT') {
    await client
      .update(munPaymentSettings)
      .set({ verificationState: 'PENDING', verifiedAt: null, verifiedBy: null, updatedAt: new Date() })
      .where(eq(munPaymentSettings.munId, munId))
  }

  if (mun.status !== 'VERIFICATION') {
    await transitionMun(
      munId,
      'VERIFICATION',
      actorId,
      `Re-verification triggered by high-impact change to ${moduleName}`,
      undefined,
      tx,
    )
  }
}

/**
 * Directly forces the module/mun back into re-verification for a change
 * `detectHighImpactChange` structurally cannot see — a field DELETION, or an
 * optional-to-required flip, on the REGISTRATION_FORM module (design doc
 * Section 6). Deliberately bypasses the pure before/after diff detector and
 * goes straight to the same effect `triggerReverificationIfNeeded` produces
 * once `detectHighImpactChange` would have returned true, given the mun is
 * already post-VERIFIED — see lib/actions/registration-form.ts's
 * `deleteFormField`/`updateFormField` for the call sites and the fuller
 * explanation of why this exception exists.
 *
 * `moduleName` is accepted as a parameter (rather than hardcoding
 * REGISTRATION_FORM) so this stays reusable for any future module that runs
 * into the same "pure diff can't see it" problem, without tying this helper
 * to one specific module.
 */
export async function forceReverification(moduleName: MunModule, munId: string, actorId: string, tx?: Tx): Promise<void> {
  const client = tx ?? db

  const [mun] = await client.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || !POST_VERIFICATION_STATUSES.includes(mun.status)) return

  await getModuleVerificationState(munId, moduleName, tx)

  await client
    .update(munModuleVerifications)
    .set({ state: 'PENDING_REVIEW', updatedAt: new Date() })
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))

  if (mun.status !== 'VERIFICATION') {
    await transitionMun(
      munId,
      'VERIFICATION',
      actorId,
      `Re-verification forced by structural change to ${moduleName}`,
      undefined,
      tx,
    )
  }
}

export { POST_VERIFICATION_STATUSES }
