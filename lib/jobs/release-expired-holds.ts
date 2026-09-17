import { and, inArray, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { registrations } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/types'
import type { ScheduledJob } from './types'

// Same set as RELEASABLE_STATUSES in lib/actions/registration.ts (not
// exported there).
const RELEASABLE_STATUSES: RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING']

/**
 * Cancels every PENDING/PAYMENT_PENDING registration whose seat hold has
 * expired, across all products, and returns how many were released.
 *
 * lib/actions/registration.ts already does this lazily, but only for the one
 * product or MUN a request touches (`releaseExpiredReservations` takes a
 * product id), so an expired hold kept counting against capacity until
 * someone next registered for or viewed that product. This is the same
 * update without the product filter. It's idempotent: a released row is
 * CANCELLED and no longer matches. A payment that arrives after its hold was
 * released is handled by the payments webhook, same as with the lazy sweep.
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<number> {
  const released = await db
    .update(registrations)
    .set({ status: 'CANCELLED', updatedAt: now })
    .where(and(inArray(registrations.status, RELEASABLE_STATUSES), lt(registrations.expiresAt, now)))
    .returning({ id: registrations.id })

  return released.length
}

export const releaseExpiredHoldsJob: ScheduledJob = {
  name: 'releaseExpiredHolds',
  async run({ now }) {
    return { released: await releaseExpiredHolds(now) }
  },
}
