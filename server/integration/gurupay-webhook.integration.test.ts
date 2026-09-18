import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeStudentProfile } from '@/lib/actions/student-profile'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations } from '@/lib/db/schema'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

/**
 * Full webhook route test with PAYMENTS_ADAPTER=gurupay and a stubbed
 * check-status — never a real GuruPay call (docs/payments/SPEC.md §6, §9).
 * Follows server/integration/payments.integration.test.ts's pattern.
 */

const app = createApp()

const SAVED_ADAPTER = process.env.PAYMENTS_ADAPTER

function enableGuruPay() {
  process.env.PAYMENTS_ADAPTER = 'gurupay'
  setRuntimeEnv({ GURUPAY_API_KEY: 'test-gurupay-key', PAYMENTS_ADAPTER: 'gurupay' })
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

/**
 * Stubs fetch: create-order always succeeds; check-status returns whatever
 * `checkStatusData` resolves to for the polled order_id. Response shapes are
 * the CONFIRMED REAL ones (GuruPay dashboard, 2026-09-18) — top-level
 * fields, not nested under `data`.
 */
function stubGuruPayFetch(checkStatusData: (orderId: string) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/api/create-order')) {
        const body = JSON.parse(String(init.body)) as { order_id: string; callback_url: string }
        // callback_url must be a real web app page, never the webhook route
        // (bug fix) — asserted here so every test in this file that hits
        // create-order incidentally guards against a regression.
        if (body.callback_url.includes('/webhooks/payments')) {
          throw new Error('callback_url must never be the webhook endpoint')
        }
        return jsonResponse({ status: 'success', payment_url: `https://www.gurupaygateway.com/pay/${body.order_id}` })
      }
      if (href.endsWith('/api/check-status')) {
        const body = JSON.parse(String(init.body)) as { order_id: string }
        const data = await checkStatusData(body.order_id)
        return jsonResponse(data)
      }
      throw new Error(`Unexpected GuruPay call: ${href}`)
    }),
  )
}

