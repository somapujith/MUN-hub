import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getMun, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { deliverWebhook, signedWebhook } from '../../fixtures/payments'
import { expireSeatHold, paymentFor, registrationCount, registrationStatus, type StoredPayment } from '../../fixtures/payments-fixture-db'
import { adminApi } from '../admin/_helpers'

/**
 * Payments hardening through the API (lane `payments`): Idempotency-Key on
 * POST /registrations, and the provider webhook's signature check, replay
 * window, event dedupe and amount check. There are no refunds: money that
 * can't be applied becomes a payment exception, never REFUNDED.
 *
 * Registrations use a fresh delegate on the open fixture's "E2E Delegate
 * Pass" (₹1,499) with no committee.
 */

const DELEGATE_PASS = OPEN.products[0]
const LIMITED_PASS = OPEN.products[1]

interface Registered {
  delegate: ApiSession
  munId: string
  registrationId: string
  payment: StoredPayment
}

async function passId(api: APIRequestContext, name: string) {
  const mun = await getMun(api, OPEN.slug)
  const pass = mun.registrationProducts.find((p) => p.name === name)
  expect(pass, `${name} is offered`).toBeTruthy()
  return { munId: mun.id, productId: pass!.id }
}

function register(delegate: ApiSession, body: { munId: string; productId: string }, key: string | null = randomUUID()) {
  return delegate.api.post('registrations', {
    headers: key === null ? {} : { 'Idempotency-Key': key },
    data: { munId: body.munId, registrationProductId: body.productId },
  })
}

/** A fresh delegate holding a seat with a PENDING payment order. */
async function pendingOrder(): Promise<Registered> {
  const delegate = await signUpViaApi()
  const ids = await passId(delegate.api, DELEGATE_PASS.name)
  const res = await register(delegate, ids)
  expect(res.status(), await res.text()).toBe(201)
  const { registrationId } = (await res.json()) as { registrationId: string }
  const payment = await paymentFor(registrationId)
  expect(payment, 'a payment order was created').toBeTruthy()
  expect(payment).toMatchObject({ status: 'PENDING', amount: DELEGATE_PASS.price, currency: 'INR', exceptionReason: null })
  return { delegate, munId: ids.munId, registrationId, payment: payment! }
}

/** Resolves an open exception through the admin API, so the queue stays short. */
async function resolveException(paymentId: string) {
  const admin = await adminApi()
  const res = await admin.post(`admin/payment-exceptions/${paymentId}/resolve`, {
    data: { note: 'Checked with the provider (E2E cleanup)' },
  })
  expect(res.status(), await res.text()).toBe(200)
  await admin.dispose()
}

