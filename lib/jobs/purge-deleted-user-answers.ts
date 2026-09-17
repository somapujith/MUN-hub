import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrations, users } from '@/lib/db/schema'
import { DELETED_USER_EMAIL_PATTERN, retainsRegistrationAnswers } from '@/lib/actions/account-deletion'

/**
 * Finishes the erasure `deleteOwnAccount` deliberately left half-done.
 *
 * Deleting an account anonymizes the user row but keeps the registration
 * answers for a seat the organizer still has to run — a CONFIRMED (or
 * ATTENDED) registration at a conference that hasn't ended. Those answers
 * hold the emergency contact, date of birth, address and dietary/travel
 * details, and the deletion screen promises they are kept only "until the
 * conference is over". Nothing used to clear them afterwards, so they stayed
 * in organizer roster exports and staff PII reads for good, which is not the
 * DPDP erasure right the copy describes.
 *
 * This runs on the cron trigger and clears them as soon as
 * `retainsRegistrationAnswers` — the very same predicate the deletion path
 * uses, so the two rules cannot drift — stops holding.
 *
 * Anonymized accounts are found by the address `deletedUserEmail` rewrites
 * them to; there is no `users.deletedAt` column and adding one would need a
 * migration.
 *
 * Idempotent: a row it clears no longer has answers, so the next run skips it.
 */
export interface PurgeDeletedUserAnswersResult {
  /** Registrations whose retained answers were cleared by this run. */
  registrationsCleared: number
}

export async function purgeDeletedUserAnswers(now: Date): Promise<PurgeDeletedUserAnswersResult> {
  const candidates = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      munStartDate: muns.startDate,
      munEndDate: muns.endDate,
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(
      and(
        like(users.email, DELETED_USER_EMAIL_PATTERN),
        sql`(${registrations.formResponses} is not null or ${registrations.accommodationAnswers} is not null)`,
      ),
    )

  const expired = candidates.filter((registration) => !retainsRegistrationAnswers(registration, now))
  if (expired.length === 0) return { registrationsCleared: 0 }

  await db
    .update(registrations)
    .set({ formResponses: null, accommodationAnswers: null, updatedAt: now })
    .where(
      inArray(
        registrations.id,
        expired.map((registration) => registration.id),
      ),
    )

  return { registrationsCleared: expired.length }
}
