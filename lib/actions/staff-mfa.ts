import crypto from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { mfaPendingChallenges, mfaRecoveryCodes, userMfa, users } from '@/lib/db/schema'
import { decryptField, encryptField, TOTP_KEY_NAMES } from '@/lib/crypto/field-encryption'
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '@/lib/auth/totp'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/auth/opaque-token'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { lockStaffTarget, lockSuperAdmins, STAFF_ERRORS, STAFF_ROLES } from './admin-staff'
import type { Session } from '@/lib/auth/adapter'
import type { Role } from '@/lib/db/schema-enums'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Tx | typeof db

// -----------------------------------------------------------------------------
// Staff TOTP two-factor auth — OPERATIONS/ADMIN/SUPER_ADMIN only.
//
// Flow: signIn (lib/actions/auth.ts) checks hasConfirmedMfa() after the
// password verifies; if the account has confirmed MFA it calls
// beginMfaChallenge() instead of creating a session, and the route layer
// (server/routes/auth.ts, POST /auth/session/mfa) calls
// completeMfaChallenge() with the pendingToken + a TOTP or recovery code.
//
// Enrollment: beginMfaEnrollment() (any signed-in staff account) generates a
// secret and stores it encrypted-at-rest, unconfirmed. confirmMfaEnrollment()
// proves the user copied it into an authenticator app before it counts —
// otherwise a broken QR scan would permanently lock the account out. Once
// confirmed, 10 recovery codes are minted and returned exactly once
// (plaintext is never stored, only scrypt hashes — lib/auth/password.ts).
//
// requireRole enforcement (server/middleware/require-role.ts) is a separate
// concern: when REQUIRE_STAFF_2FA=true, it blocks staff-role-gated routes for
// an account with no *confirmed* MFA. It does not gate enrollment itself
// (requireAuth only), so a staff member can always reach the setup flow.
// -----------------------------------------------------------------------------

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000
const MFA_MAX_ATTEMPTS = 5
const RECOVERY_CODE_COUNT = 10

export const MFA_ERRORS = {
  staffOnly: 'Two-factor authentication is only available for staff accounts',
  alreadyEnrolled: 'Two-factor authentication is already set up for this account',
  notEnrolled: 'Start two-factor authentication setup first',
  notConfirmed: 'Confirm two-factor authentication setup before managing recovery codes',
  invalidCode: 'Invalid verification code',
  expired: 'This sign-in attempt has expired — sign in again',
  tooManyAttempts: 'Too many incorrect attempts — sign in again',
  unavailable: "Two-factor authentication isn't available yet",
} as const

function isStaffRole(role: string): role is (typeof STAFF_ROLES)[number] {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

function assertStaff(session: Session): void {
  if (!isStaffRole(session.role)) throw new Error(MFA_ERRORS.staffOnly)
}

/** Whether `userId` has confirmed TOTP enrollment — the one thing both the sign-in gate and requireRole care about. */
export async function hasConfirmedMfa(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ confirmedAt: userMfa.confirmedAt })
    .from(userMfa)
    .where(eq(userMfa.userId, userId))
    .limit(1)
  return Boolean(row?.confirmedAt)
}

export interface MfaEnrollmentStatus {
  confirmed: boolean
}

export async function getMfaEnrollmentStatus(session: Session): Promise<MfaEnrollmentStatus> {
  assertStaff(session)
  return { confirmed: await hasConfirmedMfa(session.userId) }
}

export interface MfaSetupResult {
  /** Base32 secret, for "can't scan the code" manual entry — shown once, alongside the QR code built from otpauthUri. */
  secret: string
  otpauthUri: string
}

/**
 * Starts (or restarts) TOTP enrollment: generates a fresh secret, encrypts it
 * (TOTP_KEY_NAMES — its own key, separate from PAYMENT_FIELD_KEY), and stores
 * it unconfirmed. Calling this again before confirming replaces the pending
 * secret — the old QR code simply stops working, which is the safe direction
 * for an abandoned setup. Throws `alreadyEnrolled` once confirmed; disabling
 * first (SUPER_ADMIN `resetStaffMfa`) is required to re-enroll. Throws
 * `unavailable` if TOTP_FIELD_KEY isn't configured — checked up front here
 * rather than surfacing field-encryption.ts's generic missing-key error as a
 * raw 500. Nothing else in this file needs the same check: confirming,
 * challenging, disabling and regenerating codes are only reachable once a
 * row already exists, which is only possible if the key was present when
 * this function ran.
 */
