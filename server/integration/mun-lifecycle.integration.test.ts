import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munPaymentSettings, muns, registrationProducts, verificationLogs } from '@/lib/db/schema'
import type { MunStatus, PaymentVerificationState } from '@/lib/db/schema-enums'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()
const DAY = 24 * 60 * 60 * 1000

afterAll(async () => {
  await db.$client.end()
})

/** A mun whose registration window is live right now (real clock — the route has no `now` override). */
async function makeMun(
  organizerId: string,
  status: MunStatus = 'PUBLISHED',
  payment: PaymentVerificationState = 'VERIFIED',
) {
  const now = Date.now()
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'API Lifecycle Mun',
      slug: `api-lifecycle-${crypto.randomUUID()}`,
      status,
      startDate: new Date(now + 30 * DAY),
      endDate: new Date(now + 32 * DAY),
      registrationOpensAt: new Date(now - DAY),
      registrationDeadline: new Date(now + 20 * DAY),
    })
    .returning()
  await db.insert(registrationProducts).values({ munId: mun.id, name: 'Delegate', price: 1200, capacity: 30 })
  await db.insert(munPaymentSettings).values({
    munId: mun.id,
    legalName: 'Test Org',
    orgType: 'NGO',
    addressLine1: 'Addr',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    panLast4: '1234',
    panCiphertext: 'ciphertext-not-real',
    authorizedRepName: 'Rep',
    authorizedRepEmail: 'rep@lifecycle-api.test',
    accountHolderName: 'Test Org',
    bankName: 'Test Bank',
    accountNumberLast4: '5678',
    accountNumberCiphertext: 'ciphertext-not-real',
    ifsc: 'TEST0001234',
    accountType: 'current',
    gateway: 'razorpay',
    verificationState: payment,
  })
  return mun
}

function post(munId: string, action: string, init: RequestInit = {}) {
  return app.request(`/api/v1/muns/${munId}/lifecycle/${action}`, { method: 'POST', ...init })
}

function jsonInit(headers: Record<string, string>, body: unknown): RequestInit {
  return {
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('POST /api/v1/muns/:munId/lifecycle/:action', () => {
  it('returns 401 without a session', async () => {
    const res = await post(crypto.randomUUID(), 'open-registration')
    expect(res.status).toBe(401)
  })

  it('returns 400 for an unknown action', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id)
    const res = await post(mun.id, 'publish', { headers: await authHeaders(owner.id) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain('open-registration')
  })

  it('returns 400 for a malformed body', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id)
    const headers = await authHeaders(owner.id)

    const notJson = await post(mun.id, 'close-registration', {
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{reason:',
    })
    expect(notJson.status).toBe(400)

    const unknownField = await post(mun.id, 'close-registration', jsonInit(headers, { reason: 'x', force: true }))
    expect(unknownField.status).toBe(400)
    expect((await unknownField.json()).error.code).toBe('VALIDATION_FAILED')

    const tooLong = await post(mun.id, 'cancel', jsonInit(headers, { reason: 'x'.repeat(1001) }))
    expect(tooLong.status).toBe(400)
    const [row] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(row.status).toBe('PUBLISHED')
  })

  it('returns 400 when cancel has no reason', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id)
    const res = await post(mun.id, 'cancel', jsonInit(await authHeaders(owner.id), { reason: '  ' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toEqual({ code: 'VALIDATION_FAILED', message: 'A reason is required to cancel a conference' })
  })

  it('returns 403 for another organizer and for archive by the owner', async () => {
    const owner = await makeUser()
    const other = await makeUser()
    const mun = await makeMun(owner.id)

    const res = await post(mun.id, 'open-registration', { headers: await authHeaders(other.id) })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')

    const archive = await post(mun.id, 'archive', { headers: await authHeaders(owner.id) })
    expect(archive.status).toBe(403)
  })

  it('returns 404 for an unknown mun', async () => {
    const admin = await makeUser('ADMIN')
    const res = await post(crypto.randomUUID(), 'close-registration', { headers: await authHeaders(admin.id) })
    expect(res.status).toBe(404)
  })

  it('returns 409 CONFLICT_STATE with the failing precondition', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id, 'PUBLISHED', 'PENDING')
    const res = await post(mun.id, 'open-registration', { headers: await authHeaders(owner.id) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT_STATE')
    expect(body.error.message).toMatch(/verified your payment account/)
  })

  it('returns 409 for an action that does not fit the current status', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id)
    const res = await post(mun.id, 'close-registration', { headers: await authHeaders(owner.id) })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT_STATE')
  })

  it('opens registration with no body and returns {munId, status}', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id)
    const res = await post(mun.id, 'open-registration', { headers: await authHeaders(owner.id) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ munId: mun.id, status: 'REGISTRATION_OPEN' })
  })

  it('cancels with a reason and records it', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id, 'REGISTRATION_OPEN')
    const res = await post(mun.id, 'cancel', jsonInit(await authHeaders(owner.id), { reason: 'Venue withdrew' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ munId: mun.id, status: 'CANCELLED' })

    const logs = await db.select().from(verificationLogs).where(eq(verificationLogs.munId, mun.id))
    expect(logs.map((log) => [log.action, log.notes])).toEqual([['CANCELLED', 'Venue withdrew']])
  })

  it('lets staff archive a completed mun', async () => {
    const owner = await makeUser()
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(owner.id, 'COMPLETED')
    const res = await post(mun.id, 'archive', jsonInit(await authHeaders(admin.id), {}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ munId: mun.id, status: 'ARCHIVED' })
  })
})

describe('GET /api/v1/muns/:munId/lifecycle', () => {
  it('returns the overview to the owner', async () => {
    const owner = await makeUser()
    const mun = await makeMun(owner.id)
    const res = await app.request(`/api/v1/muns/${mun.id}/lifecycle`, { headers: await authHeaders(owner.id) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ munId: mun.id, status: 'PUBLISHED', confirmedRegistrations: 0 })
    expect(typeof body.registrationDeadline).toBe('string')
    expect(body.actions.map((option: { action: string; available: boolean }) => [option.action, option.available])).toEqual([
      ['open-registration', true],
      ['cancel', true],
    ])
  })

  it('returns 401 without a session and 403 for another organizer', async () => {
    const owner = await makeUser()
    const other = await makeUser()
    const mun = await makeMun(owner.id)
    expect((await app.request(`/api/v1/muns/${mun.id}/lifecycle`)).status).toBe(401)
    const res = await app.request(`/api/v1/muns/${mun.id}/lifecycle`, { headers: await authHeaders(other.id) })
    expect(res.status).toBe(403)
  })
})
