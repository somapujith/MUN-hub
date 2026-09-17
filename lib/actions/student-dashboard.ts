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
      // Only what the delegate should see: never the platform-fee split or
      // an admin's payment-exception notes.
      payment: { columns: { id: true, amount: true, currency: true, status: true } },
      // Group/delegation registration (2026-09-17): just enough to filter
      // out an unclaimed teammate placeholder below — see isOwnRegistration.
      registrationGroup: { columns: { id: true, headUserId: true, headRegistrationId: true } },
    },
  })
}

/** A cancelled conference is over whatever its dates say; its registrations belong under Past. */
function isConferenceCancelled(row: RegistrationWithMun): boolean {
  return row.mun.status === 'CANCELLED'
}

/**
 * A group/delegation registration creates `teamSize` rows up front, but only
 * one of them is genuinely the head delegate's own registration; the rest
 * are placeholder seats temporarily tagged with the head's `userId` until a
 * teammate accepts an invitation and the row is reassigned to them (see
 * lib/db/schema.ts's registrationGroups header comment).
 *
 * `fetchRegistrationsForUser` already scopes every row to
 * `userId = session.userId`, so the ONLY row this needs to hide is a
 * still-unclaimed placeholder the HEAD is viewing under their own id — never
 * a genuinely claimed row, whoever is now looking at it. The distinguishing
 * signal is comparing `userId` against the group's `headUserId`, not against
 * `headRegistrationId`: a first version of this check compared `row.id` to
 * `headRegistrationId` alone, which also hid an accepted teammate's own
 * registration from THEIR OWN dashboard (their row's id is never
 * `headRegistrationId` either, but it is genuinely theirs).
 */
function isOwnRegistration(row: RegistrationWithMun): boolean {
  if (!row.registrationGroup) return true
  if (row.id === row.registrationGroup.headRegistrationId) return true
  return row.userId !== row.registrationGroup.headUserId
}

/**
 * Registrations for the current session's user that are still "upcoming":
 * status in (PENDING, PAYMENT_PENDING, CONFIRMED) AND the mun's startDate is
 * in the future AND the conference hasn't been cancelled.
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
    (row) =>
      isOwnRegistration(row) &&
      !isConferenceCancelled(row) &&
      UPCOMING_STATUSES.includes(row.status) &&
      row.mun.startDate !== null &&
      row.mun.startDate > now,
  )
}

/**
 * Registrations for the current session's user that are "past": status in
 * (ATTENDED, NO_SHOW) OR the mun's startDate is in the past OR the
 * conference was cancelled (every registration for it, including ones with
 * no dates or dates still ahead — cancelling keeps CONFIRMED seats as they
 * are and releases unpaid holds, and none of them should vanish from the
 * dashboard). The mun row carries `status`, so the client can mark them.
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
    (row) =>
      isOwnRegistration(row) &&
      (isConferenceCancelled(row) || PAST_STATUSES.includes(row.status) || (row.mun.startDate !== null && row.mun.startDate < now)),
  )
}
