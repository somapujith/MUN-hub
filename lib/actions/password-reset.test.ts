import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { passwordResetTokens, sessions, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { hashOpaqueToken } from '@/lib/auth/opaque-token'
import { createSession, getSessionByToken } from '@/lib/auth/session'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import { signIn } from './auth'
import {
  RESET_REQUESTS_PER_HOUR,
  RESET_REQUEST_COOLDOWN_MS,
  insertPasswordResetToken,
  requestPasswordReset,
  resetPassword,
} from './password-reset'

let sendSpy: MockInstance<(notification: NotificationPayload) => Promise<void>>

beforeEach(() => {
  sendSpy = vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
})

afterEach(() => {
  sendSpy.mockRestore()
})

async function createTestUser(password = 'original-password-1') {
  const email = `password-reset-${Date.now()}-${Math.random()}@test.com`
  const passwordHash = await hashPassword(password)
  const [user] = await db.insert(users).values({ name: 'Test User', email, role: 'STUDENT', passwordHash }).returning()
  return user
}

/** The token in the newest reset link emailed to `email` (only the email ever holds it in plaintext). */
function lastEmailedToken(email: string): string {
  const call = sendSpy.mock.calls.filter(([notification]) => notification.to === email).at(-1)
  const token = call?.[0].body.match(/reset-password\?token=([0-9a-f]{64})/)?.[1]
  if (!token) throw new Error(`no reset link emailed to ${email}`)
  return token
}

function tokenRowsFor(userId: string) {
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
}

/** Moves every reset token of the user back in time, as if requested `ms` ago. */
async function ageTokens(userId: string, ms: number) {
  const rows = await tokenRowsFor(userId)
  for (const row of rows) {
    await db
      .update(passwordResetTokens)
      .set({ createdAt: new Date(row.createdAt.getTime() - ms) })
      .where(eq(passwordResetTokens.id, row.id))
  }
}

describe('requestPasswordReset', () => {
  it('inserts exactly one unused token expiring roughly 1 hour out for a matching email', async () => {
    const user = await createTestUser()

    await requestPasswordReset(user.email, 'http://localhost:3000')

    const rows = await tokenRowsFor(user.id)
    expect(rows.length).toBe(1)
    expect(rows[0].usedAt).toBeNull()

    const minutesFromNow = (rows[0].expiresAt.getTime() - Date.now()) / (60 * 1000)
    expect(minutesFromNow).toBeGreaterThan(55)
    expect(minutesFromNow).toBeLessThan(65)
  })

  it('emails a link on the given app URL and stores only the hash of its token', async () => {
    const user = await createTestUser()

    await requestPasswordReset(user.email, 'https://munhub.in')

    const token = lastEmailedToken(user.email)
    expect(sendSpy.mock.calls.at(-1)?.[0].body).toContain(`https://munhub.in/reset-password?token=${token}`)
    const [row] = await tokenRowsFor(user.id)
    expect(row.token).toBe(hashOpaqueToken(token))
    expect(row.token).not.toBe(token)
  })

  it('does not throw and does not insert a token for an unknown email', async () => {
    const email = `nobody-${Date.now()}-${Math.random()}@test.com`

    await expect(requestPasswordReset(email, 'http://localhost:3000')).resolves.toBeUndefined()

    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    expect(row).toBeUndefined()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('silently ignores a second request inside the cooldown', async () => {
    const user = await createTestUser()

    await requestPasswordReset(user.email, 'http://localhost:3000')
    await expect(requestPasswordReset(user.email, 'http://localhost:3000')).resolves.toBeUndefined()

    expect(await tokenRowsFor(user.id)).toHaveLength(1)
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('allows another request once the cooldown has passed, up to the hourly cap', async () => {
    const user = await createTestUser()

    for (let i = 0; i < RESET_REQUESTS_PER_HOUR + 1; i += 1) {
      await requestPasswordReset(user.email, 'http://localhost:3000')
      await ageTokens(user.id, RESET_REQUEST_COOLDOWN_MS + 1000)
    }

    expect(await tokenRowsFor(user.id)).toHaveLength(RESET_REQUESTS_PER_HOUR)
    expect(sendSpy).toHaveBeenCalledTimes(RESET_REQUESTS_PER_HOUR)

    // An hour later the cap has rolled over.
    await ageTokens(user.id, 60 * 60 * 1000)
    await requestPasswordReset(user.email, 'http://localhost:3000')
    expect(await tokenRowsFor(user.id)).toHaveLength(RESET_REQUESTS_PER_HOUR + 1)
  })
})

describe('insertPasswordResetToken', () => {
  it('returns a raw token that resetPassword accepts, storing only its hash (also inside a transaction)', async () => {
    const user = await createTestUser('original-password-1')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const token = await db.transaction((tx) => insertPasswordResetToken(tx, user.id, expiresAt))

    const [row] = await tokenRowsFor(user.id)
    expect(row.token).toBe(hashOpaqueToken(token))
    expect(row.expiresAt.getTime()).toBe(expiresAt.getTime())

    await resetPassword(token, 'set-by-link-password')
    await expect(signIn(user.email, 'set-by-link-password')).resolves.toMatchObject({ userId: user.id })
  })
})

describe('resetPassword', () => {
  async function requestAndGetToken(email: string) {
    await requestPasswordReset(email, 'http://localhost:3000')
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    return { user, token: lastEmailedToken(email) }
  }

  async function tokenRow(token: string) {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, hashOpaqueToken(token)))
      .limit(1)
    return row
  }

  it('succeeds with a valid token: signs in with the new password, old password no longer works', async () => {
    const user = await createTestUser('original-password-1')
    const { token } = await requestAndGetToken(user.email)

    await resetPassword(token, 'brand-new-password-1')

    await expect(signIn(user.email, 'brand-new-password-1')).resolves.toMatchObject({ userId: user.id })
    await expect(signIn(user.email, 'original-password-1')).rejects.toThrow('Invalid email or password')
  })

  it('marks the token row usedAt after a successful reset', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    await resetPassword(token, 'brand-new-password-1')

    expect((await tokenRow(token)).usedAt).not.toBeNull()
  })

  it('also spends any other outstanding reset links for the account', async () => {
    const user = await createTestUser()
    const { token: first } = await requestAndGetToken(user.email)
    await ageTokens(user.id, RESET_REQUEST_COOLDOWN_MS + 1000)
    const { token: second } = await requestAndGetToken(user.email)
    expect(second).not.toBe(first)

    await resetPassword(second, 'brand-new-password-1')

    await expect(resetPassword(first, 'another-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('deletes all prior sessions for the user after a successful reset', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)
    const existing = await createSession(user.id)

    await resetPassword(token, 'brand-new-password-1')

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(remaining.length).toBe(0)
    expect(await getSessionByToken(existing.token)).toBeNull()
  })

  it('throws "This reset link is invalid or has expired" when the same token is used a second time', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    await resetPassword(token, 'brand-new-password-1')

    await expect(resetPassword(token, 'another-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('lets exactly one of two concurrent submissions of the same link succeed', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    const results = await Promise.allSettled([
      resetPassword(token, 'concurrent-password-a'),
      resetPassword(token, 'concurrent-password-b'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect((rejected as PromiseRejectedResult).reason.message).toBe('This reset link is invalid or has expired')
  })

  it('throws "This reset link is invalid or has expired" for an expired token', async () => {
    const user = await createTestUser()
    const token = `expired-token-${Math.random()}`
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() - 60 * 1000),
    })

    await expect(resetPassword(token, 'brand-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('throws "This reset link is invalid or has expired" for an unknown token', async () => {
    await expect(resetPassword('this-token-does-not-exist', 'brand-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('does not accept the stored digest in place of the emailed token', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    await expect(resetPassword(hashOpaqueToken(token), 'brand-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('throws "Password must be at least 8 characters" for a too-short password, leaving the token usable', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    await expect(resetPassword(token, 'short')).rejects.toThrow('Password must be at least 8 characters')

    expect((await tokenRow(token)).usedAt).toBeNull()
  })
})

afterAll(async () => {
  await db.$client.end()
})
