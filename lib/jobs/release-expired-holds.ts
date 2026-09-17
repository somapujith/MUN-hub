import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { registrations } from '@/lib/db/schema'
import { notifySeatHoldExpired } from '@/lib/notifications/registration-events'
import type { RegistrationStatus } from '@/lib/types'
import type { ScheduledJob } from './types'

/**
 * Only holds that expired within this long before the run get a "your seat
 * hold expired" email. Older expired holds (a backlog from before this job
 * existed, or after an outage) are still released, just silently: an email
 * days after the fact helps nobody.
 */
export const SEAT_HOLD_EXPIRED_NOTIFY_WINDOW_MS = 60 * 60 * 1000

export interface ReleasedHolds {
  /** Released PAYMENT_PENDING registrations: the delegate had reached checkout. */
  paymentPending: Array<{ id: string; expiresAt: Date | null }>
  /** How many released registrations were still PENDING (no order created yet). */
  pending: number
}

async function releaseWithStatus(status: RegistrationStatus, now: Date) {
  return db
    .update(registrations)
    .set({ status: 'CANCELLED', updatedAt: now })
    .where(and(eq(registrations.status, status), lt(registrations.expiresAt, now)))
    .returning({ id: registrations.id, expiresAt: registrations.expiresAt })
}

/**
 * Cancels every PENDING/PAYMENT_PENDING registration whose seat hold has
 * expired, across all products (the same set as RELEASABLE_STATUSES in
 * lib/actions/registration.ts, which isn't exported there).
 *
 * lib/actions/registration.ts already does this lazily, but only for the one
 * product or MUN a request touches (`releaseExpiredReservations` takes a
 * product id), so an expired hold kept counting against capacity until
 * someone next registered for or viewed that product. This is the same
 * update without the product filter, run once per status so the caller
 * knows which released rows had reached checkout. It's idempotent: a
 * released row is CANCELLED and no longer matches. A payment that arrives
 * after its hold was released is handled by the payments webhook, same as
 * with the lazy sweep.
 */
export async function releaseExpiredHoldRows(now: Date = new Date()): Promise<ReleasedHolds> {
  const paymentPending = await releaseWithStatus('PAYMENT_PENDING', now)
  const pending = await releaseWithStatus('PENDING', now)
  return { paymentPending, pending: pending.length }
}

/** `releaseExpiredHoldRows`, returning only how many holds were released. */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<number> {
  const released = await releaseExpiredHoldRows(now)
  return released.paymentPending.length + released.pending
}

/** Whether a released hold expired recently enough to still email the delegate about it. */
export function isRecentlyExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt != null && expiresAt.getTime() >= now.getTime() - SEAT_HOLD_EXPIRED_NOTIFY_WINDOW_MS
}

/**
 * Sends the seat-hold-expired email for each recently expired checkout hold
 * and returns how many lookups/sends failed. Never throws: failures are
 * logged. (A delegate who turned optional emails off is skipped inside
 * notifySeatHoldExpired and isn't a failure.) Also used by the lazy sweep in
 * lib/actions/registration.ts, so a hold gets the email from whichever
 * releases it first.
 */
export async function notifyExpiredCheckouts(recent: ReadonlyArray<{ id: string }>): Promise<number> {
  const outcomes = await Promise.allSettled(recent.map((row) => notifySeatHoldExpired(row.id)))
  let failed = 0
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      failed += 1
      console.error('[release-expired-holds] seat-hold-expired email failed', {
        registrationId: recent[index].id,
        error: outcome.reason,
      })
    }
  })
  return failed
}

export const releaseExpiredHoldsJob: ScheduledJob = {
  name: 'releaseExpiredHolds',
  async run({ now }) {
    const released = await releaseExpiredHoldRows(now)
    const recent = released.paymentPending.filter((row) => isRecentlyExpired(row.expiresAt, now))
    const notifyFailures = await notifyExpiredCheckouts(recent)
    return {
      released: released.paymentPending.length + released.pending,
      expiredCheckoutsNotified: recent.length - notifyFailures,
      notifyFailures,
    }
  },
}
