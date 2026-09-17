import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { studentProfiles, userConsents, users } from '@/lib/db/schema'
import { createSession, destroySession } from '@/lib/auth/session'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { buildOptionalProfileFields, required } from '@/lib/actions/student-profile'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import type { StudentProfileInput } from '@/lib/types/student-profile'

/**
 * The current policy versions consent is recorded against
 * (docs/prd/MUNHub_User_Workflow_PRD.md §15: "stored with timestamp and
 * policy/version information"). Bump these when the actual ToS/Privacy
 * Policy text changes — existing users' consent rows stay as historical
 * record of what they agreed to; nothing re-prompts them retroactively.
 */
export const CURRENT_TERMS_OF_SERVICE_VERSION = '2026-09-17'
export const CURRENT_PRIVACY_POLICY_VERSION = '2026-09-17'

/**
 * Everything `signUp` needs: account credentials, the profile fields
 * `completeStudentProfile` requires (collected up front instead of at the
 * registration-gate, per PRD §7-17), plus required consent. `gender` is
 * required here specifically (PRD §9), even though it's optional on the
 * shared `StudentProfileInput` type used for later profile editing.
 */
export interface SignUpInput extends StudentProfileInput {
  name: string
  email: string
  password: string
  gender: string
  acceptedTermsOfService: boolean
  acceptedPrivacyPolicy: boolean
  /** Only meaningful (and only ever recorded) when true — no row is written for a declined/absent guardian ack. */
  acceptedGuardianAcknowledgement?: boolean
}

const MIN_PASSWORD_LENGTH = 8

/**
 * Real password sign-in (replaces the old email-only mock). Looks up the
 * user by email and verifies `password` against `users.passwordHash` with a
 * timing-safe scrypt comparison (`lib/auth/password.ts`).
 *
 * Throws the same generic `Error('Invalid email or password')` whether the
 * email doesn't exist or the password is wrong — and also when the account
 * predates real signup and has no `passwordHash` at all — so a caller can
 * never use response differences to enumerate valid emails.
 *
 * Throws `Error('Account suspended')` if the matched user is suspended.
 *
 * Creates a session row via `createSession` and returns the raw token +
 * expiry. Does NOT touch cookies — the caller (an HTTP-layer route handler)
 * is responsible for setting the session cookie using the returned
 * `token`/`expiresAt`.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)

  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error('Invalid email or password')
  }

  if (user.suspended) {
    throw new Error('Account suspended')
  }

  const { token, expiresAt } = await createSession(user.id)

  return { userId: user.id, role: user.role, token, expiresAt }
}

/**
 * Creates a new STUDENT account with a hashed password, its participant
 * profile, and required consent records — all in one transaction, per
 * docs/prd/MUNHub_User_Workflow_PRD.md §16 ("Account/profile creation must
 * be transactional enough to avoid misleading half-created accounts") — and
 * signs them in immediately (same return shape as `signIn`, same
 * cookie-setting responsibility left to the caller).
 *
 * Required-field validation mirrors `completeStudentProfile`'s exactly
 * (same `required()` helper), plus `gender` and both consent checkboxes,
 * which are new requirements this PRD adds specifically to signup. Every
 * other `StudentProfileInput` field is optional, same as profile editing
 * later.
 *
 * Self-serve signup only ever creates STUDENT accounts — organizer accounts
 * are provisioned through the separate organizer-application flow
 * (`lib/actions/organizer-application.ts`), not this path.
 *
 * Throws `Error('An account with that email already exists')` on a
 * duplicate email, `Error('Password must be at least 8 characters')` for a
 * too-short password, and a plain `Error` naming the first missing required
 * profile/consent field otherwise.
 */