test.describe('registration idempotency', () => {
  test('retrying with the same Idempotency-Key returns the same registration instead of a second one', async () => {
    const delegate = await signUpViaApi()
    const ids = await passId(delegate.api, DELEGATE_PASS.name)
    const key = randomUUID()

    const first = await register(delegate, ids, key)
    expect(first.status(), await first.text()).toBe(201)
    const created = await first.json()
    expect(created).toMatchObject({ status: 'PAYMENT_PENDING', replayed: false })
    expect(created.orderId).toEqual(expect.any(String))

    const retry = await register(delegate, ids, key)
    expect(retry.status(), await retry.text()).toBe(200)
    expect(await retry.json()).toEqual({ ...created, replayed: true })
    expect(await registrationCount(delegate.userId, ids.munId)).toBe(1)
  })

  test('concurrent retries with one key still make exactly one registration', async () => {
    const delegate = await signUpViaApi()
    const ids = await passId(delegate.api, DELEGATE_PASS.name)
    const key = randomUUID()
    const responses = await Promise.all(Array.from({ length: 5 }, () => register(delegate, ids, key)))
    const statuses = responses.map((r) => r.status()).sort()
    expect(statuses).toEqual([200, 200, 200, 200, 201])
    const bodies = await Promise.all(responses.map((r) => r.json()))
    expect(new Set(bodies.map((b) => b.registrationId)).size).toBe(1)
    expect(await registrationCount(delegate.userId, ids.munId)).toBe(1)
  })

  test('a replay after paying returns the confirmed registration and never charges again', async () => {
    const delegate = await signUpViaApi()
    const ids = await passId(delegate.api, DELEGATE_PASS.name)
    const key = randomUUID()
    const { registrationId } = await (await register(delegate, ids, key)).json()
    const paid = await delegate.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    expect(await paid.json()).toEqual({ ok: true, confirmed: true })
    const before = await paymentFor(registrationId)

    const retry = await register(delegate, ids, key)
    expect(retry.status()).toBe(200)
    expect(await retry.json()).toMatchObject({ registrationId, status: 'CONFIRMED', replayed: true })
    expect(await registrationCount(delegate.userId, ids.munId)).toBe(1)
    expect(await paymentFor(registrationId)).toEqual(before)
  })

  test('the same key for a different pass is refused, and holds no seat', async () => {
    const delegate = await signUpViaApi()
    const delegatePass = await passId(delegate.api, DELEGATE_PASS.name)
    const limitedPass = await passId(delegate.api, LIMITED_PASS.name)
    const key = randomUUID()
    expect((await register(delegate, delegatePass, key)).status()).toBe(201)

    const reused = await register(delegate, limitedPass, key)
    expect(reused.status()).toBe(409)
    expect((await reused.json()).error).toMatchObject({
      code: 'CONFLICT_STATE',
      message: 'This request key was already used for a different registration',
    })
    expect(await registrationCount(delegate.userId, delegatePass.munId)).toBe(1)
  })

  test('keys belong to one account: two delegates using the same key each get their own seat', async () => {
    const key = randomUUID()
    const ids: string[] = []
    for (let i = 0; i < 2; i += 1) {
      const delegate = await signUpViaApi()
      const res = await register(delegate, await passId(delegate.api, DELEGATE_PASS.name), key)
      expect(res.status(), await res.text()).toBe(201)
      ids.push((await res.json()).registrationId)
    }
    expect(ids[0]).not.toBe(ids[1])
  })

  test('a registration without a usable Idempotency-Key is refused before anything is held', async () => {
    const delegate = await signUpViaApi()
    const ids = await passId(delegate.api, DELEGATE_PASS.name)
    for (const [key, message] of [
      [null, 'Idempotency-Key header is required'],
      ['   ', 'Idempotency-Key header is required'],
      ['k'.repeat(256), 'Idempotency-Key must be at most 255 characters'],
    ] as const) {
      const res = await register(delegate, ids, key)
      expect(res.status(), String(key)).toBe(400)
      expect((await res.json()).error).toMatchObject({ code: 'VALIDATION_FAILED', message })
    }
    expect(await registrationCount(delegate.userId, ids.munId)).toBe(0)
    // 255 characters is still fine.
    expect((await register(delegate, ids, 'k'.repeat(255))).status()).toBe(201)
  })
})

