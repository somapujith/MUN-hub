import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  muns,
  paymentWebhookEvents,
  payments,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { PaymentStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import { onPaymentFailed, onRegistrationConfirmed } from './events'
import { MOCK_PROVIDER, mockPaymentsAdapter, simulatePaymentOutcome } from './mock-adapter'
import { WEBHOOK_REPLAY_WINDOW_MS, processPaymentWebhook } from './webhook'

vi.mock('./events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./events')>()),
  onRegistrationConfirmed: vi.fn(async () => {}),
  onPaymentFailed: vi.fn(async () => {}),
}))

afterEach(() => {
  vi.mocked(onRegistrationConfirmed).mockReset().mockImplementation(async () => {})
  vi.mocked(onPaymentFailed).mockReset().mockImplementation(async () => {})
  vi.restoreAllMocks()
})

interface SeedOptions {
  registrationStatus?: RegistrationStatus
  paymentStatus?: PaymentStatus
  providerPaymentId?: string | null
  provider?: string
  amount?: number
  exceptionReason?: string | null
}

async function seed(options: SeedOptions = {}) {
  const suffix = crypto.randomUUID()
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Webhook Org', email: `wh-org-${suffix}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [student] = await db
    .insert(users)
    .values({ name: 'Webhook Student', email: `wh-stu-${suffix}@test.dev`, role: 'STUDENT' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Webhook Mun', slug: `wh-${suffix}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: options.amount ?? 1499, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({
      userId: student.id,
      munId: mun.id,
      registrationProductId: product.id,
      status: options.registrationStatus ?? 'PAYMENT_PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    .returning()
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      provider: options.provider ?? MOCK_PROVIDER,
      providerOrderId: `mock_order_${suffix}`,
      providerPaymentId: options.providerPaymentId ?? null,
      amount: options.amount ?? 1499,
      currency: 'INR',
      status: options.paymentStatus ?? 'PENDING',
      exceptionReason: options.exceptionReason ?? null,
      exceptionRaisedAt: options.exceptionReason ? new Date() : null,
    })
    .returning()
  return { registration, payment }
}

async function reload(registrationId: string, paymentId: string) {
  const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId))
  return { registration, payment }
}

async function eventRow(eventId: string) {
  const [row] = await db
    .select()
    .from(paymentWebhookEvents)
    .where(and(eq(paymentWebhookEvents.provider, MOCK_PROVIDER), eq(paymentWebhookEvents.eventId, eventId)))
  return row
}

function deliver(webhook: { rawBody: string; headers: Headers }, now?: Date) {
  return processPaymentWebhook(mockPaymentsAdapter, webhook.rawBody, webhook.headers, now)
}

function orderOf(payment: typeof payments.$inferSelect) {
  return { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency }
}

