import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { createSession, getSessionByToken } from './session'

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const email = `session-test-${Date.now()}-${Math.random()}@test.dev`
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email, role: 'ORGANIZER', ...overrides })
    .returning()
  return user
}

describe('getSessionByToken', () => {
  it('returns the actor identity for a valid, unexpired token', async () => {
    const user = await makeUser({ suspended: false })
    const { token } = await createSession(user.id)

    const session = await getSessionByToken(token)
    expect(session).toEqual({ userId: user.id, role: user.role })
  })

  it('returns null for a nonexistent token', async () => {
    const session = await getSessionByToken('this-token-does-not-exist')
    expect(session).toBeNull()
  })

  it('returns null for an empty token', async () => {
    const session = await getSessionByToken('')
    expect(session).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const user = await makeUser({ suspended: false })
    const { token } = await createSession(user.id)

    // Directly expire the session row rather than waiting out the 30-day TTL.
    const { sessions } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.token, token))

    const session = await getSessionByToken(token)
    expect(session).toBeNull()
  })

  it('returns null for a suspended user even with a valid session token', async () => {
    const user = await makeUser({ suspended: true })
    const { token } = await createSession(user.id)

    const session = await getSessionByToken(token)
    expect(session).toBeNull()
  })

  it('still returns the session for a non-suspended user with a valid token', async () => {
    const user = await makeUser({ suspended: false })
    const { token } = await createSession(user.id)

    const session = await getSessionByToken(token)
    expect(session).toEqual({ userId: user.id, role: user.role })
  })
})

afterAll(async () => {
  await db.$client.end()
})