test.describe('payments webhook', () => {
  test('a delivery that is not signed with the provider secret changes nothing', async () => {
    const { registrationId, payment } = await pendingOrder()
    const genuine = signedWebhook({ orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency })

    const forgeries = [
      signedWebhook({
        orderId: payment.providerOrderId,
        amount: payment.amount,
        currency: payment.currency,
        secret: 'not-the-provider-secret',
      }),
      // Signed body, then tampered with.
      { ...genuine, body: genuine.body.replace(`"amount":${payment.amount}`, '"amount":1') },
      { ...genuine, headers: { ...genuine.headers, 'x-webhook-timestamp': '' } },
      { ...genuine, headers: { ...genuine.headers, 'x-webhook-signature': 'deadbeef' } },
      // Re-timestamped without re-signing.
      { ...genuine, headers: { ...genuine.headers, 'x-webhook-timestamp': String(Number(genuine.headers['x-webhook-timestamp']) + 1) } },
    ]
    for (const [index, forged] of forgeries.entries()) {
      const res = await deliverWebhook(forged)
      expect(res.status, `forgery #${index}: ${res.text}`).toBe(400)
      expect(res.json).toMatchObject({ code: 'INVALID_SIGNATURE' })
    }
    expect(await registrationStatus(registrationId)).toBe('PAYMENT_PENDING')
    expect(await paymentFor(registrationId)).toMatchObject({ status: 'PENDING', exceptionReason: null })

    // The genuine one still works afterwards.
    const res = await deliverWebhook(genuine)
    expect(res.status, res.text).toBe(200)
    expect(res.json).toEqual({ ok: true, confirmed: true })
    expect(await registrationStatus(registrationId)).toBe('CONFIRMED')
  })

  test('a signed event for an order that does not exist is a 404', async () => {
    const res = await deliverWebhook(signedWebhook({ orderId: `mock_order_${randomUUID()}`, amount: 1499, currency: 'INR' }))
    expect(res.status, res.text).toBe(404)
    expect(res.json).toMatchObject({ code: 'PAYMENT_NOT_FOUND' })
  })

  test('an amount that differs from the order never confirms the seat; it becomes an exception', async () => {
    const { delegate, registrationId, payment } = await pendingOrder()
    const res = await deliverWebhook(
      signedWebhook({ orderId: payment.providerOrderId, amount: payment.amount - 1, currency: payment.currency }),
    )
    expect(res.status, res.text).toBe(200)
    expect(res.json).toEqual({ ok: true, exception: true })
    expect(await registrationStatus(registrationId)).toBe('PAYMENT_PENDING')
    const stored = await paymentFor(registrationId)
    expect(stored).toMatchObject({ status: 'PENDING', exceptionReason: 'AMOUNT_MISMATCH', exceptionResolvedAt: null })
    expect(stored!.exceptionRaisedAt).not.toBeNull()

    const admin = await adminApi()
    // The queue is paginated ({results, total}); search by the delegate's email.
    const listed = await admin.get(`admin/payment-exceptions?q=${encodeURIComponent(delegate.email)}`)
    expect(listed.status(), await listed.text()).toBe(200)
    const queue = (await listed.json()) as { results: Array<{ paymentId: string; reason: string }>; total: number }
    expect(queue.total).toBe(1)
    expect(queue.results.find((row) => row.paymentId === payment.id)).toMatchObject({ reason: 'AMOUNT_MISMATCH' })
    await admin.dispose()
    await resolveException(payment.id)
  })

  test('a currency that differs from the order never confirms the seat either', async () => {
    const { registrationId, payment } = await pendingOrder()
    const res = await deliverWebhook(signedWebhook({ orderId: payment.providerOrderId, amount: payment.amount, currency: 'USD' }))
    expect(res.status, res.text).toBe(200)
    expect(res.json).toEqual({ ok: true, exception: true })
    expect(await registrationStatus(registrationId)).toBe('PAYMENT_PENDING')
    expect(await paymentFor(registrationId)).toMatchObject({ status: 'PENDING', exceptionReason: 'AMOUNT_MISMATCH' })
    await resolveException(payment.id)
  })

  test('a redelivered event is applied once', async () => {
    const { registrationId, payment } = await pendingOrder()
    const capture = signedWebhook({ orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency })

    expect((await deliverWebhook(capture)).json).toEqual({ ok: true, confirmed: true })
    const afterFirst = await paymentFor(registrationId)
    expect(afterFirst).toMatchObject({ status: 'PAID', providerPaymentId: capture.providerPaymentId })

    // The exact same delivery again.
    const again = await deliverWebhook(capture)
    expect(again.status).toBe(200)
    expect(again.json).toEqual({ ok: true, duplicate: true })

    // Same event id, re-signed with a different payload: still the same event.
    const sameId = signedWebhook({
      orderId: payment.providerOrderId,
      amount: payment.amount,
      currency: payment.currency,
      eventId: capture.eventId,
      providerPaymentId: `pay_e2e_${randomUUID()}`,
    })
    expect((await deliverWebhook(sameId)).json).toEqual({ ok: true, duplicate: true })

    // A new event id for the same capture (provider retry with a fresh id).
    const sameCapture = signedWebhook({
      orderId: payment.providerOrderId,
      amount: payment.amount,
      currency: payment.currency,
      providerPaymentId: capture.providerPaymentId,
    })
    expect((await deliverWebhook(sameCapture)).json).toEqual({ ok: true, duplicate: true })

    expect(await paymentFor(registrationId)).toEqual(afterFirst)
    expect(await registrationStatus(registrationId)).toBe('CONFIRMED')
  })

  test('a second, different charge on a paid order is flagged for an admin, not applied', async () => {
    const { registrationId, payment } = await pendingOrder()
    const order = { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency }
    const first = signedWebhook(order)
    expect((await deliverWebhook(first)).json).toEqual({ ok: true, confirmed: true })

    const second = await deliverWebhook(signedWebhook(order))
    expect(second.status).toBe(200)
    expect(second.json).toEqual({ ok: true, exception: true })
    expect(await paymentFor(registrationId)).toMatchObject({
      status: 'PAID',
      providerPaymentId: first.providerPaymentId,
      exceptionReason: 'DUPLICATE_PAYMENT',
    })
    expect(await registrationStatus(registrationId)).toBe('CONFIRMED')
    await resolveException(payment.id)
  })

  test('a delivery signed outside the 5-minute replay window is refused, and can be delivered fresh later', async () => {
    const { registrationId, payment } = await pendingOrder()
    const order = { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency }
    const eventId = `evt_e2e_${randomUUID()}`

    for (const offsetMs of [-6 * 60_000, 6 * 60_000]) {
      const stale = await deliverWebhook(signedWebhook({ ...order, eventId, signedAt: new Date(Date.now() + offsetMs) }))
      expect(stale.status, `offset ${offsetMs}: ${stale.text}`).toBe(400)
      expect(stale.json).toMatchObject({ code: 'STALE_EVENT' })
    }
    expect(await registrationStatus(registrationId)).toBe('PAYMENT_PENDING')
    expect(await paymentFor(registrationId)).toMatchObject({ status: 'PENDING', exceptionReason: null })

    // The refused delivery wasn't recorded as processed: the provider's fresh retry applies.
    const fresh = await deliverWebhook(signedWebhook({ ...order, eventId, signedAt: new Date(Date.now() - 60_000) }))
    expect(fresh.status, fresh.text).toBe(200)
    expect(fresh.json).toEqual({ ok: true, confirmed: true })
    expect(await registrationStatus(registrationId)).toBe('CONFIRMED')
  })

  test('expiry is judged by when the provider captured the money, not when the webhook arrives', async () => {
    // Captured while the hold was still running, delivered after it ran out: confirms.
    const inTime = await pendingOrder()
    await expireSeatHold(inTime.registrationId, 60_000)
    const delayed = await deliverWebhook(
      signedWebhook({
        orderId: inTime.payment.providerOrderId,
        amount: inTime.payment.amount,
        currency: inTime.payment.currency,
        occurredAt: new Date(Date.now() - 2 * 60_000),
      }),
    )
    expect(delayed.status, delayed.text).toBe(200)
    expect(delayed.json).toEqual({ ok: true, confirmed: true })
    expect(await registrationStatus(inTime.registrationId)).toBe('CONFIRMED')
    expect(await paymentFor(inTime.registrationId)).toMatchObject({ status: 'PAID', exceptionReason: null })

    // Captured after the hold ran out, with no sweep in between: the webhook releases the seat itself.
    const late = await pendingOrder()
    await expireSeatHold(late.registrationId, 2 * 60_000)
    expect(await registrationStatus(late.registrationId)).toBe('PAYMENT_PENDING')
    const res = await deliverWebhook(
      signedWebhook({
        orderId: late.payment.providerOrderId,
        amount: late.payment.amount,
        currency: late.payment.currency,
        occurredAt: new Date(Date.now() - 60_000),
      }),
    )
    expect(res.json).toEqual({ ok: true, exception: true })
    expect(await registrationStatus(late.registrationId)).toBe('CANCELLED')
    expect(await paymentFor(late.registrationId)).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
    await resolveException(late.payment.id)
  })

  test('a failed payment releases the seat; money captured afterwards is an exception, never a refund', async () => {
    const { registrationId, payment } = await pendingOrder()
    const order = { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency }

    expect((await deliverWebhook(signedWebhook({ ...order, type: 'payment.failed' }))).json).toEqual({ ok: true })
    expect(await registrationStatus(registrationId)).toBe('CANCELLED')
    expect(await paymentFor(registrationId)).toMatchObject({ status: 'FAILED', exceptionReason: null })

    const late = await deliverWebhook(signedWebhook(order))
    expect(late.json).toEqual({ ok: true, exception: true })
    expect(await registrationStatus(registrationId)).toBe('CANCELLED')
    expect(await paymentFor(registrationId)).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
    expect(late.text).not.toMatch(/refund/i)
    await resolveException(payment.id)
  })
})