async function makeOpenMun(passes: Array<{ name: string; price: number }> = [{ name: 'Delegate', price: 1499 }]) {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'GuruPay Mun', slug: `gurupay-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
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

describe('POST /registrations under PAYMENTS_ADAPTER=gurupay', () => {
  it('creates the order via stubbed fetch and returns the checkout object with fee split', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    process.env.PLATFORM_FEE_BPS = '650'
    process.env.PLATFORM_FEE_TAX_BPS = '1800'

    const { registrationId, payment } = await createPendingRegistration(1499)

    // 1499 -> fee 97, tax 17, total 1613 (spec's worked example).
    expect(payment).toMatchObject({
      provider: 'gurupay',
      amount: 1613,
      platformFeeAmount: 97,
      platformFeeTaxAmount: 17,
      organizerNetAmount: 1499,
      status: 'PENDING',
    })
    expect(payment.checkoutUrl).toMatch(/^https:\/\/www\.gurupaygateway\.com\/pay\//)

    const res = await app.request(`/api/v1/registrations/${registrationId}`, { headers: await authHeaders((await db.query.registrations.findFirst({ where: eq(registrations.id, registrationId) }))!.userId) })
    const body = await res.json()
    expect(body.paymentProvider).toBe('gurupay')
    // Itemized fee breakdown (docs/payments/SPEC.md §5/bug fix): the checkout
    // object must carry the actual pass/fee/tax split, not just the total.
    expect(body.checkout).toMatchObject({
      paymentUrl: payment.checkoutUrl,
      orderId: payment.providerOrderId,
      amount: 1613,
      currency: 'INR',
      passAmount: 1499,
      platformFeeAmount: 97,
      platformFeeTaxAmount: 17,
    })
  })

  it('never sends the webhook route as callback_url (bug fix — callback_url is the browser redirect target, not the webhook)', async () => {
    enableGuruPay()
    const calls: Array<{ callback_url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const href = String(url)
        if (href.endsWith('/api/create-order')) {
          const body = JSON.parse(String(init.body)) as { order_id: string; callback_url: string }
          calls.push({ callback_url: body.callback_url })
          return jsonResponse({ status: 'success', payment_url: `https://www.gurupaygateway.com/pay/${body.order_id}` })
        }
        throw new Error(`Unexpected GuruPay call: ${href}`)
      }),
    )

    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()
    await register(headers, { munId: mun.id, registrationProductId: products[0].id })

    expect(calls).toHaveLength(1)
    expect(calls[0].callback_url).not.toContain('/webhooks/payments')
    expect(calls[0].callback_url).toContain(`/register/${mun.slug}/pay?registrationId=`)
  })

  it('answers 503 PAYMENTS_UNAVAILABLE when GURUPAY_API_KEY is unset', async () => {
    process.env.PAYMENTS_ADAPTER = 'gurupay'
    setRuntimeEnv({})
    const { mun, products } = await makeOpenMun()
    const { headers } = await makeStudent()

    const res = await register(headers, { munId: mun.id, registrationProductId: products[0].id })
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE')
  })

  it('confirms a free pass immediately without ever calling GuruPay', async () => {
    enableGuruPay()
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

describe('POST /webhooks/payments under PAYMENTS_ADAPTER=gurupay', () => {
  function post(rawBody: string) {
    return app.request('/webhooks/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    })
  }

  it('confirms on check-status success, sets organizerNetAmount to the listed price and amount to totalCharge', async () => {
    process.env.PLATFORM_FEE_BPS = '650'
    process.env.PLATFORM_FEE_TAX_BPS = '1800'
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration(1499)

    // Now flip check-status to report success for this specific order.
    stubGuruPayFetch(() => ({
      status: 'success',
      amount: String(payment.amount),
      utr: 'UTR_SUCCESS_1',
      paid_at: new Date().toISOString(),
    }))

    // Forged webhook body: fake amount/status that must be ignored.
    const res = await post(JSON.stringify({ order_id: payment.providerOrderId, amount: 1, status: 'failed' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, confirmed: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CONFIRMED')
    const settled = await paymentOf(registrationId)
    expect(settled).toMatchObject({
      status: 'PAID',
      providerPaymentId: 'UTR_SUCCESS_1',
      amount: 1613,
      organizerNetAmount: 1499,
    })
  })

  it('cancels the registration on check-status failed', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration()

    stubGuruPayFetch(() => ({ status: 'failed', amount: String(payment.amount), utr: null }))

    const res = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CANCELLED')
    expect((await paymentOf(registrationId)).status).toBe('FAILED')
  })

  it('a late success for the SAME order after a reported failure raises PAYMENT_AFTER_HOLD_EXPIRED, never re-confirms the cancelled registration (bug fix — failed is not permanently terminal)', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration()

    stubGuruPayFetch(() => ({ status: 'failed', amount: String(payment.amount), utr: null }))
    const failRes = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(await failRes.json()).toEqual({ ok: true })
    expect((await paymentOf(registrationId)).status).toBe('FAILED')
    const [cancelled] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(cancelled.status).toBe('CANCELLED')

    // Student retries on GuruPay's still-open hosted page for the SAME
    // order_id; a later webhook/reconciliation poll now reports success.
    stubGuruPayFetch(() => ({ status: 'success', amount: String(payment.amount), utr: 'UTR_LATE_RETRY' }))
    const retryRes = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(retryRes.status).toBe(200)
    expect(await retryRes.json()).toEqual({ ok: true, exception: true })

    // The registration is never resurrected; the money is accounted for via
    // the existing PAYMENT_AFTER_HOLD_EXPIRED exception path (lib/payments/webhook.ts#applyEvent) —
    // no new mechanism, exactly as the seat-hold-expired case already works.
    const [stillCancelled] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(stillCancelled.status).toBe('CANCELLED')
    const settled = await paymentOf(registrationId)
    expect(settled).toMatchObject({
      status: 'PAID',
      providerPaymentId: 'UTR_LATE_RETRY',
      exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED',
    })
  })

  it('raises AMOUNT_MISMATCH and leaves the registration untouched when check-status reports a different amount', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration()

    // check-status reports success but with the WRONG amount — a systematic
    // rupee/paise unit bug would trip this on every payment (spec §6).
    stubGuruPayFetch(() => ({
      status: 'success',
      amount: String(payment.amount * 100), // simulates a paise-vs-rupee mismatch
      utr: 'UTR_MISMATCH',
    }))

    const res = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, exception: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('PAYMENT_PENDING')
    expect(await paymentOf(registrationId)).toMatchObject({ status: 'PENDING', exceptionReason: 'AMOUNT_MISMATCH' })
  })

  it('answers {duplicate: true} for a webhook redelivery of an already-confirmed order, with no state change', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration()

    stubGuruPayFetch(() => ({ status: 'success', amount: String(payment.amount), utr: 'UTR_DUP' }))

    const first = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(await first.json()).toEqual({ ok: true, confirmed: true })

    const second = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, duplicate: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('CONFIRMED')
  })

  it('acknowledges a pending check-status result as ignored, with no state change', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration()

    const res = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('PAYMENT_PENDING')
  })

  it('leaves the webhook unprocessed (400) when check-status itself fails — never confirms on missing information', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { registrationId, payment } = await createPendingRegistration()

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'failed' }, { status: 500 })))

    const res = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_PAYLOAD')

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(registration.status).toBe('PAYMENT_PENDING')
    expect((await paymentOf(registrationId)).status).toBe('PENDING')
  })

  it('answers 400 for a malformed webhook body (no order_id) without ever calling check-status', async () => {
    enableGuruPay()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await post(JSON.stringify({ not: 'a valid body' }))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown order (no matching payment row)', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'success', amount: '100.00', utr: 'X' }))

    const res = await post(JSON.stringify({ order_id: `mh_${crypto.randomUUID()}_${crypto.randomUUID()}` }))
    expect(res.status).toBe(404)
  })

  it('answers 404 when payments are disabled', async () => {
    enableGuruPay()
    stubGuruPayFetch(() => ({ status: 'pending', amount: '1.00' }))
    const { payment } = await createPendingRegistration()

    setRuntimeEnv({})
    const res = await post(JSON.stringify({ order_id: payment.providerOrderId }))
    expect(res.status).toBe(404)
  })
})
