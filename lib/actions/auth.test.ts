import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

// `next/headers` cookies() requires a real Next.js request context, which
// Vitest doesn't provide. We test the underlying session-creation/destruction
// logic directly against the real DB (the part with actual behavior worth
// verifying), and separately smoke-test that signIn/signOut call the cookie
// store's set/delete with the right arguments via a mocked `cookies()`.
const cookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}))

import { signIn, signOut } from './auth'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN') {
  const email = `signin-${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`
  const [user] = await db.insert(users).values({ name: `Test ${role}`, email, role }).returning()
  return user
}

describe('signIn', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates a session and returns userId + role for a seeded user', async () => {
    const user = await makeUser('ORGANIZER')

    const result = await signIn(user.email)

    expect(result.userId).toBe(user.id)
    expect(result.role).toBe('ORGANIZER')

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows.length).toBe(1)
  })

  it('sets an httpOnly mun_hub_session cookie with the session token', async () => {
    const user = await makeUser('STUDENT')

    await signIn(user.email)

    expect(cookieStore.set).toHaveBeenCalledTimes(1)
    const [name, token, options] = cookieStore.set.mock.calls[0]
    expect(name).toBe(SESSION_COOKIE_NAME)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
    expect(options).toMatchObject({ httpOnly: true })

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows[0].token).toBe(token)
  })

  it('throws User not found for an email with no seeded user', async () => {
    await expect(signIn(`nobody-${Date.now()}@test.com`)).rejects.toThrow('User not found')
  })
})

describe('signOut', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('destroys the session for the current cookie token and clears the cookie', async () => {
    const user = await makeUser('ADMIN')
    await signIn(user.email)
    const token = cookieStore.set.mock.calls[0][1]

    cookieStore.get.mockReturnValue({ value: token })

    await signOut()

    const rows = await db.select().from(sessions).where(eq(sessions.token, token))
    expect(rows.length).toBe(0)
    expect(cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE_NAME)
  })

  it('is a no-op when there is no session cookie', async () => {
    cookieStore.get.mockReturnValue(undefined)
    await expect(signOut()).resolves.toBeUndefined()
  })
})

afterAll(async () => {
  await db.$client.end()
})
