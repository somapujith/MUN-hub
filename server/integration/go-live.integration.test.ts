import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munPaymentSettings } from '@/lib/db/schema'
import { enqueueForGoLive, reviewSubmission } from '@/lib/lifecycle/go-live'
import { submitFinalConfirmation } from '@/lib/lifecycle/organizer-confirmation'
import { createApp } from '../src/app'
import { makeCompleteMun } from './fixtures/go-live-fixtures'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

async function makeBareMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'API Go-Live Test Mun',
      slug: `api-go-live-${crypto.randomUUID()}`,
      status: 'ONBOARDING',
    })
    .returning()
  return mun
}

describe('POST /api/v1/muns/:munId/actions/submit-for-review', () => {
  it('returns HTTP 200 with {passed:false, blockers} on validation failure — not 4xx', async () => {
    const organizer = await makeUser()
    const mun = await makeBareMun(organizer.id)
    const headers = await authHeaders(organizer.id)

    const res = await app.request(`/api/v1/muns/${mun.id}/actions/submit-for-review`, {
      method: 'POST',
      headers,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.passed).toBe(false)
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(body.blockers.length).toBeGreaterThan(0)
    expect(body.submissionId).toBeUndefined()
  })
})

describe('POST /api/v1/muns/:munId/actions/publish', () => {
  it('returns 400 when Idempotency-Key header is missing', async () => {
    const admin = await makeUser('ADMIN')
    const headers = await authHeaders(admin.id)

    const res = await app.request(`/api/v1/muns/${crypto.randomUUID()}/actions/publish`, {
      method: 'POST',
      headers,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain('Idempotency-Key')
  })

  it('returns 200 with replay:true when the same Idempotency-Key is sent twice', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const organizerHeaders = await authHeaders(organizer.id)
    const adminHeaders = await authHeaders(admin.id)

    const submitRes = await app.request(`/api/v1/muns/${mun.id}/actions/submit-for-review`, {
      method: 'POST',
      headers: organizerHeaders,
    })
    expect(submitRes.status).toBe(200)
    const submitBody = await submitRes.json()
    expect(submitBody.passed).toBe(true)

    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })

    await db
      .update(munPaymentSettings)
      .set({ verificationState: 'VERIFIED', verifiedAt: new Date(), verifiedBy: admin.id })
      .where(eq(munPaymentSettings.munId, mun.id))

    const idempotencyKey = `test-key-${crypto.randomUUID()}`
    const publishHeaders = { ...adminHeaders, 'Idempotency-Key': idempotencyKey }

    const first = await app.request(`/api/v1/muns/${mun.id}/actions/publish`, {
      method: 'POST',
      headers: publishHeaders,
    })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.replay).toBe(false)

    const second = await app.request(`/api/v1/muns/${mun.id}/actions/publish`, {
      method: 'POST',
      headers: publishHeaders,
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.replay).toBe(true)
    expect(secondBody.submission.id).toBe(firstBody.submission.id)
  })
})

describe('POST /api/v1/muns/:munId/submission/actions/review', () => {
  it('returns 400 when decision is REJECTED without reason (superRefine)', async () => {
    const admin = await makeUser('ADMIN')
    const headers = {
      ...(await authHeaders(admin.id)),
      'Content-Type': 'application/json',
    }

    const res = await app.request(`/api/v1/muns/${crypto.randomUUID()}/submission/actions/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'REJECTED' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /api/v1/admin/go-live-queue', () => {
  it('sets Cache-Control: no-store', async () => {
    const admin = await makeUser('ADMIN')
    const headers = await authHeaders(admin.id)

    const res = await app.request('/api/v1/admin/go-live-queue', { headers })

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