describe('processPaymentWebhook — captures', () => {
  it('confirms a PAYMENT_PENDING registration, records the event, and fires the hook after commit', async () => {
    const { registration, payment } = await seed()
    const eventId = `evt_${crypto.randomUUID()}`
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { eventId, providerPaymentId: 'pay_1' }))

    expect(result).toMatchObject({ ok: true, body: { ok: true, confirmed: true } })
    if (result.ok) await result.afterCommit

    const after = await reload(registration.id, payment.id)
    expect(after.registration.status).toBe('CONFIRMED')
    expect(after.payment.status).toBe('PAID')
    expect(after.payment.providerPaymentId).toBe('pay_1')
    expect(after.payment.exceptionReason).toBeNull()

    const row = await eventRow(eventId)
    expect(row).toMatchObject({ outcome: 'CONFIRMED', providerOrderId: payment.providerOrderId, eventType: 'payment.captured' })
    expect(row.processedAt).toBeInstanceOf(Date)
    expect(row.payloadSha256).toMatch(/^[0-9a-f]{64}$/)

    expect(onRegistrationConfirmed).toHaveBeenCalledWith(registration.id)
    expect(onPaymentFailed).not.toHaveBeenCalled()
  })

  it('treats a redelivered event id as a no-op success', async () => {
    const { registration, payment } = await seed()
    const webhook = simulatePaymentOutcome(orderOf(payment), 'success')
    await deliver(webhook)
    vi.mocked(onRegistrationConfirmed).mockClear()

    // Force the registration back so a second application would be visible.
    await db.update(registrations).set({ status: 'PAYMENT_PENDING' }).where(eq(registrations.id, registration.id))
    const again = await deliver(webhook)

    expect(again).toMatchObject({ ok: true, body: { ok: true, duplicate: true } })
    expect((await reload(registration.id, payment.id)).registration.status).toBe('PAYMENT_PENDING')
    expect(onRegistrationConfirmed).not.toHaveBeenCalled()
  })

  it('applies concurrent deliveries of one event exactly once', async () => {
    const { registration, payment } = await seed()
    const webhook = simulatePaymentOutcome(orderOf(payment), 'success')
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(webhook)))

    const bodies = results.map((r) => (r.ok ? r.body : null))
    expect(bodies.filter((b) => b?.confirmed)).toHaveLength(1)
    expect(bodies.filter((b) => b?.duplicate)).toHaveLength(4)
    expect((await reload(registration.id, payment.id)).registration.status).toBe('CONFIRMED')
    expect(onRegistrationConfirmed).toHaveBeenCalledTimes(1)
  })

  it('treats the same capture under a new event id as a duplicate, not a second payment', async () => {
    const { payment } = await seed()
    await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { providerPaymentId: 'pay_same' }))
    const again = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { providerPaymentId: 'pay_same' }))
    expect(again).toMatchObject({ ok: true, body: { ok: true, duplicate: true } })
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(row.exceptionReason).toBeNull()
  })

  it('raises DUPLICATE_PAYMENT for a second, distinct capture on a paid order', async () => {
    const { registration, payment } = await seed()
    await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { providerPaymentId: 'pay_first' }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const second = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { providerPaymentId: 'pay_second' }))
    expect(second).toMatchObject({ ok: true, body: { ok: true, exception: true } })

    const after = await reload(registration.id, payment.id)
    expect(after.registration.status).toBe('CONFIRMED')
    expect(after.payment.status).toBe('PAID')
    expect(after.payment.providerPaymentId).toBe('pay_first')
    expect(after.payment.exceptionReason).toBe('DUPLICATE_PAYMENT')
    expect(after.payment.exceptionRaisedAt).toBeInstanceOf(Date)
  })

  it('marks a payment that arrives after the hold was released PAID with an exception — never REFUNDED', async () => {
    const { registration, payment } = await seed({ registrationStatus: 'CANCELLED' })
    const eventId = `evt_${crypto.randomUUID()}`
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { eventId, providerPaymentId: 'pay_late' }))

    expect(result).toMatchObject({ ok: true, body: { ok: true, exception: true } })
    if (result.ok) expect(result.body).not.toHaveProperty('refundOwed')

    const after = await reload(registration.id, payment.id)
    expect(after.registration.status).toBe('CANCELLED')
    expect(after.payment.status).toBe('PAID')
    expect(after.payment.providerPaymentId).toBe('pay_late')
    expect(after.payment.exceptionReason).toBe('PAYMENT_AFTER_HOLD_EXPIRED')
    expect(after.payment.exceptionRaisedAt).toBeInstanceOf(Date)
    expect(after.payment.exceptionResolvedAt).toBeNull()
    expect((await eventRow(eventId)).outcome).toBe('EXCEPTION_PAYMENT_AFTER_HOLD_EXPIRED')
    expect(onRegistrationConfirmed).not.toHaveBeenCalled()
  })

  it.each([
    ['amount', { amount: 1 }],
    ['currency', { currency: 'USD' }],
  ])('refuses to confirm on a %s mismatch and raises AMOUNT_MISMATCH', async (_label, override) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { registration, payment } = await seed()
    const result = await deliver(
      simulatePaymentOutcome(orderOf(payment), 'success', { ...override, providerPaymentId: 'pay_odd' }),
    )

    expect(result).toMatchObject({ ok: true, body: { ok: true, exception: true } })
    const after = await reload(registration.id, payment.id)
    expect(after.registration.status).toBe('PAYMENT_PENDING')
    expect(after.payment.status).toBe('PENDING')
    expect(after.payment.providerPaymentId).toBe('pay_odd')
    expect(after.payment.exceptionReason).toBe('AMOUNT_MISMATCH')
    expect(onRegistrationConfirmed).not.toHaveBeenCalled()
  })

  it('never overwrites an exception that is still open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { registration, payment } = await seed({ exceptionReason: 'AMOUNT_MISMATCH', registrationStatus: 'CANCELLED' })
    await deliver(simulatePaymentOutcome(orderOf(payment), 'success'))
    const after = await reload(registration.id, payment.id)
    expect(after.payment.status).toBe('PAID')
    expect(after.payment.exceptionReason).toBe('AMOUNT_MISMATCH')
  })

  it('treats a legacy REFUNDED (late-payment) row as already captured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { payment } = await seed({ registrationStatus: 'CANCELLED', paymentStatus: 'REFUNDED', providerPaymentId: 'pay_old' })
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { providerPaymentId: 'pay_old' }))
    expect(result).toMatchObject({ ok: true, body: { ok: true, duplicate: true } })
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(row.status).toBe('REFUNDED')
  })
})