export async function signUp(
  input: SignUpInput,
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const trimmedName = required(input.name, 'Name')
  const normalizedEmail = input.email.trim().toLowerCase()
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const gender = required(input.gender, 'Gender')
  const phone = required(input.phone, 'Phone number')
  const institution = required(input.institution, 'School or institution')
  const gradeOrYear = required(input.gradeOrYear, 'Grade / year')
  const residentialAddress = required(input.residentialAddress, 'Residential address')
  const emergencyContactName = required(input.emergencyContactName, 'Emergency contact name')
  const emergencyContactPhone = required(input.emergencyContactPhone, 'Emergency contact phone')
  const emergencyContactRelation = required(
    input.emergencyContactRelation,
    'Emergency contact relation',
  )

  if (!input.dateOfBirth.trim()) {
    throw new Error('Date of birth is required')
  }
  const dateOfBirth = new Date(input.dateOfBirth)
  if (Number.isNaN(dateOfBirth.getTime())) {
    throw new Error('Date of birth is invalid')
  }

  if (!input.acceptedTermsOfService) {
    throw new Error('You must accept the Terms of Service to create an account')
  }
  if (!input.acceptedPrivacyPolicy) {
    throw new Error('You must accept the Privacy Policy to create an account')
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
  if (existing) {
    throw new Error('An account with that email already exists')
  }

  const passwordHash = await hashPassword(input.password)
  const optionalFields = buildOptionalProfileFields(input)
  const now = new Date()

  const user = await db.transaction(async (tx) => {
    const [createdUser] = await tx
      .insert(users)
      .values({ name: trimmedName, email: normalizedEmail, phone, institution, passwordHash, role: 'STUDENT' })
      .returning()

    await tx.insert(studentProfiles).values({
      userId: createdUser.id,
      dateOfBirth,
      gradeOrYear,
      residentialAddress,
      requiresTransportation: input.requiresTransportation ?? false,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      munExperience: input.munExperience?.trim() || null,
      referralCode: input.referralCode?.trim() || null,
      ...optionalFields,
      gender,
    })

    const consentRows = requiredConsentRows(createdUser.id, now)
    if (input.acceptedGuardianAcknowledgement) {
      consentRows.push({
        userId: createdUser.id,
        consentType: 'GUARDIAN_ACKNOWLEDGEMENT' as const,
        policyVersion: CURRENT_TERMS_OF_SERVICE_VERSION,
        acceptedAt: now,
      })
    }
    await tx.insert(userConsents).values(consentRows)

    return createdUser
  })

  const { token, expiresAt } = await createSession(user.id)

  return { userId: user.id, role: user.role, token, expiresAt }
}

/** The Terms + Privacy consent rows every account records at creation, stamped with the current policy versions. */
function requiredConsentRows(userId: string, acceptedAt: Date): (typeof userConsents.$inferInsert)[] {
  return [
    { userId, consentType: 'TERMS_OF_SERVICE', policyVersion: CURRENT_TERMS_OF_SERVICE_VERSION, acceptedAt },
    { userId, consentType: 'PRIVACY_POLICY', policyVersion: CURRENT_PRIVACY_POLICY_VERSION, acceptedAt },
  ]
}

export interface OrganizerSignUpInput {
  name: string
  email: string
  password: string
  phone?: string
  acceptedTermsOfService: boolean
  acceptedPrivacyPolicy: boolean
}

/**
 * Creates an ORGANIZER account and signs it in (same return shape and
 * cookie-setting responsibility as `signIn`).
 *
 * Organizer and delegate accounts are deliberately separate: this is the only
 * path that creates an ORGANIZER, it never creates a student profile, and
 * nothing anywhere converts an existing STUDENT account into an ORGANIZER. A
 * person who wants to both host and attend conferences uses two accounts.
 *
 * An ORGANIZER account can't list anything by itself — hosting still requires
 * submitting an organizer application and passing admin review.
 *
 * Throws the same errors as `signUp` for a missing name, short password,
 * duplicate email or missing consent.
 */
export async function signUpOrganizer(
  input: OrganizerSignUpInput,
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const trimmedName = required(input.name, 'Name')
  const normalizedEmail = input.email.trim().toLowerCase()
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (!input.acceptedTermsOfService) {
    throw new Error('You must accept the Terms of Service to create an account')
  }
  if (!input.acceptedPrivacyPolicy) {
    throw new Error('You must accept the Privacy Policy to create an account')
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
  if (existing) {
    throw new Error('An account with that email already exists')
  }

  const passwordHash = await hashPassword(input.password)
  const now = new Date()

  const user = await db.transaction(async (tx) => {
    const [createdUser] = await tx
      .insert(users)
      .values({
        name: trimmedName,
        email: normalizedEmail,
        phone: input.phone?.trim() || null,
        passwordHash,
        role: 'ORGANIZER',
      })
      .returning()

    await tx.insert(userConsents).values(requiredConsentRows(createdUser.id, now))

    return createdUser
  })

  const { token, expiresAt } = await createSession(user.id)

  return { userId: user.id, role: user.role, token, expiresAt }
}

/**
 * Changes the signed-in user's password. Requires the current password
 * (re-verified here, not trusted from the client) — this is the in-app
 * "change password while logged in" path, separate from the signed-out
 * "forgot password" recovery flow in `lib/actions/password-reset.ts`.
 *
 * Throws `Error('Current password is incorrect')` if `currentPassword`
 * doesn't match (including the edge case of an account with no password
 * hash at all — same message either way, no information leak).
 * Throws `Error('Password must be at least 8 characters')` for a too-short
 * `newPassword`.
 *
 * Deliberately does NOT invalidate other sessions — the user is actively
 * signed in and choosing this themselves, unlike a reset-token recovery
 * (which does invalidate everything, since that path implies the old
 * credential may be compromised).
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  session: Session,
): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error('Current password is incorrect')
  }

  const passwordHash = await hashPassword(newPassword)
  await db.update(users).set({ passwordHash }).where(eq(users.id, session.userId))
}

/**
 * Invalidates a session by its token via `destroySession` (idempotent —
 * no-op if the token is empty/missing or the session is already gone).
 * Does NOT touch cookies — the caller is responsible for reading the
 * token out of the request and clearing the cookie itself.
 */
export async function signOut(token: string): Promise<void> {
  if (token) {
    await destroySession(token)
  }
}
