import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { munSubmissions, muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import { createApp } from '../src/app'
import { authHeaders } from './helpers'

const app = createApp()

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

async function makeUser(role: AnyRole, name = `api console ${role}`) {
  const [user] = await db
    .insert(users)
    .values({ name, email: `api-console-${crypto.randomUUID()}@test.dev`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: MunStatus, name: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name, slug: `api-console-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

async function get(userId: string | null, path: string) {
  return app.request(`/api/v1${path}`, { headers: userId ? await authHeaders(userId) : {} })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/v1/admin/muns', () => {
  it('lists and filters conferences for staff; refuses organizers and anonymous callers', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const marker = `Consolia-${crypto.randomUUID()}`
    const live = await makeMun(organizer.id, 'PUBLISHED', `${marker} live`)
    await makeMun(organizer.id, 'DRAFT', `${marker} draft`)

    const res = await get(ops.id, `/admin/muns?q=${encodeURIComponent(marker)}&status=PUBLISHED`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.results[0]).toMatchObject({ id: live.id, status: 'PUBLISHED', organizerEmail: organizer.email })

    expect((await get(organizer.id, '/admin/muns')).status).toBe(403)
    expect((await get(null, '/admin/muns')).status).toBe(401)
  })

  it('rejects an unknown status filter with 400', async () => {
    const admin = await makeUser('ADMIN')
    expect((await get(admin.id, '/admin/muns?status=LIVE')).status).toBe(400)
  })
})

describe('GET /api/v1/admin/muns/:munId', () => {
  it('returns the conference detail with no-store, 404 for an unknown id, 403 for organizers', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION', 'Detail Mun')

    const res = await get(ops.id, `/admin/muns/${mun.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.mun).toMatchObject({ id: mun.id, status: 'VERIFICATION' })
    expect(body.modules).toHaveLength(15)

    expect((await get(ops.id, `/admin/muns/${crypto.randomUUID()}`)).status).toBe(404)
    // Even the owning organizer can't read the staff view.
    expect((await get(organizer.id, `/admin/muns/${mun.id}`)).status).toBe(403)
  })

  it('does not shadow the Gate 1 review detail route', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED', 'Gate 1 Mun')

    const res = await get(ops.id, `/admin/muns/${mun.id}/review`)
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('verificationLogs')
  })
})

describe('GET /api/v1/admin/go-live-queue/details', () => {
  it('returns queue rows with reviewer and payment state for staff only', async () => {
    const admin = await makeUser('ADMIN', 'Detail Queue Reviewer')
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION', 'Queue Detail Mun')
    const [submission] = await db
      .insert(munSubmissions)
      .values({
        munId: mun.id,
        submittedBy: organizer.id,
        versionNumber: 1,
        status: 'UNDER_REVIEW',
        submittedAt: new Date(),
        slaDeadline: new Date(Date.now() + 86_400_000),
        reviewerId: admin.id,
      })
      .returning()

    const res = await get(admin.id, '/admin/go-live-queue/details?limit=100')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.find((row: { submissionId: string }) => row.submissionId === submission.id)).toMatchObject({
      reviewerName: 'Detail Queue Reviewer',
      paymentVerificationState: null,
    })

    expect((await get(organizer.id, '/admin/go-live-queue/details')).status).toBe(403)
  })
})

describe('GET /api/v1/admin/analytics', () => {
  it('returns platform totals for staff and refuses delegates', async () => {
    const ops = await makeUser('OPERATIONS')
    const student = await makeUser('STUDENT')

    const res = await get(ops.id, '/admin/analytics')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.revenue)).toBe(true)
    expect(typeof body.liveMuns).toBe('number')
    expect(typeof body.newOrganizersLast7Days).toBe('number')
    expect(body.registrationsByStatus).toHaveProperty('CONFIRMED')

    expect((await get(student.id, '/admin/analytics')).status).toBe(403)
  })
})

describe('staff reads of delegate data are logged', () => {
  async function seedRegistration(delegateName: string) {
    const organizer = await makeUser('ORGANIZER')
    const delegate = await makeUser('STUDENT', delegateName)
    const mun = await makeMun(organizer.id, 'REGISTRATION_OPEN', 'PII Mun')
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 10 })
      .returning()
    const [registration] = await db
      .insert(registrations)
      .values({ userId: delegate.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
      .returning()
    return registration
  }

  function piiLines(info: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
    return info.mock.calls
      .map((args) => args[0])
      .filter((arg): arg is string => typeof arg === 'string' && arg.includes('"pii_read"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('GET /admin/registrations logs actor, route and the returned ids, never the search text', async () => {
    const ops = await makeUser('OPERATIONS')
    const delegateName = `Piiperson ${crypto.randomUUID()}`
    const registration = await seedRegistration(delegateName)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await get(ops.id, `/admin/registrations?q=${encodeURIComponent(delegateName)}`)
    expect(res.status).toBe(200)

    const lines = piiLines(info)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: 'pii_read',
      actorId: ops.id,
      route: 'GET /admin/registrations',
      targetType: 'registration',
      targetId: registration.id,
      targetIds: [registration.id],
      hasQuery: true,
    })
    expect(JSON.stringify(lines[0])).not.toContain(delegateName)
  })

  it('GET /admin/search/registrations logs too', async () => {
    const admin = await makeUser('ADMIN')
    const delegateName = `Searchperson ${crypto.randomUUID()}`
    const registration = await seedRegistration(delegateName)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await get(admin.id, `/admin/search/registrations?q=${encodeURIComponent(delegateName)}`)
    expect(res.status).toBe(200)

    const lines = piiLines(info)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ actorId: admin.id, route: 'GET /admin/search/registrations', targetIds: [registration.id] })
  })

  it('a refused read logs nothing', async () => {
    const organizer = await makeUser('ORGANIZER')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    expect((await get(organizer.id, '/admin/registrations')).status).toBe(403)
    expect(piiLines(info)).toEqual([])
  })
})
