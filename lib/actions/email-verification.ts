import crypto from 'node:crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailVerificationTokens, users } from '@/lib/db/schema'
import { getNotificationsAdapter } from '@/lib/notifications/select-adapter'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { NotificationsAdapter } from '@/lib/notifications/adapter'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/** A resend is ignored when the account got a verification link within this window… */
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000
/** …or already got this many in the last hour. */
export const VERIFICATION_EMAILS_PER_HOUR = 3

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Tx | typeof db

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

  const rawToken = await insertVerificationToken(db, userId, new Date())
  await deliverVerificationEmail({ id: userId, ...user }, rawToken, appUrl, adapter)
}

/** Stores the hash of a fresh token for `userId` and returns the raw token, which is the only copy. */
async function insertVerificationToken(executor: Executor, userId: string, now: Date): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex')
  await executor.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    createdAt: now,
  })
  return rawToken
}

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
        `Hi,\n\n` +
        `Please verify your email address to finish setting up your MUN Hub account. This link expires in 24 hours:\n${verifyUrl}\n\n` +
        `If you didn't create this account, you can ignore this email.`,
    })
  } catch (error) {
    console.error('[email-verification] delivery failed', { userId: user.id, error })
  }
}

/**
 * Resend from the public "enter your email" form. Sends nothing when the
 * address has no account, is already verified, got a link in the last
 * minute, or got three in the last hour — silently, so the caller can't
 * tell these cases apart (same stance as requestPasswordReset). The HTTP
 * layer adds per-IP and per-email request limits on top.
 *
 * Otherwise every still-usable earlier link is expired on the spot (kept,
 * not deleted, so it still counts toward the hourly cap) and a fresh one is
 * sent. The user row is locked so concurrent resends can't both pass the
 * throttle.
 */
export async function resendVerificationEmail(
  email: string,
  appUrl: string,
  adapter?: NotificationsAdapter,
): Promise<void> {
  const issued = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email, name: users.name, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1)
      .for('update')
    if (!user || user.emailVerifiedAt) return null

    const now = new Date()
    const recent = await tx
      .select({ createdAt: emailVerificationTokens.createdAt })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          gt(emailVerificationTokens.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
        ),
      )
      .orderBy(desc(emailVerificationTokens.createdAt))

    const coolingDown = recent[0] && now.getTime() - recent[0].createdAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS
    if (coolingDown || recent.length >= VERIFICATION_EMAILS_PER_HOUR) {
      console.info('[email-verification] resend throttled', { userId: user.id })
      return null
    }

    await tx
      .update(emailVerificationTokens)
      .set({ expiresAt: now })
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )

    const rawToken = await insertVerificationToken(tx, user.id, now)
    return { user, rawToken }
  })

  if (!issued) return
  await deliverVerificationEmail(issued.user, issued.rawToken, appUrl, adapter ?? getNotificationsAdapter())
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
