import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import type { Session } from './adapter'

// -----------------------------------------------------------------------------
// Shared ownership check
// -----------------------------------------------------------------------------
//
// Every organizer-facing mutation across the module action files is gated by
// the same rule: the acting session must either be the owning organizer of
// the mun (walked up from committee -> mun, portfolio -> committee -> mun, or
// any other child entity -> mun when the mutated row isn't the mun itself) or
// hold role ADMIN/SUPER_ADMIN. This helper is the single place that logic
// lives — do not re-implement it per entity or per file. Previously
// duplicated verbatim in lib/actions/mun-config.ts, lib/actions/
// accommodation.ts, and lib/lifecycle/module-verification.ts; extracted here
// per design doc Section 8, security invariant #2 (PRD Section 40.6 — one
// place for the IDOR rule).

/**
 * Throws `Error('Forbidden')` unless `session` is non-null and is either an
 * ADMIN/SUPER_ADMIN or the organizer that owns `munId` (`mun.organizerId ===
 * session.userId`). Throws `Error('Mun not found')` if `munId` doesn't
 * resolve to a real row (fail fast on a bad id rather than silently denying).
 */
export async function assertOwnsOrAdmin(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return

  const [mun] = await db.select({ organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')

  if (mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}
