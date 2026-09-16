import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { passwordResetTokens, sessions, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { signIn } from './auth'
import { requestPasswordReset, resetPassword } from './password-reset'

async function createTestUser(password = 'original-password-1') {
  const email = `password-reset-${Date.now()}-${Math.random()}@test.com`
  const passwordHash = await hashPassword(password)
  const [user] = await db.insert(users).values({ name: 'Test User', email, role: 'STUDENT', passwordHash }).returning()
  return user
}

describe('requestPasswordReset', () => {
  it('inserts exactly one unused token expiring roughly 1 hour out for a matching email', async () => {
    const user = await createTestUser()

    await requestPasswordReset(user.email, 'http://localhost:3000')

    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
    expect(rows.length).toBe(1)
    expect(rows[0].usedAt).toBeNull()

    const minutesFromNow = (rows[0].expiresAt.getTime() - Date.now()) / (60 * 1000)
    expect(minutesFromNow).toBeGreaterThan(55)
    expect(minutesFromNow).toBeLessThan(65)
  })

  it('does not throw and does not insert a token for an unknown email', async () => {
    const email = `nobody-${Date.now()}-${Math.random()}@test.com`

    await expect(requestPasswordReset(email, 'http://localhost:3000')).resolves.toBeUndefined()

    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    expect(row).toBeUndefined()
  })
})

describe('resetPassword', () => {
  async function requestAndGetToken(email: string) {
    await requestPasswordReset(email, 'http://localhost:3000')
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id))
      .limit(1)
    return { user, token: tokenRow.token }
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

    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)).limit(1)
    expect(row.usedAt).not.toBeNull()
  })

  it('deletes all prior sessions for the user after a successful reset', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)
    await db.insert(sessions).values({ userId: user.id, token: `existing-session-${Math.random()}`, expiresAt: new Date(Date.now() + 60 * 60 * 1000) })

    await resetPassword(token, 'brand-new-password-1')

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(remaining.length).toBe(0)
  })

  it('throws "This reset link is invalid or has expired" when the same token is used a second time', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    await resetPassword(token, 'brand-new-password-1')

    await expect(resetPassword(token, 'another-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('throws "This reset link is invalid or has expired" for an expired token', async () => {
    const user = await createTestUser()
    const [row] = await db
      .insert(passwordResetTokens)
      .values({
        userId: user.id,
        token: `expired-token-${Math.random()}`,
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
      .returning()

    await expect(resetPassword(row.token, 'brand-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('throws "This reset link is invalid or has expired" for an unknown token', async () => {
    await expect(resetPassword('this-token-does-not-exist', 'brand-new-password-1')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('throws "Password must be at least 8 characters" for a too-short password, leaving the token usable', async () => {
    const user = await createTestUser()
    const { token } = await requestAndGetToken(user.email)

    await expect(resetPassword(token, 'short')).rejects.toThrow('Password must be at least 8 characters')

    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)).limit(1)
    expect(row.usedAt).toBeNull()
  })
})

afterAll(async () => {
  await db.$client.end()
})
