import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { signIn, signOut } from './auth'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN') {
  const email = `signin-${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`
  const [user] = await db.insert(users).values({ name: `Test ${role}`, email, role }).returning()
  return user
}

describe('signIn', () => {
  it('creates a session and returns userId + role + token + expiresAt for a seeded user', async () => {
    const user = await makeUser('ORGANIZER')

    const result = await signIn(user.email)

    expect(result.userId).toBe(user.id)
    expect(result.role).toBe('ORGANIZER')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.expiresAt).toBeInstanceOf(Date)

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows.length).toBe(1)
    expect(rows[0].token).toBe(result.token)
  })

  it('does not touch cookies — returns the raw token for the caller to set itself', async () => {
    const user = await makeUser('STUDENT')

    const result = await signIn(user.email)

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows[0].token).toBe(result.token)
  })

  it('throws User not found for an email with no seeded user', async () => {
    await expect(signIn(`nobody-${Date.now()}@test.com`)).rejects.toThrow('User not found')
  })

  it('throws Account suspended for a suspended user and does not create a session', async () => {
    const email = `signin-suspended-${Date.now()}-${Math.random()}@test.com`
    const [user] = await db
      .insert(users)
      .values({ name: 'Suspended User', email, role: 'ORGANIZER', suspended: true })
      .returning()

    await expect(signIn(user.email)).rejects.toThrow('Account suspended')

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows.length).toBe(0)
  })
})

describe('signOut', () => {
  it('destroys the session for the given token', async () => {
    const user = await makeUser('ADMIN')
    const { token } = await signIn(user.email)

    await signOut(token)

    const rows = await db.select().from(sessions).where(eq(sessions.token, token))
    expect(rows.length).toBe(0)
  })

  it('is a no-op when given an empty token', async () => {
    await expect(signOut('')).resolves.toBeUndefined()
  })

  it('is a no-op when given a token that does not exist', async () => {
    await expect(signOut('this-token-does-not-exist')).resolves.toBeUndefined()
  })
})

afterAll(async () => {
  await db.$client.end()
})
