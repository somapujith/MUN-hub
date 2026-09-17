import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, studentProfiles, userConsents, users } from '@/lib/db/schema'
import { createSession, destroySession, otherSessionsOf } from '@/lib/auth/session'
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password'
import { buildOptionalProfileFields, required } from '@/lib/actions/student-profile'
import { beginMfaChallenge, hasConfirmedMfa } from '@/lib/actions/staff-mfa'
import { STAFF_ROLES } from '@/lib/actions/admin-staff'
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
  /**
   * Required (must be true) when `dateOfBirth` makes the user under 18.
   * Only ever recorded when true — no row is written for a declined/absent ack.
   */
  acceptedGuardianAcknowledgement?: boolean
}

const MIN_PASSWORD_LENGTH = 8
const ADULT_AGE_YEARS = 18

/**
 * Thrown by `signUp` when a minor signs up without the parent/guardian
 * acknowledgement. Ends in "is required" so server/middleware/error.ts's
 * signup-validation rule maps it to 400.
 */
export const GUARDIAN_CONSENT_REQUIRED = 'For users under 18, parent or guardian consent is required'

/**
 * Whether someone born on `dateOfBirth` is younger than 18 at `now`, by
 * calendar birthday in UTC (a `YYYY-MM-DD` date input parses as UTC
 * midnight). A 29 February birthday reaches 18 on 1 March in non-leap years.
 */
export function isUnderAdultAge(dateOfBirth: Date, now: Date = new Date()): boolean {
  const adultOn = Date.UTC(
    dateOfBirth.getUTCFullYear() + ADULT_AGE_YEARS,
    dateOfBirth.getUTCMonth(),
    dateOfBirth.getUTCDate(),
  )
  return now.getTime() < adultOn
}

/**
 * `signIn`'s result: a real session (`SIGNED_IN`), or — only for a staff
 * (OPERATIONS/ADMIN/SUPER_ADMIN) account with *confirmed* TOTP enrollment —
 * `MFA_REQUIRED`, meaning the password was correct but a session was
 * deliberately not created yet. The caller (server/routes/auth.ts) must
 * complete the challenge via `lib/actions/staff-mfa.ts#completeMfaChallenge`
 * (`POST /auth/session/mfa`) before the account is actually signed in.
 * Everyone else — every STUDENT/ORGANIZER, and any staff account that hasn't
 * finished MFA setup — always gets `SIGNED_IN` here, unchanged from before
 * MFA existed; enrollment status only gates this branch, never a plain
 * password check.
 */
export type SignInResult =
  | { status: 'SIGNED_IN'; userId: string; role: Role; token: string; expiresAt: Date }
  | { status: 'MFA_REQUIRED'; pendingToken: string; expiresAt: Date }

/**
 * Real password sign-in (replaces the old email-only mock). Looks up the
 * user by email and verifies `password` against `users.passwordHash` with a
 * timing-safe scrypt comparison (`lib/auth/password.ts`).
 *
 * Throws the same generic `Error('Invalid email or password')` whether the
 * email doesn't exist or the password is wrong — and also when the account
 * predates real signup and has no `passwordHash` at all — so a caller can
 * never use response differences to enumerate valid emails. The same goes
 * for timing: every path runs exactly one scrypt verification (an unknown
 * email is checked against `DUMMY_PASSWORD_HASH`).
 *
 * A successful sign-in against a hash in an outdated format or at an
 * outdated cost transparently re-hashes the password (`needsRehash`).
 *
 * Throws `Error('Account suspended')` if the matched user is suspended.
 *
 * On success, creates a session row via `createSession` and returns the raw
 * token + expiry (`SIGNED_IN`) — unless the account is staff with confirmed
 * MFA, in which case it returns `MFA_REQUIRED` instead (see `SignInResult`).
 * Does NOT touch cookies — the caller (an HTTP-layer route handler) is
 * responsible for setting the session cookie using the returned token.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const [user] = await db
    .select({ id: users.id, role: users.role, passwordHash: users.passwordHash, suspended: users.suspended })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)

  const storedHash = user?.passwordHash ?? null
  const passwordMatches = await verifyPassword(password, storedHash ?? DUMMY_PASSWORD_HASH)
  if (!user || !storedHash || !passwordMatches) {
    throw new Error('Invalid email or password')
  }

  if (user.suspended) {
    throw new Error('Account suspended')
  }

  if (needsRehash(storedHash)) {
    await upgradePasswordHash(user.id, storedHash, password)
  }

  if ((STAFF_ROLES as readonly string[]).includes(user.role) && (await hasConfirmedMfa(user.id))) {
    const { pendingToken, expiresAt } = await beginMfaChallenge(user.id)
    return { status: 'MFA_REQUIRED', pendingToken, expiresAt }
  }

  const { token, expiresAt } = await createSession(user.id)

  return { status: 'SIGNED_IN', userId: user.id, role: user.role, token, expiresAt }
}

/**
 * Replaces a verified-but-outdated password hash. Conditional on the stored
 * hash still being the one that was verified, so a password change or reset
 * landing in between is never overwritten. Best-effort: on failure the old
 * (still valid) hash stays and the sign-in goes ahead.
 */
async function upgradePasswordHash(userId: string, verifiedHash: string, password: string): Promise<void> {
  try {
    const passwordHash = await hashPassword(password)
    await db
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, userId), eq(users.passwordHash, verifiedHash)))
  } catch (error) {
    console.error('[auth] password rehash failed', { userId, error })
  }
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
 * Only ever creates STUDENT accounts. ORGANIZER accounts are created by the
 * passwordless email-code flow in `lib/actions/organizer-otp.ts`, and nothing
 * converts one kind of account into the other.
 *
 * Throws `Error('An account with that email already exists')` on a
 * duplicate email, `Error('Password must be at least 8 characters')` for a
 * too-short password, `GUARDIAN_CONSENT_REQUIRED` when the date of birth
 * makes the user under 18 and `acceptedGuardianAcknowledgement` isn't true,
 * and a plain `Error` naming the first missing required profile/consent
 * field otherwise.
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
  if (isUnderAdultAge(dateOfBirth) && input.acceptedGuardianAcknowledgement !== true) {
    throw new Error(GUARDIAN_CONSENT_REQUIRED)
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

/**
 * The Terms + Privacy consent rows every account records at creation, stamped
 * with the current policy versions. Shared with organizer signup
 * (lib/actions/organizer-otp.ts), which creates ORGANIZER accounts without a password.
 */
export function requiredConsentRows(userId: string, acceptedAt: Date): (typeof userConsents.$inferInsert)[] {
  return [
    { userId, consentType: 'TERMS_OF_SERVICE', policyVersion: CURRENT_TERMS_OF_SERVICE_VERSION, acceptedAt },
    { userId, consentType: 'PRIVACY_POLICY', policyVersion: CURRENT_PRIVACY_POLICY_VERSION, acceptedAt },
  ]
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
 * Signs the user out everywhere else: every session except the caller's own
 * (`currentSessionToken`) is deleted in the same transaction as the
 * password update. A password change is often a reaction to a suspected
 * compromise, and a stolen session cookie must not outlive it. The
 * signed-out reset flow (`lib/actions/password-reset.ts`) has no current
 * session and deletes all of them.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  session: Session,
  currentSessionToken: string,
): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)
  if (!user || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error('Current password is incorrect')
  }

  const passwordHash = await hashPassword(newPassword)
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, session.userId))
    await tx.delete(sessions).where(otherSessionsOf(session.userId, currentSessionToken))
  })
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
