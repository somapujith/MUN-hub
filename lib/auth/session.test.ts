import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

// `next/headers` cookies() requires a real Next.js request context, which
// Vitest doesn't provide — same mocking pattern as lib/actions/auth.test.ts.
const cookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}))

import { createSession, getSession } from './session'

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const email = `session-test-${Date.now()}-${Math.random()}@test.dev`
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email, role: 'ORGANIZER', ...overrides })
    .returning()
  return user
}

describe('getSession with suspended user', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for a suspended user even with a valid session token', async () => {
    const user = await makeUser({ suspended: true })

    const { token } = await createSession(user.id)
    cookieStore.get.mockReturnValue({ value: token })

    const session = await getSession()
    expect(session).toBeNull()
  })

  it('still returns the session for a non-suspended user with a valid token', async () => {
    const user = await makeUser({ suspended: false })

    const { token } = await createSession(user.id)
    cookieStore.get.mockReturnValue({ value: token })

    const session = await getSession()
    expect(session).toEqual({ userId: user.id, role: user.role })
  })
})

afterAll(async () => {
  await db.$client.end()
})
