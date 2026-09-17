import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REGISTRATION_ERRORS } from '@/lib/actions/registration'
import { completeStudentProfile } from '@/lib/actions/student-profile'
import { db } from '@/lib/db/client'
import { adminActions, muns, payments, registrationProducts, registrations } from '@/lib/db/schema'
import { simulatePaymentOutcome } from '@/lib/payments/mock-adapter'
import { WEBHOOK_REPLAY_WINDOW_MS } from '@/lib/payments/webhook'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

const savedMockFlag = process.env.MOCK_PAYMENTS_ENABLED
afterEach(() => {
  if (savedMockFlag === undefined) delete process.env.MOCK_PAYMENTS_ENABLED
  else process.env.MOCK_PAYMENTS_ENABLED = savedMockFlag
  vi.restoreAllMocks()
})

function disablePayments() {
  process.env.MOCK_PAYMENTS_ENABLED = 'false'
}

async function makeOpenMun(passes: Array<{ name: string; price: number }> = [{ name: 'Delegate', price: 1499 }]) {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Payments Mun', slug: `pay-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const products = await db
    .insert(registrationProducts)
    .values(passes.map((pass) => ({ munId: mun.id, name: pass.name, price: pass.price, capacity: 10 })))
    .returning()
  return { organizer, mun, products }
}

async function makeStudent() {
  const student = await makeUser('STUDENT')
  await completeStudentProfile(
    {
      phone: '9876501234',
      institution: 'Test College',
      dateOfBirth: '2004-06-15',
      gradeOrYear: '3rd year',
      residentialAddress: '1 Test Lane',
      requiresTransportation: false,
      emergencyContactName: 'Guardian',
      emergencyContactPhone: '9876505678',
      emergencyContactRelation: 'Parent',
    },
    { userId: student.id, role: 'STUDENT' },
  )
  return { student, headers: await authHeaders(student.id) }
}

function json(headers: Record<string, string>, body: unknown, extra: Record<string, string> = {}) {
  return { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) }
}

function register(headers: Record<string, string>, body: Record<string, unknown>, key: string = crypto.randomUUID()) {
  return app.request('/api/v1/registrations', json(headers, body, { 'Idempotency-Key': key }))
}

async function paymentOf(registrationId: string) {
  const [payment] = await db.select().from(payments).where(eq(payments.registrationId, registrationId))
  return payment
}

describe('POST /registrations — payments availability and idempotency', () => {
  it('answers 503 PAYMENTS_UNAVAILABLE for a paid pass when no adapter is usable', async () => {
    disablePayments()
    const { mun, products } = await makeOpenMun()
    const { student, headers } = await makeStudent()

    const res = await register(headers, { munId: mun.id, registrationProductId: products[0].id })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toEqual({
      code: 'PAYMENTS_UNAVAILABLE',
      message: REGISTRATION_ERRORS.paymentsUnavailable,
    })
    expect(await db.select().from(registrations).where(eq(registrations.userId, student.id))).toHaveLength(0)
  })

  it('still confirms a free pass with payments unavailable', async () => {
    disablePayments()
    const { mun, products } = await makeOpenMun([{ name: 'Faculty', price: 0 }])
    const { headers } = await makeStudent()

    const res = await register(headers, { munId: mun.id, registrationProductId: products[0].id })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ orderId: null, status: 'CONFIRMED', replayed: false })
  })

  it('answers 201 then 200 with the same registration for a repeated Idempotency-Key', async () => {
    const { mun, products } = await makeOpenMun()
    const { student, headers } = await makeStudent()
    const key = crypto.randomUUID()
    const body = { munId: mun.id, registrationProductId: products[0].id }

    const first = await register(headers, body, key)
    expect(first.status).toBe(201)
    const created = await first.json()
    expect(created).toMatchObject({ status: 'PAYMENT_PENDING', replayed: false })
    expect(created.orderId).toMatch(/^mock_order_/)

    const second = await register(headers, body, key)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ...created, replayed: true })
    expect(await db.select().from(registrations).where(eq(registrations.userId, student.id))).toHaveLength(1)
  })

  it('answers 409 when a key is reused for a different pass', async () => {
    const { mun, products } = await makeOpenMun([
      { name: 'Delegate', price: 1499 },
      { name: 'Press', price: 999 },
    ])
    const { headers } = await makeStudent()
    const key = crypto.randomUUID()

    expect((await register(headers, { munId: mun.id, registrationProductId: products[0].id }, key)).status).toBe(201)
    const reused = await register(headers, { munId: mun.id, registrationProductId: products[1].id }, key)
    expect(reused.status).toBe(409)
    expect((await reused.json()).error.message).toBe(REGISTRATION_ERRORS.idempotencyKeyReused)
  })

  it('rejects a missing or oversized Idempotency-Key', async () => {
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const body = { munId: mun.id, registrationProductId: products[0].id }

    const missing = await app.request('/api/v1/registrations', json(headers, body))
    expect(missing.status).toBe(400)
    const oversized = await register(headers, body, 'k'.repeat(256))
    expect(oversized.status).toBe(400)
  })
})

