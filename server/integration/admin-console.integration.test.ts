import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, munSubmissions, muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
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

  /** PII_READ audit rows written with `actorId` as the actor (each test uses a fresh staff user). */
  function piiReads(actorId: string) {
    return db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.actorId, actorId), eq(adminActions.action, 'PII_READ')))
  }

  it('GET /admin/registrations records actor, route and the returned ids, never the search text', async () => {
    const ops = await makeUser('OPERATIONS')
    const delegateName = `Piiperson ${crypto.randomUUID()}`
    const registration = await seedRegistration(delegateName)

    const res = await get(ops.id, `/admin/registrations?q=${encodeURIComponent(delegateName)}`)
    expect(res.status).toBe(200)

    const rows = await piiReads(ops.id)
    expect(rows).toHaveLength(1)
    // A single-record read is filed against that record.
    expect(rows[0]).toMatchObject({ targetType: 'registration', targetId: registration.id, reason: null })
    expect(rows[0].metadata).toEqual({
      route: 'GET /admin/registrations',
      recordType: 'registration',
      targetIds: [registration.id],
      count: 1,
      hasQuery: true,
    })
    expect(JSON.stringify(rows[0])).not.toContain(delegateName)
  })

  it('a list read is filed against the route, with every returned id', async () => {
    const ops = await makeUser('OPERATIONS')
    const delegateName = `Listperson ${crypto.randomUUID()}`
    const first = await seedRegistration(delegateName)
    const second = await seedRegistration(delegateName)

    const res = await get(ops.id, `/admin/registrations?q=${encodeURIComponent(delegateName)}`)
    expect(res.status).toBe(200)

    const [row] = await piiReads(ops.id)
    expect(row).toMatchObject({ targetType: 'registration_list', targetId: 'GET /admin/registrations' })
    expect((row.metadata as { targetIds: string[] }).targetIds.sort()).toEqual([first.id, second.id].sort())
  })

  it('GET /admin/search/registrations records too', async () => {
    const admin = await makeUser('ADMIN')
    const delegateName = `Searchperson ${crypto.randomUUID()}`
    const registration = await seedRegistration(delegateName)

    const res = await get(admin.id, `/admin/search/registrations?q=${encodeURIComponent(delegateName)}`)
    expect(res.status).toBe(200)

    const rows = await piiReads(admin.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ targetType: 'registration', targetId: registration.id })
    expect(rows[0].metadata).toMatchObject({ route: 'GET /admin/search/registrations', hasQuery: true })
  })

  it('GET /admin/payment-exceptions records the payments whose delegates it returned', async () => {
    const ops = await makeUser('OPERATIONS')
    const registration = await seedRegistration(`Exceptionperson ${crypto.randomUUID()}`)
    const [payment] = await db
      .insert(payments)
      .values({
        registrationId: registration.id,
        providerOrderId: `order-${crypto.randomUUID()}`,
        amount: 1000,
        status: 'PAID',
        exceptionReason: 'DUPLICATE_PAYMENT',
        exceptionRaisedAt: new Date(),
      })
      .returning()

    const res = await get(ops.id, '/admin/payment-exceptions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ paymentId: string }>
    expect(body.map((row) => row.paymentId)).toContain(payment.id)

    const rows = await piiReads(ops.id)
    expect(rows).toHaveLength(1)
    const metadata = rows[0].metadata as { route: string; recordType: string; targetIds: string[] }
    expect(metadata).toMatchObject({ route: 'GET /admin/payment-exceptions', recordType: 'payment', hasQuery: false })
    expect(metadata.targetIds).toEqual(body.map((row) => row.paymentId))
  })

  it('a read that returns nothing, or is refused, records nothing', async () => {
    const ops = await makeUser('OPERATIONS')
    const res = await get(ops.id, `/admin/search/registrations?q=${encodeURIComponent(`nobody-${crypto.randomUUID()}`)}`)
    expect(res.status).toBe(200)
    expect(await piiReads(ops.id)).toEqual([])

    const organizer = await makeUser('ORGANIZER')
    expect((await get(organizer.id, '/admin/registrations')).status).toBe(403)
    expect(await piiReads(organizer.id)).toEqual([])
  })
})
