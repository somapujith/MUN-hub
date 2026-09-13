import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, muns, users, verificationLogs } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session'

// Same pattern as lib/actions/admin-review.test.ts: mock next/headers
// `cookies()` so getSession() (called internally by getAuditHistory) can
// read a token we control per-test, without a real Next.js request context.
let currentToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && currentToken ? { value: currentToken } : undefined),
  }),
}))

import { getAuditHistory } from './audit-history'

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

describe('getAuditHistory', () => {
  it('merges admin_actions and verification_logs for a mun, sorted by timestamp', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    currentToken = await sessionFor(admin.id)

    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Audit Mun', slug: `audit-mun-${crypto.randomUUID()}` })
      .returning()

    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'PUBLISHED' })
    await db.insert(adminActions).values({ actorId: admin.id, action: 'MUN_SUSPENDED', targetType: 'mun', targetId: mun.id, reason: 'x' })

    const history = await getAuditHistory('mun', mun.id)
    expect(history.length).toBe(2)
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['PUBLISHED', 'MUN_SUSPENDED']))
    // Sorted oldest-first.
    expect(history[0].createdAt.getTime()).toBeLessThanOrEqual(history[1].createdAt.getTime())
  })

  it('returns only admin_actions rows for a non-mun targetType', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    currentToken = await sessionFor(admin.id)

    await db.insert(adminActions).values({
      actorId: admin.id,
      action: 'ORGANIZER_SUSPENDED',
      targetType: 'user',
      targetId: organizer.id,
      reason: 'fraud',
    })

    const history = await getAuditHistory('user', organizer.id)
    expect(history.length).toBe(1)
    expect(history[0].action).toBe('ORGANIZER_SUSPENDED')
  })

  it('filters by targetType, not just targetId, when two rows share the same targetId', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    currentToken = await sessionFor(admin.id)

    // Same targetId, different targetType — a real (if unusual) collision
    // since targetId is a bare text column with no FK, shared across every
    // target type. getAuditHistory must not return the 'user' row when asked
    // for 'mun' history on this id, and vice versa.
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Collision Mun', slug: `collision-mun-${crypto.randomUUID()}` })
      .returning()

    await db.insert(adminActions).values({
      actorId: admin.id,
      action: 'MUN_SUSPENDED',
      targetType: 'mun',
      targetId: mun.id,
      reason: 'mun row',
    })
    await db.insert(adminActions).values({
      actorId: admin.id,
      action: 'ORGANIZER_SUSPENDED',
      targetType: 'user',
      targetId: mun.id,
      reason: 'user row with the same id as the mun above',
    })

    const history = await getAuditHistory('mun', mun.id)
    expect(history.length).toBe(1)
    expect(history[0].action).toBe('MUN_SUSPENDED')
  })

  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)
    await expect(getAuditHistory('mun', 'some-id')).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    currentToken = undefined
    await expect(getAuditHistory('mun', 'some-id')).rejects.toThrow('Forbidden')
  })
})
