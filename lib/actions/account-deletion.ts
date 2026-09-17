import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  emailLoginCodes,
  muns,
  passwordResetTokens,
  registrations,
  sessions,
  studentProfiles,
  users,
} from '@/lib/db/schema'
import { recordAdminAction } from '@/lib/audit/log'
import { verifyPassword } from '@/lib/auth/password'
import type { RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'

/**
 * Self-service account deletion for delegates (audit finding "no
 * deletion/export"; Privacy Policy "Ask for deletion ... except for records we
 * must keep by law").
 *
 * Deletion is an anonymization, not a row delete: registrations and payments
 * are financial records we keep (and `registrations.userId` is a NOT NULL FK),
 * so the `users` row stays as the anchor they point at, stripped of
 * everything that identifies the person and unable to sign in again.
 *
 * What happens, in one transaction:
 * - `users`: name → "Deleted user", email → deleted+<userId>@deleted.invalid,
 *   phone / institution / username / profile image / password hash → null,
 *   email notifications → off.
 * - Deleted: the student_profiles row, every session, every password reset
 *   token, and any sign-in codes sent to the old address.
 * - Unpaid seat holds (PENDING / PAYMENT_PENDING) are cancelled, releasing the
 *   seat. A payment that still completes afterwards is handled like any other
 *   late payment: the webhook records a payment exception for an admin. There
 *   are no refunds.
 * - Registrations and payments are kept, linked to the anonymized user.
 * - Registration answers (`formResponses` and `accommodationAnswers`) are
 *   cleared, EXCEPT on a seat the organizer still has to run: a CONFIRMED (or
 *   already checked-in, ATTENDED) registration for a conference that hasn't
 *   ended. Those answers hold the emergency contact, dietary and travel
 *   details the organizer needs on the day, and the delegate may still turn
 *   up. See `retainsRegistrationAnswers` for the exact rule. The kept answers
 *   are not kept forever: lib/jobs/purge-deleted-user-answers.ts re-applies
 *   the same predicate on a schedule and clears them once the conference is
 *   over, which is what the deletion screen promises.
 * - Kept as-is: consent records (proof of what was agreed and when),
 *   support tickets and their messages (they can concern payment exceptions an
 *   admin still has to resolve).
 * - Recorded: one ACCOUNT_DELETED admin_actions row (actor = the account
 *   itself), with the counts below and no personal data.
 *
 * Organizer and staff accounts can't delete themselves here: they own
 * conferences, payouts, or admin history that need a person to hand over.
 */

export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE'

export const DELETED_USER_NAME = 'Deleted user'

/** Every message this module throws — server/routes/account.ts maps each to a status. */
export const ACCOUNT_DELETION_ERRORS = {
  confirmation: `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm account deletion`,
  password: 'Password is incorrect',
  notSelfService:
    "Organizer and staff accounts can't be deleted from the website. Email support@munhub.in and we'll help you close it.",
} as const

/**
 * How long after a conference's last day its registration answers are still
 * treated as "in use". Conference dates are stored as timestamps that often
 * sit at the start of the day, so a same-day comparison would clear answers
 * while the final day is still running.
 */
const CONFERENCE_END_GRACE_MS = 24 * 60 * 60 * 1000

const RETAINED_ANSWER_STATUSES: readonly RegistrationStatus[] = ['CONFIRMED', 'ATTENDED']
const UNPAID_HOLD_STATUSES: RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING']

export function deletedUserEmail(userId: string): string {
  return `deleted+${userId}@deleted.invalid`
}

/**
 * SQL LIKE pattern matching every address `deletedUserEmail` produces, i.e.
 * every anonymized account. There is no `users.deletedAt` column (adding one
 * needs a migration), so the rewritten address is the marker.
 * lib/jobs/purge-deleted-user-answers.ts uses it to find the answers this
 * module deliberately kept, once the conference they were kept for is over.
 */
export const DELETED_USER_EMAIL_PATTERN = 'deleted+%@deleted.invalid'

/**
 * Whether a registration's answers survive the delegate's account deletion:
 * only for a seat that is CONFIRMED (or ATTENDED) at a conference that hasn't
 * ended. The conference end is `endDate`, falling back to `startDate`; a
 * conference with neither date is treated as not ended (the organizer may
 * still need the answers).
 */
export function retainsRegistrationAnswers(
  registration: { status: RegistrationStatus; munStartDate: Date | null; munEndDate: Date | null },
  now: Date,
): boolean {
  if (!RETAINED_ANSWER_STATUSES.includes(registration.status)) return false
  const conferenceEnd = registration.munEndDate ?? registration.munStartDate
  if (!conferenceEnd) return true
  return conferenceEnd.getTime() + CONFERENCE_END_GRACE_MS > now.getTime()
}

export interface DeleteAccountInput {
  confirmation: string
  password: string
}

export interface AccountDeletionResult {
  userId: string
  sessionsRevoked: number
  unpaidHoldsCancelled: number
  registrationsKept: number
  registrationAnswersCleared: number
  registrationAnswersRetained: number
}

/**
 * Deletes (anonymizes) the signed-in delegate's account after re-checking the
 * typed confirmation and the account password. Identity comes only from
 * `session`.
 *
 * Throws `ACCOUNT_DELETION_ERRORS.confirmation` unless `confirmation` is
 * exactly "DELETE", `ACCOUNT_DELETION_ERRORS.notSelfService` for any role
 * other than STUDENT, `ACCOUNT_DELETION_ERRORS.password` for a wrong password
 * (or an account with no password), and `Error('Account not found')` if the
 * session's user no longer exists.
 *
 * Does not touch cookies — the HTTP layer clears the session cookie.
 */
export async function deleteOwnAccount(
  input: DeleteAccountInput,
  session: Session,
  now: Date = new Date(),
): Promise<AccountDeletionResult> {
  if (input.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    throw new Error(ACCOUNT_DELETION_ERRORS.confirmation)
  }

  const [user] = await db
    .select({ id: users.id, role: users.role, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!user) {
    throw new Error('Account not found')
  }
  // The stored role is authoritative, not the one cached on the session.
  if (user.role !== 'STUDENT') {
    throw new Error(ACCOUNT_DELETION_ERRORS.notSelfService)
  }
  if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new Error(ACCOUNT_DELETION_ERRORS.password)
  }

  const result = await db.transaction(async (tx) => {
    // Serializes against a concurrent role change or a second deletion.
    const [locked] = await tx
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, user.id))
      .for('update')
    if (!locked || locked.role !== 'STUDENT') {
      throw new Error(ACCOUNT_DELETION_ERRORS.notSelfService)
    }

    await tx
      .update(users)
      .set({
        name: DELETED_USER_NAME,
        email: deletedUserEmail(user.id),
        phone: null,
        institution: null,
        username: null,
        profileImage: null,
        passwordHash: null,
        emailNotificationsEnabled: false,
      })
      .where(eq(users.id, user.id))

    await tx.delete(studentProfiles).where(eq(studentProfiles.userId, user.id))
    const revokedSessions = await tx
      .delete(sessions)
      .where(eq(sessions.userId, user.id))
      .returning({ id: sessions.id })
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
    await tx
      .delete(emailLoginCodes)
      .where(sql`lower(${emailLoginCodes.email}) = ${locked.email.trim().toLowerCase()}`)

    const cancelledHolds = await tx
      .update(registrations)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(and(eq(registrations.userId, user.id), inArray(registrations.status, UNPAID_HOLD_STATUSES)))
      .returning({ id: registrations.id })

    const userRegistrations = await tx
      .select({
        id: registrations.id,
        status: registrations.status,
        hasAnswers: sql<boolean>`(${registrations.formResponses} is not null or ${registrations.accommodationAnswers} is not null)`,
        munStartDate: muns.startDate,
        munEndDate: muns.endDate,
      })
      .from(registrations)
      .innerJoin(muns, eq(registrations.munId, muns.id))
      .where(eq(registrations.userId, user.id))

    const withAnswers = userRegistrations.filter((registration) => registration.hasAnswers)
    const toClear = withAnswers.filter((registration) => !retainsRegistrationAnswers(registration, now))
    if (toClear.length > 0) {
      await tx
        .update(registrations)
        .set({ formResponses: null, accommodationAnswers: null, updatedAt: now })
        .where(
          inArray(
            registrations.id,
            toClear.map((registration) => registration.id),
          ),
        )
    }

    const summary: AccountDeletionResult = {
      userId: user.id,
      sessionsRevoked: revokedSessions.length,
      unpaidHoldsCancelled: cancelledHolds.length,
      registrationsKept: userRegistrations.length,
      registrationAnswersCleared: toClear.length,
      registrationAnswersRetained: withAnswers.length - toClear.length,
    }

    // Audit row in the same transaction. The actor is the deleted account
    // itself (its anonymized users row stays, so the FK holds); no personal
    // data, only counts.
    await recordAdminAction(tx, user.id, 'ACCOUNT_DELETED', 'user', user.id, undefined, {
      actor: 'self',
      role: user.role,
      sessionsRevoked: summary.sessionsRevoked,
      unpaidHoldsCancelled: summary.unpaidHoldsCancelled,
      registrationsKept: summary.registrationsKept,
      registrationAnswersCleared: summary.registrationAnswersCleared,
      registrationAnswersRetained: summary.registrationAnswersRetained,
    })

    return summary
  })

  return result
}
