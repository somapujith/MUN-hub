import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailVerificationTokens, users } from '@/lib/db/schema'
import {
  assertEmailVerifiedIfRequired,
  isEmailVerified,
  resendVerificationEmail,
  sendVerificationEmail,
  VERIFICATION_EMAILS_PER_HOUR,
  VERIFICATION_RESEND_COOLDOWN_MS,
  verifyEmail,
} from './email-verification'
import type { NotificationsAdapter } from '@/lib/notifications/adapter'

const APP_URL = 'http://localhost:5173'

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

async function makeUser() {
  const [user] = await db
    .insert(users)
    .values({ name: 'Verify Me', email: `verify-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  return user
}

function extractToken(body: string): string {
  const match = body.match(/token=([a-f0-9]+)/)
  if (!match) throw new Error('no token found in email body')
  return match[1]
}

describe('sendVerificationEmail', () => {
  it('stores only a hash, never the raw token, and emails a verify link', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()

    await sendVerificationEmail(user.id, APP_URL, adapter)

    expect(send).toHaveBeenCalledTimes(1)
    const body = send.mock.calls[0][0].body as string
    expect(body).toContain(`${APP_URL}/verify-email?token=`)
    const rawToken = extractToken(body)

    const rows = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toBe(rawToken)
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/) // sha256 hex digest
  })

  it('throws for a user id that does not resolve', async () => {
    const { adapter } = mockAdapter()
    await expect(sendVerificationEmail('00000000-0000-0000-0000-000000000000', APP_URL, adapter)).rejects.toThrow(
      'User not found',
    )
  })
})

describe('verifyEmail', () => {
  it('marks the user verified and the token used', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()
    await sendVerificationEmail(user.id, APP_URL, adapter)
    const rawToken = extractToken(send.mock.calls[0][0].body)

    expect(await isEmailVerified(user.id)).toBe(false)
    await verifyEmail(rawToken)
    expect(await isEmailVerified(user.id)).toBe(true)

    const [row] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id))
    expect(row.usedAt).not.toBeNull()
  })

  it('rejects a token that has already been used', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()
    await sendVerificationEmail(user.id, APP_URL, adapter)
    const rawToken = extractToken(send.mock.calls[0][0].body)

    await verifyEmail(rawToken)
    await expect(verifyEmail(rawToken)).rejects.toThrow('invalid or has expired')
  })

  it('rejects a token that was never issued', async () => {
    await expect(verifyEmail('not-a-real-token')).rejects.toThrow('invalid or has expired')
  })

  it('rejects an expired token', async () => {
    const user = await makeUser()
    // Random per run — a fixed string's hash would collide with leftover
    // rows from a prior run against this same local DB (tokenHash is unique).
    const rawToken = crypto.randomUUID() + crypto.randomUUID()
    const crypto2 = await import('node:crypto')
    const tokenHash = crypto2.createHash('sha256').update(rawToken).digest('hex')
    await db.insert(emailVerificationTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000), // already expired
    })

    await expect(verifyEmail(rawToken)).rejects.toThrow('invalid or has expired')
  })
})

/** Moves every verification token of `userId` `ms` into the past, as if it had been sent that long ago. */
async function backdateTokens(userId: string, ms: number) {
  const rows = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId))
  for (const row of rows) {
    await db
      .update(emailVerificationTokens)
      .set({ createdAt: new Date(row.createdAt.getTime() - ms) })
      .where(eq(emailVerificationTokens.id, row.id))
  }
}

describe('resendVerificationEmail', () => {
  it('invalidates the prior unused token and issues a new one', async () => {
    const user = await makeUser()
    const { adapter: adapter1, send: send1 } = mockAdapter()
    await sendVerificationEmail(user.id, APP_URL, adapter1)
    const firstToken = extractToken(send1.mock.calls[0][0].body)
    await backdateTokens(user.id, VERIFICATION_RESEND_COOLDOWN_MS + 1000)

    const { adapter: adapter2, send: send2 } = mockAdapter()
    await resendVerificationEmail(user.email, APP_URL, adapter2)
    expect(send2).toHaveBeenCalledTimes(1)
    const secondToken = extractToken(send2.mock.calls[0][0].body)

    // The older link stops working the moment a newer one is sent.
    await expect(verifyEmail(firstToken)).rejects.toThrow('invalid or has expired')
    await expect(verifyEmail(secondToken)).resolves.toBeUndefined()
  })

  it('resolves successfully for an email that does not match any account (no enumeration)', async () => {
    const { adapter, send } = mockAdapter()
    await expect(resendVerificationEmail('nobody-here@test.dev', APP_URL, adapter)).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends at most one email a minute, and a throttled request leaves the earlier link working', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()

    await resendVerificationEmail(user.email, APP_URL, adapter)
    for (let i = 0; i < 5; i += 1) await resendVerificationEmail(` ${user.email.toUpperCase()} `, APP_URL, adapter)

    expect(send).toHaveBeenCalledTimes(1)
    const rows = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id))
    expect(rows).toHaveLength(1)
    await expect(verifyEmail(extractToken(send.mock.calls[0][0].body))).resolves.toBeUndefined()
  })

  it('sends at most three emails an hour', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()

    for (let i = 0; i < VERIFICATION_EMAILS_PER_HOUR + 1; i += 1) {
      await resendVerificationEmail(user.email, APP_URL, adapter)
      // Past the one-minute cooldown, still inside the hour.
      await backdateTokens(user.id, VERIFICATION_RESEND_COOLDOWN_MS + 1000)
    }
    expect(send).toHaveBeenCalledTimes(VERIFICATION_EMAILS_PER_HOUR)

    // Once the earlier emails are more than an hour old, sending resumes.
    await backdateTokens(user.id, 60 * 60 * 1000)
    await resendVerificationEmail(user.email, APP_URL, adapter)
    expect(send).toHaveBeenCalledTimes(VERIFICATION_EMAILS_PER_HOUR + 1)
  })

  it('serializes concurrent requests for one account, so only one email goes out', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()

    await Promise.all(Array.from({ length: 5 }, () => resendVerificationEmail(user.email, APP_URL, adapter)))

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends nothing to an address that is already verified', async () => {
    const user = await makeUser()
    const { adapter, send } = mockAdapter()
    await sendVerificationEmail(user.id, APP_URL, adapter)
    await verifyEmail(extractToken(send.mock.calls[0][0].body))
    await backdateTokens(user.id, VERIFICATION_RESEND_COOLDOWN_MS + 1000)

    await resendVerificationEmail(user.email, APP_URL, adapter)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it("never puts the account's self-chosen name into the email", async () => {
    const [user] = await db
      .insert(users)
      .values({ name: 'Pay now at https://evil.example', email: `verify-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const { adapter, send } = mockAdapter()

    await resendVerificationEmail(user.email, APP_URL, adapter)
    await sendVerificationEmail(user.id, APP_URL, adapter)

    expect(send).toHaveBeenCalledTimes(2)
    for (const [message] of send.mock.calls) expect(message.body).not.toContain('evil.example')
  })
})

describe('assertEmailVerifiedIfRequired', () => {
  const ORIGINAL = process.env.REQUIRE_EMAIL_VERIFICATION

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION
    else process.env.REQUIRE_EMAIL_VERIFICATION = ORIGINAL
  })

  it('is a no-op when the flag is unset', async () => {
    delete process.env.REQUIRE_EMAIL_VERIFICATION
    const user = await makeUser()
    await expect(assertEmailVerifiedIfRequired(user.id)).resolves.toBeUndefined()
  })

  it('throws for an unverified user when the flag is "true"', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
    const user = await makeUser()
    await expect(assertEmailVerifiedIfRequired(user.id)).rejects.toThrow('verify your email')
  })

  it('does not throw for a verified user when the flag is "true"', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
    const user = await makeUser()
    const { adapter, send } = mockAdapter()
    await sendVerificationEmail(user.id, APP_URL, adapter)
    await verifyEmail(extractToken(send.mock.calls[0][0].body))

    await expect(assertEmailVerifiedIfRequired(user.id)).resolves.toBeUndefined()
  })
})
