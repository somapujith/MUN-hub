import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { recordPiiRead, toPiiReadRecord } from './admin-pii-read'

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await db.$client.end()
})

async function makeStaff() {
  const [user] = await db
    .insert(users)
    .values({ name: 'PII reader', email: `pii-reader-${crypto.randomUUID()}@test.dev`, role: 'OPERATIONS' })
    .returning()
  return user
}

describe('toPiiReadRecord', () => {
  it('files a single-record read against that record', () => {
    expect(
      toPiiReadRecord({ actorId: 'a', route: 'GET /admin/x', targetType: 'registration', targetIds: ['r1'], hasQuery: false }),
    ).toEqual({
      actorId: 'a',
      targetType: 'registration',
      targetId: 'r1',
      metadata: { route: 'GET /admin/x', recordType: 'registration', targetIds: ['r1'], count: 1, hasQuery: false },
    })
  })

  it('files a list read against the route', () => {
    expect(
      toPiiReadRecord({ actorId: 'a', route: 'GET /admin/x', targetType: 'payment', targetIds: ['p1', 'p2'], hasQuery: true }),
    ).toMatchObject({ targetType: 'payment_list', targetId: 'GET /admin/x', metadata: { count: 2, hasQuery: true } })
  })

  it('returns null for a read that returned nothing', () => {
    expect(
      toPiiReadRecord({ actorId: 'a', route: 'GET /admin/x', targetType: 'registration', targetIds: [], hasQuery: true }),
    ).toBeNull()
  })
})

describe('recordPiiRead', () => {
  it('writes one PII_READ admin_actions row', async () => {
    const staff = await makeStaff()

    await recordPiiRead({
      actorId: staff.id,
      route: 'GET /admin/registrations',
      targetType: 'registration',
      targetIds: ['r1', 'r2'],
      hasQuery: true,
    })

    const rows = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.actorId, staff.id), eq(adminActions.action, 'PII_READ')))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ targetType: 'registration_list', targetId: 'GET /admin/registrations', reason: null })
    expect(rows[0].metadata).toEqual({
      route: 'GET /admin/registrations',
      recordType: 'registration',
      targetIds: ['r1', 'r2'],
      count: 2,
      hasQuery: true,
    })
  })

  it('writes nothing for an empty read', async () => {
    const staff = await makeStaff()
    expect(
      await recordPiiRead({ actorId: staff.id, route: 'r', targetType: 'registration', targetIds: [], hasQuery: false }),
    ).toBeNull()
    expect(await db.select().from(adminActions).where(eq(adminActions.actorId, staff.id))).toEqual([])
  })

  it('never throws: a failed insert goes to the error log instead', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Not a real user, so the actor foreign key rejects the insert.
    const actorId = `missing-${crypto.randomUUID()}`

    await expect(
      recordPiiRead({ actorId, route: 'GET /admin/registrations', targetType: 'registration', targetIds: ['r1'], hasQuery: false }),
    ).resolves.toMatchObject({ targetId: 'r1' })

    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({
      event: 'pii_read.audit_failed',
      actorId,
      targetType: 'registration',
      targetId: 'r1',
      route: 'GET /admin/registrations',
    })
  })
})
