import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { recordAdminAction } from './log'

describe('recordAdminAction', () => {
  it('inserts an admin_actions row with the given fields', async () => {
    const [actor] = await db
      .insert(users)
      .values({ name: 'Test Admin', email: `admin-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    await db.transaction(async (tx) => {
      await recordAdminAction(tx, actor.id, 'MUN_SUSPENDED', 'mun', 'some-mun-id', 'policy violation')
    })

    const [row] = await db.select().from(adminActions).where(eq(adminActions.actorId, actor.id))
    expect(row.action).toBe('MUN_SUSPENDED')
    expect(row.targetType).toBe('mun')
    expect(row.targetId).toBe('some-mun-id')
    expect(row.reason).toBe('policy violation')
  })
})