export async function beginMfaEnrollment(session: Session): Promise<MfaSetupResult> {
  assertStaff(session)
  if (!getRuntimeEnv('TOTP_FIELD_KEY')) throw new Error(MFA_ERRORS.unavailable)

  const [existing] = await db.select({ confirmedAt: userMfa.confirmedAt }).from(userMfa).where(eq(userMfa.userId, session.userId)).limit(1)
  if (existing?.confirmedAt) throw new Error(MFA_ERRORS.alreadyEnrolled)

  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, session.userId)).limit(1)
  const secret = generateTotpSecret()
  const totpSecretCiphertext = encryptField(secret, TOTP_KEY_NAMES)

  await db
    .insert(userMfa)
    .values({ userId: session.userId, totpSecretCiphertext })
    .onConflictDoUpdate({ target: userMfa.userId, set: { totpSecretCiphertext, confirmedAt: null, lastUsedStep: null } })

  return { secret, otpauthUri: buildOtpauthUri(secret, account?.email ?? session.userId) }
}

/**
 * Proves the account can generate a valid code for the secret
 * `beginMfaEnrollment` just issued, confirms enrollment, and mints
 * `RECOVERY_CODE_COUNT` single-use recovery codes — returned in plaintext
 * exactly once (only their scrypt hashes are stored). Throws `notEnrolled`
 * if setup was never started, `alreadyEnrolled` if it's already confirmed,
 * and `invalidCode` for a wrong/expired code.
 */
export async function confirmMfaEnrollment(code: string, session: Session): Promise<{ recoveryCodes: string[] }> {
  assertStaff(session)

  const [row] = await db.select().from(userMfa).where(eq(userMfa.userId, session.userId)).limit(1)
  if (!row) throw new Error(MFA_ERRORS.notEnrolled)
  if (row.confirmedAt) throw new Error(MFA_ERRORS.alreadyEnrolled)

  const secret = decryptField(row.totpSecretCiphertext, TOTP_KEY_NAMES)
  const matchedStep = verifyTotp(secret, code.trim())
  if (matchedStep === null) throw new Error(MFA_ERRORS.invalidCode)

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
  const codeHashes = await Promise.all(recoveryCodes.map((recoveryCode) => hashPassword(recoveryCode)))
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.update(userMfa).set({ confirmedAt: now, lastUsedStep: matchedStep }).where(eq(userMfa.userId, session.userId))
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, session.userId))
    await tx.insert(mfaRecoveryCodes).values(codeHashes.map((codeHash) => ({ userId: session.userId, codeHash })))
  })

  return { recoveryCodes }
}

/** The only shape `generateRecoveryCode` produces. */
const RECOVERY_CODE_PATTERN = /^[0-9A-F]{5}-[0-9A-F]{5}$/

/** `XXXXX-XXXXX` (10 uppercase hex chars from crypto.randomBytes) — easy to read back, 40 bits of entropy. */
function generateRecoveryCode(): string {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

/**
 * Whether `code` even has the shape `generateRecoveryCode` produces. Checked
 * before `matchRecoveryCode` scans an account's unused codes: each candidate
 * costs a scrypt verification (~65 ms and 32 MiB, lib/auth/password.ts), so a
 * wrong 6-digit TOTP must not pay for up to ten of them. Nothing that could
 * have matched is excluded — `matchRecoveryCode` compares against the hash of
 * the exact generated string, so only this shape can ever verify.
 */
export function looksLikeRecoveryCode(code: string): boolean {
  return /^[0-9a-fA-F]{5}-[0-9a-fA-F]{5}$/.test(code)
}

/**
 * Called by `signIn` once the password has verified for a staff account with
 * confirmed MFA — mints a short-lived, single-use, hashed-at-rest pending
 * token (mirrors lib/auth/session.ts's opaque tokens) instead of a session.
 */
export async function beginMfaChallenge(userId: string): Promise<{ pendingToken: string; expiresAt: Date }> {
  const pendingToken = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS)
  await db.insert(mfaPendingChallenges).values({ userId, tokenHash: hashOpaqueToken(pendingToken), expiresAt })
  return { pendingToken, expiresAt }
}

