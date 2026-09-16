import crypto from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { passwordResetTokens, sessions, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
const MIN_PASSWORD_LENGTH = 8

/**
 * Starts a "forgot password" reset: if `email` matches an account, creates a
 * single-use, 1-hour token and emails a reset link (via the console/mock
 * notifications adapter — no real email delivery in this environment) built
 * from `appUrl` (caller-supplied so this file stays framework-agnostic —
 * never imports `next/headers`; the Next.js layer resolves the request's own
 * origin and passes it in).
 *
 * Always resolves successfully whether or not the email matched — never
 * reveals whether an account exists for a given address.
 */
export async function requestPasswordReset(email: string, appUrl: string): Promise<void> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)

  if (!user) return

  const token = crypto.randomBytes(32).toString('hex')
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  })

  const resetUrl = `${appUrl}/reset-password?token=${token}`

  try {
    await consoleNotificationsAdapter.send({
      to: user.email,
      subject: 'Reset your MUN Hub password',
      body:
        `We received a request to reset your MUN Hub password. This link expires in 1 hour ` +
        `and can only be used once:\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    })
  } catch (error) {
    // A delivery failure must never surface as a reset failure — the request
    // itself already succeeded (the token exists); log and move on, matching
    // lib/notifications/pipeline-events.ts's "never throw" convention.
    console.error('[password-reset] delivery failed', { userId: user.id, error })
  }
}

/**
 * Completes a password reset: validates the token (exists, unused,
 * unexpired), sets the new password, marks the token used, and invalidates
 * every existing session for the account — a reset implies the old
 * credential (and any sessions established under it) may be compromised,
 * unlike `lib/actions/auth.ts#changePassword`'s in-app path.
 *
 * Throws `Error('This reset link is invalid or has expired')` for a
 * missing/used/expired token, and `Error('Password must be at least 8
 * characters')` for a too-short `newPassword`.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.token, token),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!row) {
    throw new Error('This reset link is invalid or has expired')
  }

  const passwordHash = await hashPassword(newPassword)

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id))
    await tx.delete(sessions).where(eq(sessions.userId, row.userId))
  })
}
