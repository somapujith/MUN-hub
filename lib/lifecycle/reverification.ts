import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications } from '@/lib/db/schema'
import type { MunModule, MunStatus } from '@/lib/db/schema-enums'
import { transitionMun } from './mun-state-machine'

// Same Drizzle transaction-callback param type used across lib/lifecycle/ —
// kept as a local alias rather than an import so this module doesn't take on
// an extra dependency just for a type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// TODO(Task 12): restore to exhaustive Record<MunModule, string[]> once
// HIGH_IMPACT_FIELDS covers all 15 modules. Widened to Partial here because
// Task 2 added 15 new MunModule keys and Task 12 owns filling in their real
// high-impact field lists; a missing key is treated as an empty list (no
// field ever triggers re-verification for a module not yet listed here).
/** PRD Section 16's high-impact field list, per module. */
const HIGH_IMPACT_FIELDS: Partial<Record<MunModule, string[]>> = {
  mun_details: ['name', 'startDate', 'endDate', 'venue'],
  committees: ['name', 'capacity'],
  portfolios: ['availability'],
  registration_products: ['price', 'capacity', 'deadline'],
}

const POST_VERIFICATION_STATUSES: MunStatus[] = ['VERIFIED', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED']

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

  await client
    .update(munModuleVerifications)
    .set({ state: 'PENDING_REVIEW', updatedAt: new Date() })
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))

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
