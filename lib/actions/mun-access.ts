import { eq } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'

// -----------------------------------------------------------------------------
// mun-access — narrower access rules for organizer operations
// -----------------------------------------------------------------------------
//
// `assertOwnsOrAdmin` (lib/auth/ownership.ts) stays the rule for editing a
// MUN's configuration. Two organizer-operations surfaces need a different
// line, so they get their own helpers here rather than a widened/narrowed
// copy of that rule inline:
//
// - `assertMunOwner` — owning organizer only. Used for the reads and actions
//   that hand out delegates' personal data in bulk or speak on the MUN's
//   behalf: the roster detail drawer, the CSV export, and delegate email.
//   Platform staff have their own audited admin tools for delegate records;
//   an unlogged staff read of a MUN's full delegate PII is exactly the gap
//   the security audit flagged.
// - `assertMunOwnerOrStaff` — owning organizer or platform staff
//   (OPERATIONS/ADMIN/SUPER_ADMIN). Used for conference-day operations
//   (check-in, attendance), where MUNHub staff may be helping at the door.
//
// Both return the session narrowed to non-null (an async function can't be a
// TypeScript assertion signature).

const STAFF_ROLES: readonly Role[] = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

async function loadOrganizerId(munId: string): Promise<string> {
  const [mun] = await db.select({ organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  return mun.organizerId
}

/** Throws `Forbidden` unless `session` is the organizer that owns `munId` (`Mun not found` for a bad id). */
export async function assertMunOwner(munId: string, session: Session | null): Promise<Session> {
  if (!session) throw new Error('Forbidden')
  const organizerId = await loadOrganizerId(munId)
  if (organizerId !== session.userId) throw new Error('Forbidden')
  return session
}

/** Throws `Forbidden` unless `session` owns `munId` or holds a platform staff role. */
export async function assertMunOwnerOrStaff(munId: string, session: Session | null): Promise<Session> {
  if (!session) throw new Error('Forbidden')
  const organizerId = await loadOrganizerId(munId)
  if (organizerId !== session.userId && !STAFF_ROLES.includes(session.role)) throw new Error('Forbidden')
  return session
}
