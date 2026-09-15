import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, muns, users, verificationLogs } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'

import { getAuditHistory } from './audit-history'

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

describe('getAuditHistory', () => {
  it('merges admin_actions and verification_logs for a mun, sorted by timestamp', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    const __actor = sess(admin)

    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Audit Mun', slug: `audit-mun-${crypto.randomUUID()}` })
      .returning()

    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'PUBLISHED' })
    await db.insert(adminActions).values({ actorId: admin.id, action: 'MUN_SUSPENDED', targetType: 'mun', targetId: mun.id, reason: 'x' })

    const history = await getAuditHistory('mun', mun.id, __actor, actor)
    expect(history.length).toBe(2)
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['PUBLISHED', 'MUN_SUSPENDED']))
    // Sorted oldest-first.
    expect(history[0].createdAt.getTime()).toBeLessThanOrEqual(history[1].createdAt.getTime())
  })

  it('returns only admin_actions rows for a non-mun targetType', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    const __actor = sess(admin)

    await db.insert(adminActions).values({
      actorId: admin.id,
      action: 'ORGANIZER_SUSPENDED',
      targetType: 'user',
      targetId: organizer.id,
      reason: 'fraud',
    })

    const history = await getAuditHistory('user', organizer.id, __actor, actor)
    expect(history.length).toBe(1)
    expect(history[0].action).toBe('ORGANIZER_SUSPENDED')
  })

  it('filters by targetType, not just targetId, when two rows share the same targetId', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    const __actor = sess(admin)

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

    const history = await getAuditHistory('mun', mun.id, __actor, actor)
    expect(history.length).toBe(1)
    expect(history[0].action).toBe('MUN_SUSPENDED')
  })

  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    const __actor = sess(student)
    await expect(getAuditHistory('mun', 'some-id', __actor, actor)).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    const __actor = null as Session | null
    await expect(getAuditHistory('mun', 'some-id', __actor, actor)).rejects.toThrow('Forbidden')
  })
})
