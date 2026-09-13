import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session'

// Mock next/headers `cookies()` so getSession() (called internally by every
// organizer-admin action) can read a token we control per-test, without a
// real Next.js request context. Same pattern as lib/actions/admin-review.test.ts.
let currentToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && currentToken ? { value: currentToken } : undefined),
  }),
}))

import { listOrganizers, reinstateOrganizer, suspendOrganizer } from './organizer-admin'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `${role}-${Date.now()}`, email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

async function sessionFor(userId: string) {
  const { token } = await createSession(userId)
  return token
}

describe('suspendOrganizer', () => {
  it('sets suspended=true, suspendedReason, suspendedAt, and logs ORGANIZER_SUSPENDED', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    currentToken = await sessionFor(admin.id)

    await suspendOrganizer(organizer.id, 'policy violation')

    const [updated] = await db.select().from(users).where(eq(users.id, organizer.id))
    expect(updated.suspended).toBe(true)
    expect(updated.suspendedReason).toBe('policy violation')
    expect(updated.suspendedAt).not.toBeNull()

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, organizer.id))
    expect(log.action).toBe('ORGANIZER_SUSPENDED')
    expect(log.actorId).toBe(admin.id)
    expect(log.reason).toBe('policy violation')
  })

  it('throws Forbidden for a non-admin session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)

    await expect(suspendOrganizer(organizer.id, 'x')).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    const organizer = await makeUser('ORGANIZER')
    currentToken = undefined

    await expect(suspendOrganizer(organizer.id, 'x')).rejects.toThrow('Forbidden')
  })

  it('allows OPERATIONS to suspend', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    currentToken = await sessionFor(ops.id)

    await suspendOrganizer(organizer.id, 'ops call')

    const [updated] = await db.select().from(users).where(eq(users.id, organizer.id))
    expect(updated.suspended).toBe(true)
  })
})

describe('reinstateOrganizer', () => {
  it('clears suspended fields and logs ORGANIZER_REINSTATED', async () => {
    const admin = await makeUser('ADMIN')
    const [organizer] = await db
      .insert(users)
      .values({
        name: 'Org3',
        email: `org3-${Date.now()}-${Math.random()}@test.dev`,
        role: 'ORGANIZER',
        suspended: true,
        suspendedReason: 'x',
        suspendedAt: new Date(),
      })
      .returning()

    currentToken = await sessionFor(admin.id)
    await reinstateOrganizer(organizer.id)

    const [updated] = await db.select().from(users).where(eq(users.id, organizer.id))
    expect(updated.suspended).toBe(false)
    expect(updated.suspendedReason).toBeNull()
    expect(updated.suspendedAt).toBeNull()

    const [log] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, organizer.id))
      .orderBy(adminActions.createdAt)
    expect(log.action).toBe('ORGANIZER_REINSTATED')
    expect(log.actorId).toBe(admin.id)
  })

  it('throws Forbidden for a non-admin session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)

    await expect(reinstateOrganizer(organizer.id)).rejects.toThrow('Forbidden')
  })
})

describe('listOrganizers', () => {
  it('returns only ORGANIZER-role users, paginated, with total count', async () => {
    const admin = await makeUser('ADMIN')
    // Results are ordered by name — the local dev DB has accumulated many
    // thousands of organizer rows from historical test runs (documented in
    // CLAUDE.md), so a fresh row is no longer guaranteed to land on a small
    // bounded page even with a "!" prefix meant to sort first (the "!"
    // prefix itself has accumulated enough prior rows to push newer ones
    // off a `limit: 5` page). `listOrganizers` has no name/query filter to
    // fetch this row directly, so the simplest fix that doesn't depend on
    // pagination position is a limit generous enough to outrun the
    // accumulated junk. This increasingly needs a real filter/query
    // capability as local test data keeps growing — out of scope for this
    // fix, noted here for whoever picks it up next.
    const [organizer] = await db
      .insert(users)
      .values({ name: `!list-test-org-${Date.now()}`, email: `org-${Date.now()}-${Math.random()}@test.dev`, role: 'ORGANIZER' })
      .returning()
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(admin.id)

    const { results, total } = await listOrganizers({ limit: 1000, offset: 0 })
    expect(Array.isArray(results)).toBe(true)
    expect(typeof total).toBe('number')
    expect(results.some((r) => r.id === organizer.id)).toBe(true)
    expect(results.some((r) => r.id === student.id)).toBe(false)
    expect(results.every((r) => !('role' in r))).toBe(true)
  })

  it('paginates with limit/offset', async () => {
    const admin = await makeUser('ADMIN')
    for (let i = 0; i < 3; i++) {
      await makeUser('ORGANIZER')
    }
    currentToken = await sessionFor(admin.id)

    const page1 = await listOrganizers({ limit: 2, offset: 0 })
    expect(page1.results.length).toBe(2)
    expect(page1.total).toBeGreaterThanOrEqual(3)
  })

  it('allows OPERATIONS role', async () => {
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const { results, total } = await listOrganizers({ limit: 5 })
    expect(Array.isArray(results)).toBe(true)
    expect(typeof total).toBe('number')
  })

  it('throws Forbidden for a non-admin session', async () => {
    const organizer = await makeUser('ORGANIZER')
    currentToken = await sessionFor(organizer.id)

    await expect(listOrganizers()).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
