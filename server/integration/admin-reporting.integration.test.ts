import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders } from './helpers'

const app = createApp()

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

async function makeUser(role: AnyRole) {
  const [user] = await db
    .insert(users)
    .values({ name: `reporting api ${role}`, email: `reporting-api-${crypto.randomUUID()}@test.dev`, role })
    .returning()
  return user
}

async function get(userId: string | null, path: string) {
  return app.request(`/api/v1${path}`, { headers: userId ? await authHeaders(userId) : {} })
}

const REPORTING_ROUTES = [
  '/admin/reporting/trends?days=30&granularity=day',
  '/admin/reporting/funnel?days=30',
  '/admin/reporting/top-conferences?days=30',
  '/admin/reporting/organizers?days=30',
  '/admin/reporting/geography?days=30',
  '/admin/reporting/fees?days=30',
]

describe('GET /api/v1/admin/reporting/*', () => {
  it.each(REPORTING_ROUTES)('is staff-only: refuses a delegate (403) and an anonymous caller (401) — %s', async (path) => {
    const delegate = await makeUser('STUDENT')
    expect((await get(delegate.id, path)).status).toBe(403)
    expect((await get(null, path)).status).toBe(401)
  })

  it.each(REPORTING_ROUTES)('is reachable by OPERATIONS/ADMIN/SUPER_ADMIN — %s', async (path) => {
    for (const role of ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const) {
      const staff = await makeUser(role)
      expect((await get(staff.id, path)).status).toBe(200)
    }
  })

  it.each([
    'days=1&granularity=day',
    'days=&granularity=day',
    'days=30&granularity=month',
  ])('rejects an out-of-enum query param with 400 — %s', async (query) => {
    const admin = await makeUser('ADMIN')
    const res = await get(admin.id, `/admin/reporting/trends?${query}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/admin/reporting/trends', () => {
  it('returns zero-filled registrations, revenue and signup series for the range', async () => {
    const admin = await makeUser('ADMIN')
    const res = await get(admin.id, '/admin/reporting/trends?days=7&granularity=day')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.registrations).toHaveLength(8)
    expect(body.revenue.gross).toHaveLength(8)
    expect(body.revenue.net).toHaveLength(8)
    expect(body.signups.organizers).toHaveLength(8)
    expect(body.signups.delegates).toHaveLength(8)
    expect(body.registrations[0]).toHaveProperty('bucket')
    expect(body.registrations[0]).toHaveProperty('value')
  })
})

describe('GET /api/v1/admin/reporting/funnel', () => {
  it('returns the registration and payment funnel shape', async () => {
    const admin = await makeUser('ADMIN')
    const res = await get(admin.id, '/admin/reporting/funnel?days=30')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.registrations).toMatchObject({
      started: expect.any(Number),
      confirmed: expect.any(Number),
      cancelled: expect.any(Number),
      conversionRate: expect.any(Number),
    })
    expect(body.payments).toMatchObject({
      totalPayments: expect.any(Number),
      paid: expect.any(Number),
      failed: expect.any(Number),
      successRate: expect.any(Number),
      exceptionsOpened: expect.any(Number),
      exceptionRate: expect.any(Number),
    })
  })
})

describe('GET /api/v1/admin/reporting/top-conferences', () => {
  // Ranking/grouping correctness (including the "out-rank the current #1"
  // determinism technique against a shared, never-cleaned dev DB) is covered
  // by lib/actions/admin-reporting.test.ts, which tracks and deletes every
  // row it creates. This is a route-wiring check only — shape and 200 — so
  // it doesn't need to create data (let alone leave permanent, ever-growing
  // rows behind for every future run of the suite to find).
  it('returns byRegistrations/byRevenue arrays shaped with munId/name/slug/value', async () => {
    const admin = await makeUser('ADMIN')
    const res = await get(admin.id, '/admin/reporting/top-conferences?days=30')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.byRegistrations)).toBe(true)
    expect(Array.isArray(body.byRevenue)).toBe(true)
    for (const row of [...body.byRegistrations, ...body.byRevenue]) {
      expect(row).toMatchObject({ munId: expect.any(String), name: expect.any(String), slug: expect.any(String), value: expect.any(Number) })
    }
  })
})

describe('GET /api/v1/admin/reporting/geography', () => {
  it('returns rows shaped with city/country/registrationCount/revenue', async () => {
    const admin = await makeUser('ADMIN')
    const res = await get(admin.id, '/admin/reporting/geography?days=30')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    if (body.length > 0) {
      expect(body[0]).toHaveProperty('registrationCount')
      expect(body[0]).toHaveProperty('revenue')
    }
  })
})

describe('GET /api/v1/admin/reporting/fees', () => {
  it('returns platform fee rows shaped per currency', async () => {
    const admin = await makeUser('ADMIN')
    const res = await get(admin.id, '/admin/reporting/fees?days=30')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    if (body.length > 0) {
      expect(body[0]).toHaveProperty('platformFeeTotal')
      expect(body[0]).toHaveProperty('platformFeeTaxTotal')
    }
  })
})