describe('GET /registrations/:id', () => {
  it('reports the payment amount/currency and which checkout to offer', async () => {
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()

    const res = await app.request(`/api/v1/registrations/${registrationId}`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment).toEqual([{ amount: 1499, currency: 'INR', status: 'PENDING' }])
    expect(body.paymentProvider).toBe('mock_razorpay')

    disablePayments()
    const without = await (await app.request(`/api/v1/registrations/${registrationId}`, { headers })).json()
    expect(without.paymentProvider).toBeNull()
  })
})

describe('POST /registrations/:id/mock-payment', () => {
  it('confirms the owner’s registration through the webhook processor', async () => {
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()

    const res = await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(headers, { outcome: 'success' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, confirmed: true })
    expect(body).not.toHaveProperty('refundOwed')

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CONFIRMED')
    expect((await paymentOf(registrationId)).status).toBe('PAID')
  })

  it('releases the seat on a simulated failure', async () => {
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()

    const res = await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(headers, { outcome: 'failure' }))
    expect(res.status).toBe(200)
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CANCELLED')
  })

  it('is 404 for anyone but the owner — including the MUN organizer', async () => {
    const { organizer, mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
    const snoop = await makeStudent()

    for (const other of [snoop.headers, await authHeaders(organizer.id)]) {
      const res = await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(other, { outcome: 'success' }))
      expect(res.status).toBe(404)
    }
    expect((await paymentOf(registrationId)).status).toBe('PENDING')
  })

  it('does not exist when the mock is disabled', async () => {
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()

    disablePayments()
    const res = await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(headers, { outcome: 'success' }))
    expect(res.status).toBe(404)
    expect((await paymentOf(registrationId)).status).toBe('PENDING')
  })

  it('answers 409 for a free registration (nothing to pay)', async () => {
    const { mun, products } = await makeOpenMun([{ name: 'Faculty', price: 0 }])
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
    const res = await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(headers, { outcome: 'success' }))
    expect(res.status).toBe(409)
  })
})

describe('POST /webhooks/payments', () => {
  async function pendingPayment() {
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
    const payment = await paymentOf(registrationId)
    return { registrationId, order: { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency } }
  }

  function post(webhook: { rawBody: string; headers: Headers }) {
    return app.request('/webhooks/payments', { method: 'POST', headers: webhook.headers, body: webhook.rawBody })
  }

  it('confirms on a valid signed capture and treats its redelivery as a duplicate', async () => {
    const { registrationId, order } = await pendingPayment()
    const webhook = simulatePaymentOutcome(order, 'success')

    const first = await post(webhook)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, confirmed: true })

    const again = await post(webhook)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true, duplicate: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CONFIRMED')
  })

  it('answers {exception: true} for a payment after the hold was released', async () => {
    const { registrationId, order } = await pendingPayment()
    await db.update(registrations).set({ status: 'CANCELLED' }).where(eq(registrations.id, registrationId))

    const res = await post(simulatePaymentOutcome(order, 'success'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, exception: true })
    expect(await paymentOf(registrationId)).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
  })

  it('rejects a forged signature, an unsigned body and a stale delivery with 400', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { registrationId, order } = await pendingPayment()

    const forged = simulatePaymentOutcome(order, 'success')
    forged.headers.set('x-webhook-signature', 'forged')
    expect((await post(forged)).status).toBe(400)

    const unsigned = await app.request('/webhooks/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.orderId, status: 'paid' }),
    })
    expect(unsigned.status).toBe(400)

    const stale = await post(
      simulatePaymentOutcome(order, 'success', { signedAt: new Date(Date.now() - WEBHOOK_REPLAY_WINDOW_MS - 60_000) }),
    )
    expect(stale.status).toBe(400)
    expect((await stale.json()).code).toBe('STALE_EVENT')

    expect((await paymentOf(registrationId)).status).toBe('PENDING')
  })

  it('answers 404 for an unknown order', async () => {
    const res = await post(simulatePaymentOutcome({ orderId: `mock_order_${crypto.randomUUID()}`, amount: 1, currency: 'INR' }, 'success'))
    expect(res.status).toBe(404)
  })

  it('answers 404 when payments are disabled', async () => {
    const { order } = await pendingPayment()
    const webhook = simulatePaymentOutcome(order, 'success')
    disablePayments()
    expect((await post(webhook)).status).toBe(404)
  })
})

describe('GET /registrations/:id/receipt', () => {
  it('is served to the owner only', async () => {
    const { organizer, mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
    await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(headers, { outcome: 'success' }))

    const own = await app.request(`/api/v1/registrations/${registrationId}/receipt`, { headers })
    expect(own.status).toBe(200)
    const receipt = await own.json()
    expect(receipt).toMatchObject({
      registrationId,
      status: 'CONFIRMED',
      passName: 'Delegate',
      mun: { name: 'Payments Mun', slug: mun.slug },
      payment: { amount: 1499, currency: 'INR', status: 'PAID' },
    })
    expect(receipt.payment.reference).toMatch(/^mock_pay_/)
    expect(typeof receipt.payment.paidAt).toBe('string')

    const admin = await makeUser('ADMIN')
    for (const other of [(await makeStudent()).headers, await authHeaders(organizer.id), await authHeaders(admin.id)]) {
      expect((await app.request(`/api/v1/registrations/${registrationId}/receipt`, { headers: other })).status).toBe(404)
    }
    expect((await app.request(`/api/v1/registrations/${registrationId}/receipt`)).status).toBe(401)
  })
})

