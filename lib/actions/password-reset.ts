import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { passwordResetTokens, sessions, users } from '@/lib/db/schema'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/auth/opaque-token'
import { hashPassword } from '@/lib/auth/password'
import { getNotificationsAdapter } from '@/lib/notifications/select-adapter'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
const MIN_PASSWORD_LENGTH = 8
const INVALID_TOKEN = 'This reset link is invalid or has expired'

/** An account gets at most one reset email per this window… */
export const RESET_REQUEST_COOLDOWN_MS = 60 * 1000
/** …and at most this many per rolling hour. */
export const RESET_REQUESTS_PER_HOUR = 3

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Tx | typeof db

/**
 * Stores a new single-use token for `userId` that `resetPassword` will
 * accept until `expiresAt`, and returns the raw token to put in a
 * `/reset-password?token=` link. Only the token's SHA-256 is stored, so
 * the returned value is the one and only copy — any code minting reset or
 * set-password links must go through here rather than inserting into
 * `password_reset_tokens` itself. Pass a transaction as `executor` to write
 * it atomically with other changes.
 */
export async function insertPasswordResetToken(
  executor: Executor,
  userId: string,
  expiresAt: Date,
  createdAt: Date = new Date(),
): Promise<string> {
  const token = generateOpaqueToken()
  await executor.insert(passwordResetTokens).values({ userId, token: hashOpaqueToken(token), expiresAt, createdAt })
  return token
}

/**
 * Starts a "forgot password" reset: if `email` matches an account, creates a
 * single-use, 1-hour token and emails a reset link via whichever adapter
 * `getNotificationsAdapter()` selects (real delivery through ZeptoMail when
 * configured, console/mock otherwise — see lib/notifications/select-adapter.ts)
 * built from `appUrl` (caller-supplied so this file stays framework-agnostic;
 * server/routes/password-reset.ts decides which origin is trustworthy).
 *
 * Only the SHA-256 of the token is stored (lib/auth/opaque-token.ts); the
 * plaintext exists only in the emailed link.
 *
 * Per-account throttle: nothing is sent when the account already got a link
 * in the last minute, or three in the last hour. That is silent on purpose —
 * the caller can't tell a throttled request from one for an unknown email,
 * so the throttle doesn't reveal which addresses have accounts. (The HTTP
 * layer adds per-IP and per-email request limits on top.)
 *
 * Always resolves successfully whether or not the email matched — never
 * reveals whether an account exists for a given address.
 */
export async function requestPasswordReset(email: string, appUrl: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()

  const issued = await db.transaction(async (tx) => {
    // Row lock on the user serializes concurrent requests for one account,
    // so the throttle below can't be raced past.
    const [user] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
      .for('update')

    if (!user) return null

    const now = new Date()
    const recent = await tx
      .select({ createdAt: passwordResetTokens.createdAt })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
        ),
      )
      .orderBy(desc(passwordResetTokens.createdAt))

    const coolingDown = recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESET_REQUEST_COOLDOWN_MS
    if (coolingDown || recent.length >= RESET_REQUESTS_PER_HOUR) {
      console.info('[password-reset] request throttled', { userId: user.id })
      return null
    }

    const token = await insertPasswordResetToken(tx, user.id, new Date(now.getTime() + RESET_TOKEN_TTL_MS), now)
    return { recipient: user, token }
  })

  if (!issued) return
  const { recipient, token } = issued

  const resetUrl = `${appUrl}/reset-password?token=${token}`

  try {
    await getNotificationsAdapter().send({
      to: recipient.email,
      subject: 'Reset your MUN Hub password',
      body:
        `We received a request to reset your MUN Hub password. This link expires in 1 hour ` +
        `and can only be used once:\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    })
  } catch (error) {
    // A delivery failure must never surface as a reset failure — the request
    // itself already succeeded (the token exists); log and move on, matching
    // lib/notifications/pipeline-events.ts's "never throw" convention.
    console.error('[password-reset] delivery failed', { userId: recipient.id, error })
  }
}

/**
 * Completes a password reset: validates the token (exists, unused,
 * unexpired), sets the new password, and invalidates every existing session
 * for the account — a reset implies the old credential (and any sessions
 * established under it) may be compromised. Any other outstanding reset
 * links for the account are spent too.
 *
 * Consuming the token is atomic: a conditional `UPDATE … WHERE used_at IS
 * NULL … RETURNING` inside the same transaction as the password change, so
 * two concurrent submissions of one link can't both succeed. A cheap lookup
 * first keeps a bogus token from costing a scrypt hash.
 *
 * Throws `Error('This reset link is invalid or has expired')` for a
 * missing/used/expired token, and `Error('Password must be at least 8
 * characters')` for a too-short `newPassword`.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const tokenHash = hashOpaqueToken(token)
  const liveToken = () =>
    and(
      eq(passwordResetTokens.token, tokenHash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    )

  const [candidate] = await db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(liveToken())
    .limit(1)
  if (!candidate) {
    throw new Error(INVALID_TOKEN)
  }

  const passwordHash = await hashPassword(newPassword)

  await db.transaction(async (tx) => {
    const now = new Date()
    const [consumed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(liveToken())
      .returning({ userId: passwordResetTokens.userId })
    if (!consumed) {
      throw new Error(INVALID_TOKEN)
    }

    await tx.update(users).set({ passwordHash }).where(eq(users.id, consumed.userId))
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, consumed.userId), isNull(passwordResetTokens.usedAt)))
    await tx.delete(sessions).where(eq(sessions.userId, consumed.userId))
  })
}
