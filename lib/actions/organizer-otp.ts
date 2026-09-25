import crypto from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailLoginCodes, userConsents, users } from '@/lib/db/schema'
import { createSession } from '@/lib/auth/session'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { requiredConsentRows } from '@/lib/actions/auth'
import { getNotificationsAdapter } from '@/lib/notifications/select-adapter'
import { renderOtpEmailHtml, renderOtpEmailText } from '@/lib/notifications/templates/otp-email'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import type { Role } from '@/lib/db/schema-enums'

/**
 * Passwordless organizer sign-in: the organizer enters an email, we email a
 * 6-digit code, and entering that code signs them in — creating their
 * ORGANIZER account on the spot if the address doesn't have one yet. There is
 * no separate "sign up" step: logging in for the first time is how the
 * account comes into existence, and no organizer password anywhere in this
 * flow. A placeholder name is derived from the email; the organizer onboarding
 * wizard's first step (lib/actions/organizer-onboarding.ts) collects their
 * real name and phone right afterwards and overwrites it.
 *
 * Organizer and delegate accounts stay separate: an email that belongs to a
 * delegate (or staff) account never receives a code here; it gets a notice
 * instead, and nothing converts that account into an organizer.
 */

export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000
export const LOGIN_CODE_RESEND_COOLDOWN_MS = 60 * 1000
export const LOGIN_CODE_MAX_PER_HOUR = 5
export const LOGIN_CODE_MAX_ATTEMPTS = 5
const ORGANIZER_SUPPORT_EMAIL = 'organizers@munhub.in'

/** Every message this module throws — server/middleware/error.ts maps each to a status. */
export const ORGANIZER_OTP_ERRORS = {
  cooldown: 'Please wait a minute before requesting another code',
  hourlyLimit: 'Too many codes requested. Try again in an hour',
  deliveryFailed: "We couldn't send the code. Try again in a moment",
  incorrect: 'Incorrect code',
  expired: 'This code has expired. Request a new one',
  tooManyAttempts: 'Too many incorrect attempts. Request a new code',
  delegateAccount: 'This email belongs to a delegate account. Use a different email for your organizer account',
} as const