describe('admin payment exceptions', () => {
  async function lateException() {
    const { registrationId, order } = await (async () => {
      const { mun, products } = await makeOpenMun()
      const { headers } = await makeStudent()
      const created = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
      const payment = await paymentOf(created.registrationId)
      return {
        registrationId: created.registrationId as string,
        order: { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency },
      }
    })()
    await db.update(registrations).set({ status: 'CANCELLED' }).where(eq(registrations.id, registrationId))
    const webhook = simulatePaymentOutcome(order, 'success')
    await app.request('/webhooks/payments', { method: 'POST', headers: webhook.headers, body: webhook.rawBody })
    return paymentOf(registrationId)
  }

  it('lists and resolves an exception, with an audit entry', async () => {
    const payment = await lateException()
    const admin = await makeUser('ADMIN')
    const headers = await authHeaders(admin.id)

    const list = await app.request('/api/v1/admin/payment-exceptions', { headers })
    expect(list.status).toBe(200)
    const rows = await list.json()
    expect(rows.find((row: { paymentId: string }) => row.paymentId === payment.id)).toMatchObject({
      reason: 'PAYMENT_AFTER_HOLD_EXPIRED',
      amount: 1499,
      currency: 'INR',
    })

    const noNote = await app.request(`/api/v1/admin/payment-exceptions/${payment.id}/resolve`, json(headers, { note: '  ' }))
    expect(noNote.status).toBe(400)

    const resolved = await app.request(
      `/api/v1/admin/payment-exceptions/${payment.id}/resolve`,
      json(headers, { note: 'Returned to the delegate' }),
    )
    expect(resolved.status).toBe(200)
    expect(await resolved.json()).toMatchObject({ paymentId: payment.id, note: 'Returned to the delegate', resolvedBy: admin.id })

    const again = await app.request(
      `/api/v1/admin/payment-exceptions/${payment.id}/resolve`,
      json(headers, { note: 'Again' }),
    )
    expect(again.status).toBe(409)

    const audit = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'payment'), eq(adminActions.targetId, payment.id)))
    expect(audit).toHaveLength(1)

    const unknown = await app.request(
      `/api/v1/admin/payment-exceptions/${crypto.randomUUID()}/resolve`,
      json(headers, { note: 'Nothing' }),
    )
    expect(unknown.status).toBe(404)
  })

  it('is closed to students and organizers', async () => {
    const payment = await lateException()
    for (const role of ['STUDENT', 'ORGANIZER'] as const) {
      const headers = await authHeaders((await makeUser(role)).id)
      expect((await app.request('/api/v1/admin/payment-exceptions', { headers })).status).toBe(403)
      expect(
        (await app.request(`/api/v1/admin/payment-exceptions/${payment.id}/resolve`, json(headers, { note: 'x' }))).status,
      ).toBe(403)
    }
  })
})

describe('GET /muns/:munId/payments-summary', () => {
  it('gives the owner the paid totals and refuses other organizers', async () => {
    const { organizer, mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
    await app.request(`/api/v1/registrations/${registrationId}/mock-payment`, json(headers, { outcome: 'success' }))

    const res = await app.request(`/api/v1/muns/${mun.id}/payments-summary`, { headers: await authHeaders(organizer.id) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      totals: [
        { currency: 'INR', grossCollected: 1499, platformFee: 0, platformFeeTax: 0, organizerNet: 1499, paidRegistrations: 1 },
      ],
    })

    const stranger = await makeUser('ORGANIZER')
    const denied = await app.request(`/api/v1/muns/${mun.id}/payments-summary`, { headers: await authHeaders(stranger.id) })
    expect(denied.status).toBe(403)
  })

  it('rejects refundPolicy on the settings write', async () => {
    const { organizer, mun } = await makeOpenMun()
    const res = await app.request(`/api/v1/muns/${mun.id}/payment-settings`, {
      method: 'PUT',
      headers: { ...(await authHeaders(organizer.id)), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        legalName: 'Society',
        orgType: 'Trust',
        addressLine1: '1 Road',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500001',
        pan: 'ABCDE1234F',
        authorizedRepName: 'Rep',
        authorizedRepEmail: 'rep@example.com',
        accountHolderName: 'Society',
        bankName: 'Bank',
        accountNumber: '000123456789',
        ifsc: 'BANK0001234',
        accountType: 'Current',
        gateway: 'Razorpay',
        refundPolicy: 'Full refund',
      }),
    })
    expect(res.status).toBe(400)
  })
})
