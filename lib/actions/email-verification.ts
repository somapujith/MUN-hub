import crypto from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailVerificationTokens, users } from '@/lib/db/schema'
import { getNotificationsAdapter } from '@/lib/notifications/select-adapter'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { NotificationsAdapter } from '@/lib/notifications/adapter'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * An account gets at most this many verification emails per rolling hour.
 *
 * password-reset.ts pairs its hourly cap with a one-a-minute cooldown; this
 * one deliberately doesn't. The hourly cap is what bounds a flood — three an
 * hour is three an hour however they are spaced — and the per-email HTTP
 * limit (3 a minute, server/middleware/rate-limit.ts) already stops a burst.
 * A cooldown on top would only punish the legitimate "it didn't arrive,
 * send it again" click, which is the whole purpose of this endpoint.
 */
export const VERIFICATION_RESENDS_PER_HOUR = 3

/**
 * SHA-256, not lib/auth/password.ts's scrypt — the raw token is a 32-byte
 * crypto.randomBytes value (256 bits of entropy on its own), not a
 * low-entropy user-chosen secret, so a fast hash is the correct choice: it's
 * still computationally infeasible to reverse, and there's no offline
 * dictionary-attack threat a slow KDF would need to defend against here.
 */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Creates a fresh verification token for `userId` and emails a verify link
 * built from `appUrl` (caller-supplied, so this file stays framework-
 * agnostic — same pattern lib/actions/password-reset.ts uses, never reading
 * a request context directly). Only the token's SHA-256 hash is ever
 * persisted (schema.ts's email_verification_tokens comment has the full
 * reasoning) — the raw value exists only in memory and the outgoing email.
 * Throws if `userId` doesn't resolve — a caller invoking this right after
 * its own user-creation has a real bug if that lookup fails, not something
 * to silently skip.
 */
export async function sendVerificationEmail(
  userId: string,
  appUrl: string,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('User not found')

  const rawToken = crypto.randomBytes(32).toString('hex')
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  })

  await deliverVerificationEmail({ id: userId, ...user }, rawToken, appUrl, adapter)
}

/**
 * Sends the "verify your email" message for an already-issued token. A
 * delivery failure is logged, never thrown — the token exists either way,
 * and (for the resend path) surfacing it would turn a mail-provider hiccup
 * into a signal about which addresses have accounts.
 */
async function deliverVerificationEmail(
  user: { id: string; email: string; name: string },
  rawToken: string,
  appUrl: string,
  adapter: NotificationsAdapter,
): Promise<void> {
  const verifyUrl = `${appUrl}/verify-email?token=${rawToken}`

  try {
    await adapter.send({
      to: user.email,
      subject: 'Verify your MUN Hub email',
      body:
        `Hi ${user.name},\n\n` +
        `Please verify your email address to finish setting up your MUN Hub account. This link expires in 24 hours:\n${verifyUrl}\n\n` +
        `If you didn't create this account, you can ignore this email.`,
    })
  } catch (error) {
    console.error('[email-verification] delivery failed', { userId: user.id, error })
  }
}

/**
 * Resend — spends every still-unused token for this account (marked used, so
 * an earlier email's link stops working the moment a new one is requested)
 * and issues a fresh one. Always resolves successfully whether or not the
 * email matches an account — same no-enumeration stance
 * requestPasswordReset already takes, and for the same reason: this is
 * reachable from a plain "enter your email" form that anyone can post to.
 *
 * Nothing is sent when the address is already verified (there is no link
 * worth sending), or when the account has already had
 * `VERIFICATION_RESENDS_PER_HOUR` in the last hour — which is what stops
 * this endpoint being used to flood someone's inbox and burn munhub.in's
 * sender reputation. Both are silent, for the same reason the throttle in
 * password-reset.ts is: a distinguishable answer would reveal which
 * addresses have accounts. The HTTP layer adds per-IP and per-email request
 * limits on top (server/middleware/rate-limit.ts), and the route hands this
 * work to `waitUntil` so the response time is the same either way.
 *
 * Outstanding tokens are spent rather than deleted specifically so the
 * hourly count above survives — deleting them would reset the budget on
 * every call, which is exactly the flood this throttle exists to stop.
 */
export async function resendVerificationEmail(
  email: string,
  appUrl: string,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()

  const issued = await db.transaction(async (tx) => {
    // Row lock on the user serializes concurrent resends for one account, so
    // the throttle below can't be raced past.
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
      .for('update')

    if (!user || user.emailVerifiedAt) return null

    const now = new Date()
    const recent = await tx
      .select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          gt(emailVerificationTokens.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
        ),
      )
      .limit(VERIFICATION_RESENDS_PER_HOUR)

    if (recent.length >= VERIFICATION_RESENDS_PER_HOUR) {
      console.info('[email-verification] resend throttled', { userId: user.id })
      return null
    }

    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)))

    const rawToken = crypto.randomBytes(32).toString('hex')
    await tx.insert(emailVerificationTokens).values({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      createdAt: now,
    })

    return { user, rawToken }
  })

  if (!issued) return
  await deliverVerificationEmail(issued.user, issued.rawToken, appUrl, adapter)
}

/**
 * Verifies a raw token from the emailed link's `?token=` query param:
 * hashes it, looks up a matching unused/unexpired row, marks it used, and
 * sets `users.emailVerifiedAt`. Throws one generic message regardless of
 * whether the token was never valid, already used, or expired — same
 * "don't leak which case it was" reasoning password-reset.ts's own token
 * lookup follows.
 */
export async function verifyEmail(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken)
  const now = new Date()

  const [row] = await db
    .select({ id: emailVerificationTokens.id, userId: emailVerificationTokens.userId })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        isNull(emailVerificationTokens.usedAt),
        gt(emailVerificationTokens.expiresAt, now),
      ),
    )
    .limit(1)

  if (!row) throw new Error('This verification link is invalid or has expired')

  await db.transaction(async (tx) => {
    await tx.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, row.id))
    await tx.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, row.userId))
  })
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const [row] = await db.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.emailVerifiedAt != null
}

/**
 * Registration-gate check for whoever owns the registration call site
 * (lib/actions/registration.ts — not this lane, see this task's own notes):
 * throws when `REQUIRE_EMAIL_VERIFICATION` is exactly `"true"` (read via
 * getRuntimeEnv, never process.env directly) and the user's email isn't
 * verified yet. A no-op whenever the flag isn't set — defaults OFF, matching
 * every other optional env-gated behavior in this codebase (permissive
 * absent explicit configuration, same as e.g. AUTH_ADAPTER defaulting to
 * "mock").
 */
export async function assertEmailVerifiedIfRequired(userId: string): Promise<void> {
  if (getRuntimeEnv('REQUIRE_EMAIL_VERIFICATION') !== 'true') return
  if (!(await isEmailVerified(userId))) {
    throw new Error('Please verify your email address before registering for a MUN')
  }
}