export interface OrganizerCodeVerification {
  status: 'SIGNED_IN'
  userId: string
  role: Role
  token: string
  expiresAt: Date
  isNewAccount: boolean
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * A reasonable display name derived from the local part of an email address
 * (e.g. `priya.rao+mun@example.com` -> `Priya Rao`), used as a placeholder
 * for a brand-new organizer account until they fill in their real name during
 * onboarding. Falls back to a generic label if nothing usable survives.
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const words = local
    .replace(/\+.*$/, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  return words.join(' ') || 'New Organizer'
}

/**
 * Case-insensitive on the stored side too: `users.email` is unique but
 * case-sensitive, so an older mixed-case row must still be found here rather
 * than letting organizer signup create a second account for the same inbox.
 */
function userEmailMatches(normalizedEmail: string) {
  return sql`lower(${users.email}) = ${normalizedEmail}`
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * Emails a fresh sign-in code to `email`, replacing any code sent before.
 *
 * Resolves the same way whether or not an account exists, and whether it's
 * an organizer or a delegate account, so the response never reveals which
 * addresses are registered. A delegate address gets an explanatory email
 * instead of a code; it still counts toward the resend limits, so this can't
 * be used to flood someone's inbox.
 *
 * Codes are scrypt-hashed (lib/auth/password.ts) — only the email holds the
 * plaintext. Throws `ORGANIZER_OTP_ERRORS.cooldown` / `.hourlyLimit` when the
 * address asked too recently or too often, and `.deliveryFailed` if the email
 * couldn't be sent.
 */
export async function requestOrganizerLoginCode(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  const now = new Date()

  const recent = await db
    .select({ createdAt: emailLoginCodes.createdAt })
    .from(emailLoginCodes)
    .where(
      and(
        eq(emailLoginCodes.email, normalizedEmail),
        gt(emailLoginCodes.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(emailLoginCodes.createdAt))

  if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < LOGIN_CODE_RESEND_COOLDOWN_MS) {
    throw new Error(ORGANIZER_OTP_ERRORS.cooldown)
  }
  if (recent.length >= LOGIN_CODE_MAX_PER_HOUR) {
    throw new Error(ORGANIZER_OTP_ERRORS.hourlyLimit)
  }

  const [existing] = await db
    .select({ role: users.role })
    .from(users)
    .where(userEmailMatches(normalizedEmail))
    .limit(1)
  const belongsToOtherAccount = Boolean(existing) && existing.role !== 'ORGANIZER'

  const code = generateCode()
  const codeHash = await hashPassword(code)

  const [inserted] = await db.transaction(async (tx) => {
    await tx
      .update(emailLoginCodes)
      .set({ consumedAt: now })
      .where(and(eq(emailLoginCodes.email, normalizedEmail), isNull(emailLoginCodes.consumedAt)))
    return tx
      .insert(emailLoginCodes)
      .values({
        email: normalizedEmail,
        codeHash,
        expiresAt: new Date(now.getTime() + LOGIN_CODE_TTL_MS),
        // A delegate address never holds a usable code; the row only exists
        // so the resend limits above apply to it too.
        consumedAt: belongsToOtherAccount ? now : null,
      })
      .returning({ id: emailLoginCodes.id })
  })

  const message: NotificationPayload = belongsToOtherAccount
    ? {
        to: normalizedEmail,
        subject: 'MUN Hub organizer sign-in',
        body:
          "Someone tried to sign in to MUN Hub's organizer workspace with this email address. " +
          'This address is registered as a delegate account, and organizer accounts are separate — ' +
          'to publish a MUN, sign up with a different email address.\n\n' +
          "If this wasn't you, you can ignore this email.",
      }
    : codeEmail(normalizedEmail, code)

  try {
    await getNotificationsAdapter().send(message)
  } catch (error) {
    // Free the address to retry straight away: nothing reached the inbox.
    await db.delete(emailLoginCodes).where(eq(emailLoginCodes.id, inserted.id))
    console.error('[organizer-otp] delivery failed', { error })
    throw new Error(ORGANIZER_OTP_ERRORS.deliveryFailed)
  }
}

/**
 * Checks `code` against the newest code emailed to `email`.
 *
 * - Existing ORGANIZER account: signs in.
 * - No account: creates one on the spot (no password, no student profile,
 *   Terms + Privacy consent recorded, a placeholder name derived from the
 *   email) and signs in. There is no separate signup step.
 *
 * A wrong code counts against `LOGIN_CODE_MAX_ATTEMPTS`; after that the code
 * is dead and a new one must be requested. A code works once. Returns the same
 * session shape as `signIn`; setting the cookie is the caller's job.
 */
export async function verifyOrganizerLoginCode(input: { email: string; code: string }): Promise<OrganizerCodeVerification> {
  const normalizedEmail = normalizeEmail(input.email)
  const code = input.code.trim()
  if (!/^\d{6}$/.test(code)) {
    throw new Error(ORGANIZER_OTP_ERRORS.incorrect)
  }

  const now = new Date()

  type Outcome =
    | { kind: 'error'; message: string }
    | { kind: 'signed-in'; userId: string; role: Role; isNewAccount: boolean }

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [row] = await tx
      .select()
      .from(emailLoginCodes)
      .where(and(eq(emailLoginCodes.email, normalizedEmail), isNull(emailLoginCodes.consumedAt)))
      .orderBy(desc(emailLoginCodes.createdAt))
      .limit(1)
      .for('update')

    if (!row || row.expiresAt.getTime() <= now.getTime()) {
      return { kind: 'error', message: ORGANIZER_OTP_ERRORS.expired }
    }
    if (row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
      return { kind: 'error', message: ORGANIZER_OTP_ERRORS.tooManyAttempts }
    }

    if (!(await verifyPassword(code, row.codeHash))) {
      const attempts = row.attempts + 1
      await tx.update(emailLoginCodes).set({ attempts }).where(eq(emailLoginCodes.id, row.id))
      return {
        kind: 'error',
        message: attempts >= LOGIN_CODE_MAX_ATTEMPTS ? ORGANIZER_OTP_ERRORS.tooManyAttempts : ORGANIZER_OTP_ERRORS.incorrect,
      }
    }

    const consume = () =>
      tx.update(emailLoginCodes).set({ consumedAt: now }).where(eq(emailLoginCodes.id, row.id))

    const [user] = await tx
      .select({ id: users.id, role: users.role, suspended: users.suspended })
      .from(users)
      .where(userEmailMatches(normalizedEmail))
      .limit(1)

    if (user) {
      await consume()
      // Normally unreachable (delegate addresses never get a live code), but
      // an account could have been created for this email after the code went out.
      if (user.role !== 'ORGANIZER') return { kind: 'error', message: ORGANIZER_OTP_ERRORS.delegateAccount }
      if (user.suspended) return { kind: 'error', message: 'Account suspended' }
      return { kind: 'signed-in', userId: user.id, role: user.role, isNewAccount: false }
    }

    const [created] = await tx
      .insert(users)
      .values({ name: nameFromEmail(normalizedEmail), email: normalizedEmail, role: 'ORGANIZER' })
      .returning({ id: users.id, role: users.role })
    await tx.insert(userConsents).values(requiredConsentRows(created.id, now))
    await consume()
    return { kind: 'signed-in', userId: created.id, role: created.role, isNewAccount: true }
  })

  if (outcome.kind === 'error') throw new Error(outcome.message)

  const { token, expiresAt } = await createSession(outcome.userId)
  return {
    status: 'SIGNED_IN',
    userId: outcome.userId,
    role: outcome.role,
    token,
    expiresAt,
    isNewAccount: outcome.isNewAccount,
  }
}

function codeEmail(to: string, code: string): NotificationPayload {
  const template = {
    purpose: 'signing in to MUN Hub for organizers',
    code,
    expiresInMinutes: LOGIN_CODE_TTL_MS / 60_000,
    supportEmail: ORGANIZER_SUPPORT_EMAIL,
  }
  return {
    to,
    // The code stays out of the subject so it doesn't show on a lock screen.
    subject: 'Your MUN Hub sign-in code',
    body: renderOtpEmailText(template),
    html: renderOtpEmailHtml(template),
  }
}