/**
 * Checks `code` (a 6-digit TOTP or an `XXXXX-XXXXX` recovery code) against
 * the pending challenge `pendingToken` identifies, and on success creates a
 * real session — same return shape as `signIn`'s SIGNED_IN branch. A wrong
 * code counts against MFA_MAX_ATTEMPTS, mirroring
 * organizer-otp.ts#verifyOrganizerLoginCode's row-locked attempt counter.
 * A used recovery code can never be used again (not just rate-limited).
 */
export async function completeMfaChallenge(
  pendingToken: string,
  code: string,
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const tokenHash = hashOpaqueToken(pendingToken)
  const trimmedCode = code.trim()
  const now = new Date()

  type Outcome = { kind: 'error'; message: string } | { kind: 'signed-in'; userId: string; role: Role }

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [row] = await tx
      .select()
      .from(mfaPendingChallenges)
      .where(and(eq(mfaPendingChallenges.tokenHash, tokenHash), isNull(mfaPendingChallenges.consumedAt)))
      .limit(1)
      .for('update')

    if (!row || row.expiresAt.getTime() <= now.getTime()) {
      return { kind: 'error', message: MFA_ERRORS.expired }
    }
    if (row.attempts >= MFA_MAX_ATTEMPTS) {
      return { kind: 'error', message: MFA_ERRORS.tooManyAttempts }
    }

    const [mfa] = await tx.select().from(userMfa).where(eq(userMfa.userId, row.userId)).limit(1)
    if (!mfa?.confirmedAt) {
      return { kind: 'error', message: MFA_ERRORS.notEnrolled }
    }

    const matchedStep = /^\d{6}$/.test(trimmedCode)
      ? verifyTotp(decryptField(mfa.totpSecretCiphertext, TOTP_KEY_NAMES), trimmedCode, { lastUsedStep: mfa.lastUsedStep })
      : null
    const recoveryCodeId =
      matchedStep === null && looksLikeRecoveryCode(trimmedCode) ? await matchRecoveryCode(tx, row.userId, trimmedCode) : null

    if (matchedStep === null && !recoveryCodeId) {
      const attempts = row.attempts + 1
      await tx.update(mfaPendingChallenges).set({ attempts }).where(eq(mfaPendingChallenges.id, row.id))
      return { kind: 'error', message: attempts >= MFA_MAX_ATTEMPTS ? MFA_ERRORS.tooManyAttempts : MFA_ERRORS.invalidCode }
    }

    await tx.update(mfaPendingChallenges).set({ consumedAt: now }).where(eq(mfaPendingChallenges.id, row.id))
    if (matchedStep !== null) {
      await tx.update(userMfa).set({ lastUsedStep: matchedStep }).where(eq(userMfa.userId, row.userId))
    } else if (recoveryCodeId) {
      await tx.update(mfaRecoveryCodes).set({ usedAt: now }).where(eq(mfaRecoveryCodes.id, recoveryCodeId))
    }

    const [user] = await tx.select({ id: users.id, role: users.role, suspended: users.suspended }).from(users).where(eq(users.id, row.userId)).limit(1)
    if (!user || user.suspended) return { kind: 'error', message: 'Account suspended' }
    return { kind: 'signed-in', userId: user.id, role: user.role }
  })

  if (outcome.kind === 'error') throw new Error(outcome.message)

  const { token, expiresAt } = await createSession(outcome.userId)
  return { userId: outcome.userId, role: outcome.role, token, expiresAt }
}

/**
 * The id of the first unused recovery code that verifies against `code`, or
 * null. Each stored code costs a scrypt run to check, so input that can't be
 * a recovery code is refused before any hashing.
 */
async function matchRecoveryCode(executor: Executor, userId: string, code: string): Promise<string | null> {
  if (!RECOVERY_CODE_PATTERN.test(code)) return null
  const candidates = await executor
    .select({ id: mfaRecoveryCodes.id, codeHash: mfaRecoveryCodes.codeHash })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)))

  for (const candidate of candidates) {
    if (await verifyPassword(code, candidate.codeHash)) return candidate.id
  }
  return null
}

/**
 * Self-service: mints a fresh set of 10 recovery codes, replacing the old
 * ones, for an already-confirmed account. Requires a *current TOTP code*
 * specifically (not a recovery code) — regenerating is about to invalidate
 * every recovery code anyway, so spending one here to do it would be an odd,
 * wasteful path when the authenticator app is right there.
 */
