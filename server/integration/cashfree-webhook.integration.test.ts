import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeStudentProfile } from '@/lib/actions/student-profile'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations } from '@/lib/db/schema'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

/**
 * Full webhook route test with PAYMENTS_ADAPTER=cashfree and a stubbed
 * Cashfree API (create-order + a real, correctly-signed webhook) — never a
 * real Cashfree call. Request/response shapes are VERIFIED against the real
 * live API by a direct diagnostic call (2026-09-24, `POST /pg/orders` against
 * api.cashfree.com — see docs/payments/CASHFREE.md). Follows
 * server/integration/payments.integration.test.ts's pattern.
 */

const app = createApp()

const SAVED_ADAPTER = process.env.PAYMENTS_ADAPTER
const TEST_CLIENT_SECRET = 'test-cashfree-secret'

function enableCashfree() {
  process.env.PAYMENTS_ADAPTER = 'cashfree'
  setRuntimeEnv({
    PAYMENTS_ADAPTER: 'cashfree',
    CASHFREE_CLIENT_ID: 'test-client-id',
    CASHFREE_CLIENT_SECRET: TEST_CLIENT_SECRET,
  })
}

afterEach(() => {
  if (SAVED_ADAPTER === undefined) delete process.env.PAYMENTS_ADAPTER
  else process.env.PAYMENTS_ADAPTER = SAVED_ADAPTER
  setRuntimeEnv({})
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Stubs fetch for /pg/orders (create-order) only — no other Cashfree endpoint is hit by the tests below unless added. */
function stubCashfreeCreateOrder() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/pg/orders')) {
        const body = JSON.parse(String(init.body)) as { order_id: string; order_meta: { notify_url: string } }
        // notify_url must be the real webhook route — asserted here so every
        // test in this file that hits create-order incidentally guards
        // against a regression.
        if (!body.order_meta.notify_url.includes('/webhooks/payments')) {
          throw new Error('notify_url must be the webhook endpoint')
        }
        return jsonResponse({ order_id: body.order_id, order_status: 'ACTIVE', payment_session_id: `session_${body.order_id}` })
      }
      throw new Error(`Unexpected Cashfree call: ${href}`)
    }),
  )
}

/**
 * A fresh, unique `cf_payment_id` per call — real Cashfree ids are always
 * unique; a literal string reused across separate suite runs against the
 * persistent test DB (mun_hub_test isn't wiped between `vitest run`
 * invocations) would collide with an already-claimed
 * `(provider, eventId)` row from an earlier run and be read back as a
 * duplicate instead of confirming fresh.
 */
function cfPaymentId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function signedWebhookBody(payload: Record<string, unknown>, timestamp = String(Math.floor(Date.now() / 1000))) {
  const rawBody = JSON.stringify(payload)
  const signature = crypto.createHmac('sha256', TEST_CLIENT_SECRET).update(`${timestamp}${rawBody}`).digest('base64')
  return { rawBody, headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp } }
}

