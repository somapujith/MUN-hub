import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { registrations } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'

/**
 * Registration row joined with everything a dashboard card needs to render:
 * the mun, committee, portfolio, and payment status.
 */
export type RegistrationWithMun = Awaited<ReturnType<typeof fetchRegistrationsForUser>>[number]

const UPCOMING_STATUSES: readonly RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED']
const PAST_STATUSES: readonly RegistrationStatus[] = ['ATTENDED', 'NO_SHOW']

function fetchRegistrationsForUser(userId: string) {
  return db.query.registrations.findMany({
    where: eq(registrations.userId, userId),
    with: {
      mun: true,
      committee: true,
      portfolio: true,
      payment: true,
    },
  })
}

/**
 * Registrations for the current session's user that are still "upcoming":
 * status in (PENDING, PAYMENT_PENDING, CONFIRMED) AND the mun's startDate is
 * in the future.
 *
 * IDOR: the acting user is derived from the caller-supplied `session` —
 * never accept a `userId` parameter from the caller. Throws `Forbidden` if
 * unauthenticated.
 */
export async function getUpcomingRegistrations(session: Session | null): Promise<RegistrationWithMun[]> {
  if (!session) throw new Error('Forbidden')

  const now = new Date()
  const rows = await fetchRegistrationsForUser(session.userId)

  return rows.filter(
    (row) => UPCOMING_STATUSES.includes(row.status) && row.mun.startDate !== null && row.mun.startDate > now,
  )
}

/**
 * Registrations for the current session's user that are "past": status in
 * (ATTENDED, NO_SHOW) OR the mun's startDate is in the past.
 *
 * IDOR: the acting user is derived from the caller-supplied `session` —
 * never accept a `userId` parameter from the caller. Throws `Forbidden` if
 * unauthenticated.
 */
export async function getPastRegistrations(session: Session | null): Promise<RegistrationWithMun[]> {
  if (!session) throw new Error('Forbidden')

  const now = new Date()
  const rows = await fetchRegistrationsForUser(session.userId)

  return rows.filter(
    (row) => PAST_STATUSES.includes(row.status) || (row.mun.startDate !== null && row.mun.startDate < now),
  )
}
