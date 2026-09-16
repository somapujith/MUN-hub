import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'

import { listOrganizers, reinstateOrganizer, suspendOrganizer } from './organizer-admin'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `${role}-${Date.now()}`, email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

function sess(user: { id: string; role: Session['role'] }): Session {
  return { userId: user.id, role: user.role }
}

describe('suspendOrganizer', () => {
  it('sets suspended=true, suspendedReason, suspendedAt, and logs ORGANIZER_SUSPENDED', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    const __actor = sess(admin)

    await suspendOrganizer(organizer.id, 'policy violation', __actor)

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
    const __actor = sess(student)

    await expect(suspendOrganizer(organizer.id, 'x', __actor)).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const __actor = null as Session | null

    await expect(suspendOrganizer(organizer.id, 'x', __actor)).rejects.toThrow('Forbidden')
  })

  it('allows OPERATIONS to suspend', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const __actor = sess(ops)

    await suspendOrganizer(organizer.id, 'ops call', __actor)

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

    const __actor = sess(admin)
    await reinstateOrganizer(organizer.id, __actor)

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
    const __actor = sess(student)

    await expect(reinstateOrganizer(organizer.id, __actor)).rejects.toThrow('Forbidden')
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
    // off a `limit: 5` page). A limit generous enough to outrun the
    // accumulated junk keeps this assertion independent of pagination
    // position (the `search` param added below is the real fix for new
    // callers; this test intentionally exercises the unfiltered path too).
    const [organizer] = await db
      .insert(users)
      .values({ name: `!list-test-org-${Date.now()}`, email: `org-${Date.now()}-${Math.random()}@test.dev`, role: 'ORGANIZER' })
      .returning()
    const student = await makeUser('STUDENT')
    const __actor = sess(admin)

    const { results, total } = await listOrganizers({ limit: 1000, offset: 0 }, __actor)
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
    const __actor = sess(admin)

    const page1 = await listOrganizers({ limit: 2, offset: 0 }, __actor)
    expect(page1.results.length).toBe(2)
    expect(page1.total).toBeGreaterThanOrEqual(3)
  })

  it('allows OPERATIONS role', async () => {
    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    const { results, total } = await listOrganizers({ limit: 5 }, __actor)
    expect(Array.isArray(results)).toBe(true)
    expect(typeof total).toBe('number')
  })

  it('throws Forbidden for a non-admin session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const __actor = sess(organizer)

    await expect(listOrganizers({}, __actor)).rejects.toThrow('Forbidden')
  })

  it('filters by search against name or email (case-insensitive substring)', async () => {
    const admin = await makeUser('ADMIN')
    const unique = `Zellandia-${Date.now()}`
    const [organizer] = await db
      .insert(users)
      .values({
        name: `${unique} MUN Society`,
        email: `contact-${Date.now()}-${Math.random()}@test.dev`,
        role: 'ORGANIZER',
      })
      .returning()
    const __actor = sess(admin)

    const byName = await listOrganizers({ search: unique.toLowerCase() }, __actor)
    expect(byName.results.map((r) => r.id)).toContain(organizer.id)

    const byEmail = await listOrganizers({ search: organizer.email.toUpperCase() }, __actor)
    expect(byEmail.results.map((r) => r.id)).toEqual([organizer.id])

    const noMatch = await listOrganizers({ search: `no-such-organizer-${Date.now()}` }, __actor)
    expect(noMatch.results).toEqual([])
    expect(noMatch.total).toBe(0)
  })
})

afterAll(async () => {
  await db.$client.end()
})