async function makeOpenMun(passes: Array<{ name: string; price: number }> = [{ name: 'Delegate', price: 1499 }]) {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Cashfree Mun', slug: `cashfree-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
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

async function createPendingRegistration(passPrice = 1499) {
  const { mun, products } = await makeOpenMun([{ name: 'Delegate', price: passPrice }])
  const { headers } = await makeStudent()
  const { registrationId } = await (await register(headers, { munId: mun.id, registrationProductId: products[0].id })).json()
  const payment = await paymentOf(registrationId)
  return { registrationId, payment, headers }
}

describe('POST /registrations under PAYMENTS_ADAPTER=cashfree', () => {
  it('creates the order via stubbed fetch and returns the checkout object with fee split', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    process.env.PLATFORM_FEE_BPS = '650'
    process.env.PLATFORM_FEE_TAX_BPS = '1800'

    const { registrationId, payment } = await createPendingRegistration(1499)

    // 1499 -> fee 97, tax 17, total 1613.
    expect(payment).toMatchObject({
      provider: 'cashfree',
      amount: 1613,
      platformFeeAmount: 97,
      platformFeeTaxAmount: 17,
      organizerNetAmount: 1499,
      status: 'PENDING',
    })
    expect(payment.checkoutSessionId).toBe(`session_${payment.providerOrderId}`)
    expect(payment.checkoutUrl).toBeNull()

    const owner = (await db.query.registrations.findFirst({ where: eq(registrations.id, registrationId) }))!.userId
    const res = await app.request(`/api/v1/registrations/${registrationId}`, { headers: await authHeaders(owner) })
    const body = await res.json()
    expect(body.paymentProvider).toBe('cashfree')
    expect(body.checkout).toMatchObject({
      paymentSessionId: payment.checkoutSessionId,
      orderId: payment.providerOrderId,
      amount: 1613,
      currency: 'INR',
      passAmount: 1499,
      platformFeeAmount: 97,
      platformFeeTaxAmount: 17,
    })
  })

  it('sends real customer_details built from the student\'s own profile, and a notify_url pointing at the webhook route', async () => {
    enableCashfree()
    const calls: Array<{ order_id: string; customer_details: Record<string, unknown>; order_meta: Record<string, unknown> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const href = String(url)
        if (href.endsWith('/pg/orders')) {
          const body = JSON.parse(String(init.body)) as {
            order_id: string
            customer_details: Record<string, unknown>
            order_meta: Record<string, unknown>
          }
          calls.push(body)
          return jsonResponse({ order_id: body.order_id, order_status: 'ACTIVE', payment_session_id: `session_${body.order_id}` })
        }
        throw new Error(`Unexpected Cashfree call: ${href}`)
      }),
    )

    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    await register(headers, { munId: mun.id, registrationProductId: products[0].id })

    expect(calls).toHaveLength(1)
    expect(calls[0].customer_details.customer_phone).toBe('9876501234')
    expect(calls[0].customer_details.customer_id).toMatch(/^[a-zA-Z0-9]+$/)
    expect(calls[0].order_meta.notify_url).toContain('/webhooks/payments')
  })

  it('answers 503 PAYMENTS_UNAVAILABLE when Cashfree credentials are unset', async () => {
    process.env.PAYMENTS_ADAPTER = 'cashfree'
    setRuntimeEnv({})
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()

    const res = await register(headers, { munId: mun.id, registrationProductId: products[0].id })
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE')
  })

  it('confirms a free pass immediately without ever calling Cashfree', async () => {
    enableCashfree()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { mun, products } = await makeOpenMun([{ name: 'Faculty', price: 0 }])
    const { headers } = await makeStudent()
    const res = await register(headers, { munId: mun.id, registrationProductId: products[0].id })

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ orderId: null, status: 'CONFIRMED' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('POST /webhooks/payments under PAYMENTS_ADAPTER=cashfree', () => {
  function post(rawBody: string, headers: Record<string, string>) {
    return app.request('/webhooks/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: rawBody,
    })
  }

  it('confirms on a validly signed PAYMENT_SUCCESS_WEBHOOK, sets organizerNetAmount to the listed price and amount to totalCharge', async () => {
    process.env.PLATFORM_FEE_BPS = '650'
    process.env.PLATFORM_FEE_TAX_BPS = '1800'
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration(1499)
    const paymentId = cfPaymentId('cf_pay_success')

    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      event_time: new Date().toISOString(),
      data: {
        order: { order_id: payment.providerOrderId, order_amount: payment.amount, order_currency: 'INR' },
        payment: {
          cf_payment_id: paymentId,
          payment_status: 'SUCCESS',
          payment_amount: payment.amount,
          payment_currency: 'INR',
          payment_time: new Date().toISOString(),
        },
      },
    })

    const res = await post(rawBody, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, confirmed: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CONFIRMED')
    const settled = await paymentOf(registrationId)
    expect(settled).toMatchObject({
      status: 'PAID',
      providerPaymentId: paymentId,
      amount: 1613,
      organizerNetAmount: 1499,
    })
  })

  it('cancels the registration on a validly signed PAYMENT_FAILED_WEBHOOK', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration()

    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: cfPaymentId('cf_pay_failed'),
          payment_status: 'FAILED',
          payment_amount: payment.amount,
          payment_currency: 'INR',
        },
      },
    })

    const res = await post(rawBody, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CANCELLED')
    expect((await paymentOf(registrationId)).status).toBe('FAILED')
  })

  it('treats PAYMENT_USER_DROPPED_WEBHOOK the same as a failure (releases the seat)', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration()

    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_USER_DROPPED_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: cfPaymentId('cf_pay_dropped'),
          payment_status: 'FAILED',
          payment_amount: payment.amount,
          payment_currency: 'INR',
        },
      },
    })

    const res = await post(rawBody, headers)
    expect(res.status).toBe(200)
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CANCELLED')
  })

  it('a late success for the SAME order after a reported failure raises PAYMENT_AFTER_HOLD_EXPIRED, never re-confirms the cancelled registration', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration()

    const fail = signedWebhookBody({
      type: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: cfPaymentId('cf_pay_x1'),
          payment_status: 'FAILED',
          payment_amount: payment.amount,
          payment_currency: 'INR',
        },
      },
    })
    expect(await (await post(fail.rawBody, fail.headers)).json()).toEqual({ ok: true })
    expect((await paymentOf(registrationId)).status).toBe('FAILED')

    // Student retries on Cashfree's still-open hosted page for the SAME
    // order — a later webhook now reports success.
    const retryPaymentId = cfPaymentId('cf_pay_x2')
    const success = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: retryPaymentId,
          payment_status: 'SUCCESS',
          payment_amount: payment.amount,
          payment_currency: 'INR',
          payment_time: new Date().toISOString(),
        },
      },
    })
    const retryRes = await post(success.rawBody, success.headers)
    expect(retryRes.status).toBe(200)
    expect(await retryRes.json()).toEqual({ ok: true, exception: true })

    // The registration is never resurrected; the money is accounted for via
    // the existing PAYMENT_AFTER_HOLD_EXPIRED exception path — no new
    // mechanism, exactly as the seat-hold-expired case already works.
    const [stillCancelled] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(stillCancelled.status).toBe('CANCELLED')
    const settled = await paymentOf(registrationId)
    expect(settled).toMatchObject({
      status: 'PAID',
      providerPaymentId: retryPaymentId,
      exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED',
    })
  })

  it('raises AMOUNT_MISMATCH and leaves the registration untouched when the signed payload reports a different amount', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration()

    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: cfPaymentId('cf_pay_mismatch'),
          payment_status: 'SUCCESS',
          payment_amount: payment.amount * 100, // simulates a unit mismatch
          payment_currency: 'INR',
          payment_time: new Date().toISOString(),
        },
      },
    })

    const res = await post(rawBody, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, exception: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('PAYMENT_PENDING')
    expect(await paymentOf(registrationId)).toMatchObject({ status: 'PENDING', exceptionReason: 'AMOUNT_MISMATCH' })
  })

  it('answers {duplicate: true} for a webhook redelivery of an already-confirmed order, with no state change', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration()

    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: cfPaymentId('cf_pay_dup'),
          payment_status: 'SUCCESS',
          payment_amount: payment.amount,
          payment_currency: 'INR',
          payment_time: new Date().toISOString(),
        },
      },
    })

    expect(await (await post(rawBody, headers)).json()).toEqual({ ok: true, confirmed: true })
    const second = await post(rawBody, headers)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, duplicate: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CONFIRMED')
  })

  it('rejects a tampered webhook body with 400 INVALID_SIGNATURE, never touching the registration', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { registrationId, payment } = await createPendingRegistration()

    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: {
          cf_payment_id: cfPaymentId('cf_pay_tamper'),
          payment_status: 'SUCCESS',
          payment_amount: payment.amount,
          payment_currency: 'INR',
          payment_time: new Date().toISOString(),
        },
      },
    })
    const tampered = rawBody.replace(String(payment.amount), '1')

    const res = await post(tampered, headers)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_SIGNATURE')

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('PAYMENT_PENDING')
  })

  it('answers 400 for a structurally malformed but validly-signed payload', async () => {
    enableCashfree()
    const { rawBody, headers } = signedWebhookBody({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: {}, payment: {} } })
    const res = await post(rawBody, headers)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_PAYLOAD')
  })

  it('answers 404 for an unknown order (no matching payment row)', async () => {
    enableCashfree()
    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: `mh_${crypto.randomUUID()}` },
        payment: { cf_payment_id: cfPaymentId('cf_x'), payment_status: 'SUCCESS', payment_amount: 100, payment_currency: 'INR' },
      },
    })
    const res = await post(rawBody, headers)
    expect(res.status).toBe(404)
  })

  it('answers 404 when payments are disabled', async () => {
    enableCashfree()
    stubCashfreeCreateOrder()
    const { payment } = await createPendingRegistration()

    setRuntimeEnv({})
    const { rawBody, headers } = signedWebhookBody({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: payment.providerOrderId },
        payment: { cf_payment_id: cfPaymentId('cf_x'), payment_status: 'SUCCESS', payment_amount: payment.amount, payment_currency: 'INR' },
      },
    })
    const res = await post(rawBody, headers)
    expect(res.status).toBe(404)
  })
})