describe('processPaymentWebhook — failures', () => {
  it('fails the payment, releases the seat, and fires the failure hook', async () => {
    const { registration, payment } = await seed()
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'failure'))
    expect(result).toMatchObject({ ok: true, body: { ok: true } })
    if (result.ok) await result.afterCommit

    const after = await reload(registration.id, payment.id)
    expect(after.payment.status).toBe('FAILED')
    expect(after.registration.status).toBe('CANCELLED')
    expect(onPaymentFailed).toHaveBeenCalledWith(registration.id)
  })

  it('does not fire the failure hook twice for a second failed attempt', async () => {
    const { payment } = await seed()
    await deliver(simulatePaymentOutcome(orderOf(payment), 'failure'))
    await deliver(simulatePaymentOutcome(orderOf(payment), 'failure'))
    expect(onPaymentFailed).toHaveBeenCalledTimes(1)
  })

  it('ignores a failure reported after a successful capture', async () => {
    const { registration, payment } = await seed()
    await deliver(simulatePaymentOutcome(orderOf(payment), 'success'))
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'failure'))
    expect(result).toMatchObject({ ok: true, body: { ok: true, ignored: true } })
    const after = await reload(registration.id, payment.id)
    expect(after.payment.status).toBe('PAID')
    expect(after.registration.status).toBe('CONFIRMED')
  })

  it('logs, but never surfaces, a failing hook', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(onRegistrationConfirmed).mockRejectedValueOnce(new Error('mail down'))
    const { payment } = await seed()
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success'))
    expect(result.ok).toBe(true)
    if (result.ok) await expect(result.afterCommit).resolves.toBeUndefined()
    expect(errorLog).toHaveBeenCalled()
  })
})

describe('processPaymentWebhook — rejections', () => {
  it('rejects a bad signature before touching the database', async () => {
    const { registration, payment } = await seed()
    const eventId = `evt_${crypto.randomUUID()}`
    const webhook = simulatePaymentOutcome(orderOf(payment), 'success', { eventId })
    webhook.headers.set('x-webhook-signature', 'f'.repeat(64))

    const result = await deliver(webhook)
    expect(result).toEqual({ ok: false, error: 'INVALID_SIGNATURE', message: 'Invalid signature' })
    expect(await eventRow(eventId)).toBeUndefined()
    expect((await reload(registration.id, payment.id)).registration.status).toBe('PAYMENT_PENDING')
  })

  it('rejects a delivery signed outside the replay window, then accepts a fresh redelivery of that event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { registration, payment } = await seed()
    const eventId = `evt_${crypto.randomUUID()}`
    const stale = simulatePaymentOutcome(orderOf(payment), 'success', {
      eventId,
      signedAt: new Date(Date.now() - WEBHOOK_REPLAY_WINDOW_MS - 60_000),
    })

    const rejected = await deliver(stale)
    expect(rejected).toMatchObject({ ok: false, error: 'STALE_EVENT' })
    expect((await reload(registration.id, payment.id)).registration.status).toBe('PAYMENT_PENDING')
    const logged = await eventRow(eventId)
    expect(logged.outcome).toBe('REJECTED_STALE')
    expect(logged.processedAt).toBeNull()

    const fresh = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { eventId }))
    expect(fresh).toMatchObject({ ok: true, body: { confirmed: true } })
    expect((await eventRow(eventId)).outcome).toBe('CONFIRMED')
  })

  it('rejects a delivery signed too far in the future', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { payment } = await seed()
    const result = await deliver(
      simulatePaymentOutcome(orderOf(payment), 'success', { signedAt: new Date(Date.now() + WEBHOOK_REPLAY_WINDOW_MS + 60_000) }),
    )
    expect(result).toMatchObject({ ok: false, error: 'STALE_EVENT' })
  })

  it('accepts a delivery inside the window', async () => {
    const { payment } = await seed()
    const result = await deliver(
      simulatePaymentOutcome(orderOf(payment), 'success', { signedAt: new Date(Date.now() - WEBHOOK_REPLAY_WINDOW_MS + 30_000) }),
    )
    expect(result).toMatchObject({ ok: true, body: { confirmed: true } })
  })

  it('answers PAYMENT_NOT_FOUND for an unknown order and leaves the event re-processable', async () => {
    const eventId = `evt_${crypto.randomUUID()}`
    const webhook = simulatePaymentOutcome({ orderId: `mock_order_missing_${eventId}`, amount: 100, currency: 'INR' }, 'success', { eventId })
    expect(await deliver(webhook)).toMatchObject({ ok: false, error: 'PAYMENT_NOT_FOUND' })
    const row = await eventRow(eventId)
    expect(row.outcome).toBe('UNKNOWN_ORDER')
    expect(row.processedAt).toBeNull()
    // A retry is evaluated again rather than swallowed as a duplicate.
    expect(await deliver(webhook)).toMatchObject({ ok: false, error: 'PAYMENT_NOT_FOUND' })
  })

  it('never settles a payment that belongs to another provider', async () => {
    const { registration, payment } = await seed({ provider: 'razorpay' })
    expect(await deliver(simulatePaymentOutcome(orderOf(payment), 'success'))).toMatchObject({
      ok: false,
      error: 'PAYMENT_NOT_FOUND',
    })
    expect((await reload(registration.id, payment.id)).registration.status).toBe('PAYMENT_PENDING')
  })
})