export async function regenerateMfaRecoveryCodes(code: string, session: Session): Promise<{ recoveryCodes: string[] }> {
  assertStaff(session)

  const [row] = await db.select().from(userMfa).where(eq(userMfa.userId, session.userId)).limit(1)
  if (!row?.confirmedAt) throw new Error(MFA_ERRORS.notConfirmed)

  const secret = decryptField(row.totpSecretCiphertext, TOTP_KEY_NAMES)
  const matchedStep = verifyTotp(secret, code.trim(), { lastUsedStep: row.lastUsedStep })
  if (matchedStep === null) throw new Error(MFA_ERRORS.invalidCode)

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
  const codeHashes = await Promise.all(recoveryCodes.map((recoveryCode) => hashPassword(recoveryCode)))

  await db.transaction(async (tx) => {
    await tx.update(userMfa).set({ lastUsedStep: matchedStep }).where(eq(userMfa.userId, session.userId))
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, session.userId))
    await tx.insert(mfaRecoveryCodes).values(codeHashes.map((codeHash) => ({ userId: session.userId, codeHash })))
  })

  return { recoveryCodes }
}

/**
 * Self-service: turns MFA off for the caller's own account — a TOTP or
 * recovery code proves it's really them (not just whoever currently holds
 * the session cookie) before the safety net comes down. Throws
 * `notConfirmed` if there's nothing confirmed to disable. Guesses here and in
 * `regenerateMfaRecoveryCodes` are capped per account by the API's
 * RL_MFA_MANAGE_USER rate limit (server/middleware/rate-limit.ts).
 */
export async function disableMfa(code: string, session: Session): Promise<void> {
  assertStaff(session)

  const [row] = await db.select().from(userMfa).where(eq(userMfa.userId, session.userId)).limit(1)
  if (!row?.confirmedAt) throw new Error(MFA_ERRORS.notConfirmed)

  const trimmedCode = code.trim()
  const matchedStep = /^\d{6}$/.test(trimmedCode)
    ? verifyTotp(decryptField(row.totpSecretCiphertext, TOTP_KEY_NAMES), trimmedCode, { lastUsedStep: row.lastUsedStep })
    : null
  const recoveryCodeId =
    matchedStep === null && looksLikeRecoveryCode(trimmedCode) ? await matchRecoveryCode(db, session.userId, trimmedCode) : null
  if (matchedStep === null && !recoveryCodeId) throw new Error(MFA_ERRORS.invalidCode)

  await db.transaction(async (tx) => {
    await tx.delete(userMfa).where(eq(userMfa.userId, session.userId))
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, session.userId))
  })
}

/**
 * SUPER_ADMIN-only: clears another staff member's TOTP enrollment, recovery
 * codes and any open sign-in challenge (e.g. a lost device) so they can
 * re-enroll from scratch. Audit-logged as STAFF_MFA_RESET (with the same
 * name in `metadata.event`, like admin-staff.ts's writes).
 *
 * Takes the same three guards every other staff write in admin-staff.ts
 * takes, and for the same reasons:
 *  - refuses the actor's own account, so this never becomes a second,
 *    code-free route to `disableMfa` (which exists precisely to make a
 *    stolen session cookie insufficient to take the safety net down);
 *  - `lockSuperAdmins` re-checks, under a row lock, that the caller is still
 *    an active SUPER_ADMIN at commit time;
 *  - `lockStaffTarget` makes an unknown or non-staff id answer
 *    `Staff member not found` (404) instead of succeeding and writing a
 *    misleading audit row for a student, organizer or nonexistent user.
 */
export async function resetStaffMfa(targetUserId: string, session: Session): Promise<void> {
  requireRole(session, ['SUPER_ADMIN'])
  if (targetUserId === session.userId) throw new Error(STAFF_ERRORS.self)

  await db.transaction(async (tx) => {
    await lockSuperAdmins(tx, session.userId)
    await lockStaffTarget(tx, targetUserId)

    await tx.delete(userMfa).where(eq(userMfa.userId, targetUserId))
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, targetUserId))
    // An unconsumed challenge outlives the secret it was minted against, so
    // drop it too rather than leave a five-minute window open.
    await tx
      .delete(mfaPendingChallenges)
      .where(and(eq(mfaPendingChallenges.userId, targetUserId), isNull(mfaPendingChallenges.consumedAt)))

    await recordAdminAction(tx, session.userId, 'STAFF_MFA_RESET', 'user', targetUserId, undefined, {
      event: 'STAFF_MFA_RESET',
    })
  })
}
