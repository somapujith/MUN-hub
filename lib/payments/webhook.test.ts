import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  muns,
  paymentWebhookEvents,
  payments,
  registrationGroups,
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
  expiresAt?: Date
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
      expiresAt: options.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
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

/**
 * Seeds a group/delegation registration: a `registrationGroups` row, a head
 * registration (own `userId`), `placeholderCount` teammate slots still
 * temporarily owned by the head, and one claimed teammate slot with a
 * distinct real `userId` (so notifyTargets' "already-joined member" branch
 * has something to exercise). One payment attaches to the head's own row,
 * matching initiateGroupRegistration.
 */
async function seedGroup(options: { placeholderCount?: number; amount?: number; registrationStatus?: RegistrationStatus } = {}) {
  const suffix = crypto.randomUUID()
  const placeholderCount = options.placeholderCount ?? 2
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Group Org', email: `grp-org-${suffix}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [head] = await db
    .insert(users)
    .values({ name: 'Group Head', email: `grp-head-${suffix}@test.dev`, role: 'STUDENT' })
    .returning()
  const [joinedMember] = await db
    .insert(users)
    .values({ name: 'Group Member', email: `grp-member-${suffix}@test.dev`, role: 'STUDENT' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Group Mun', slug: `grp-${suffix}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegation', price: options.amount ?? 1000, capacity: 20, allowsDelegation: true })
    .returning()

  const [group] = await db
    .insert(registrationGroups)
    .values({ munId: mun.id, registrationProductId: product.id, headUserId: head.id, teamSize: placeholderCount + 2 })
    .returning()

  const status = options.registrationStatus ?? 'PAYMENT_PENDING'
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

  const [headRegistration] = await db
    .insert(registrations)
    .values({ userId: head.id, munId: mun.id, registrationProductId: product.id, registrationGroupId: group.id, status, expiresAt })
    .returning()
  const [joinedRegistration] = await db
    .insert(registrations)
    .values({ userId: joinedMember.id, munId: mun.id, registrationProductId: product.id, registrationGroupId: group.id, status, expiresAt })
    .returning()
  const placeholders =
    placeholderCount > 0
      ? await db
          .insert(registrations)
          .values(
            Array.from({ length: placeholderCount }, () => ({
              userId: head.id,
              munId: mun.id,
              registrationProductId: product.id,
              registrationGroupId: group.id,
              status,
              expiresAt,
            })),
          )
          .returning()
      : []

  await db.update(registrationGroups).set({ headRegistrationId: headRegistration.id }).where(eq(registrationGroups.id, group.id))

  const totalAmount = (options.amount ?? 1000) * (placeholderCount + 2)
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: headRegistration.id,
      provider: MOCK_PROVIDER,
      providerOrderId: `mock_order_${suffix}`,
      amount: totalAmount,
      currency: 'INR',
      status: 'PENDING',
    })
    .returning()

  return { group, head, joinedMember, headRegistration, joinedRegistration, placeholders, payment }
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

  it('treats a capture after an expired hold as a payment exception even before the sweep releases it', async () => {
    const { registration, payment } = await seed({ expiresAt: new Date(Date.now() - 60_000) })
    const eventId = `evt_${crypto.randomUUID()}`
    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { eventId, providerPaymentId: 'pay_after_expiry' }))

    expect(result).toMatchObject({ ok: true, body: { ok: true, exception: true } })
    const after = await reload(registration.id, payment.id)
    expect(after.registration.status).toBe('CANCELLED')
    expect(after.payment.status).toBe('PAID')
    expect(after.payment.exceptionReason).toBe('PAYMENT_AFTER_HOLD_EXPIRED')
    expect(onRegistrationConfirmed).not.toHaveBeenCalled()
  })

  it('still confirms a capture that happened inside the hold when the webhook arrives after it expired', async () => {
    const { registration, payment } = await seed({ expiresAt: new Date(Date.now() - 60_000) })
    const result = await deliver(
      simulatePaymentOutcome(orderOf(payment), 'success', {
        eventId: `evt_${crypto.randomUUID()}`,
        providerPaymentId: 'pay_in_time',
        occurredAt: new Date(Date.now() - 2 * 60_000),
      }),
    )

    expect(result).toMatchObject({ ok: true, body: { ok: true, confirmed: true } })
    const after = await reload(registration.id, payment.id)
    expect(after.registration.status).toBe('CONFIRMED')
    expect(after.payment.exceptionReason).toBeNull()
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

  // The payment row has no column for the charge behind an exception, so the
  // log line is the only record of which charge to return.
  it('logs the payment id and amount of the charge behind every exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { payment } = await seed()
    await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { amount: 1, providerPaymentId: 'pay_odd' }))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('AMOUNT_MISMATCH for charge pay_odd (1 INR)'))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining(payment.providerOrderId))

    // A second bad charge while that exception is open changes no column, so
    // it must still be named in the log.
    await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { amount: 2, providerPaymentId: 'pay_odd_2' }))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('already has open exception AMOUNT_MISMATCH'))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('charge pay_odd_2 (2 INR)'))

    const paid = await seed()
    await deliver(simulatePaymentOutcome(orderOf(paid.payment), 'success', { providerPaymentId: 'pay_first' }))
    await deliver(simulatePaymentOutcome(orderOf(paid.payment), 'success', { providerPaymentId: 'pay_second' }))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('DUPLICATE_PAYMENT for charge pay_second (1499 INR)'))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('payment on file pay_first'))
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

describe('processPaymentWebhook — group/delegation registration', () => {
  it('confirms every seat in the group together on capture, and notifies only the head + already-joined members', async () => {
    const { headRegistration, joinedRegistration, placeholders, payment } = await seedGroup({ placeholderCount: 2 })

    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success', { providerPaymentId: 'pay_group_1' }))
    expect(result).toMatchObject({ ok: true, body: { ok: true, confirmed: true } })
    if (result.ok) await result.afterCommit

    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, (await reload(headRegistration.id, payment.id)).registration.registrationGroupId!))
    expect(rows.every((r) => r.status === 'CONFIRMED')).toBe(true)
    expect(rows).toHaveLength(4) // head + joined member + 2 placeholders

    const after = await reload(headRegistration.id, payment.id)
    expect(after.payment.status).toBe('PAID')

    // The head's own row and the already-claimed teammate get the
    // registration-confirmed hook; the two still-unclaimed placeholders do
    // not (they have nothing to email yet).
    expect(onRegistrationConfirmed).toHaveBeenCalledTimes(2)
    expect(onRegistrationConfirmed).toHaveBeenCalledWith(headRegistration.id)
    expect(onRegistrationConfirmed).toHaveBeenCalledWith(joinedRegistration.id)
    for (const placeholder of placeholders) {
      expect(onRegistrationConfirmed).not.toHaveBeenCalledWith(placeholder.id)
    }
  })

  it('cancels every seat in the group together on a failed payment', async () => {
    const { headRegistration, joinedRegistration, placeholders, payment } = await seedGroup({ placeholderCount: 2 })
    const groupId = (await reload(headRegistration.id, payment.id)).registration.registrationGroupId!

    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'failure'))
    expect(result).toMatchObject({ ok: true, body: { ok: true } })
    if (result.ok) await result.afterCommit

    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, groupId))
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true)

    expect(onPaymentFailed).toHaveBeenCalledTimes(2)
    expect(onPaymentFailed).toHaveBeenCalledWith(headRegistration.id)
    expect(onPaymentFailed).toHaveBeenCalledWith(joinedRegistration.id)
    for (const placeholder of placeholders) {
      expect(onPaymentFailed).not.toHaveBeenCalledWith(placeholder.id)
    }
  })

  it('releases every seat in the group together when the hold expired before the capture arrived', async () => {
    const { headRegistration, payment } = await seedGroup({
      placeholderCount: 2,
      registrationStatus: 'PAYMENT_PENDING',
    })
    const groupId = (await reload(headRegistration.id, payment.id)).registration.registrationGroupId!
    // Back-date every seat's hold so it's already expired at capture time.
    await db
      .update(registrations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(registrations.registrationGroupId, groupId))

    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success'))
    expect(result).toMatchObject({ ok: true, body: { ok: true, exception: true } })
    if (result.ok) await result.afterCommit

    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, groupId))
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true)
    expect((await reload(headRegistration.id, payment.id)).payment.exceptionReason).toBe('PAYMENT_AFTER_HOLD_EXPIRED')
    expect(onRegistrationConfirmed).not.toHaveBeenCalled()
  })

  it('only confirms seats that were still PAYMENT_PENDING, leaving an already-cancelled slot alone', async () => {
    const { headRegistration, joinedRegistration, placeholders, payment } = await seedGroup({ placeholderCount: 1 })
    const groupId = (await reload(headRegistration.id, payment.id)).registration.registrationGroupId!
    // One placeholder was released independently (e.g. by the expired-holds
    // sweep reaching it a moment earlier) before the capture arrives.
    await db.update(registrations).set({ status: 'CANCELLED' }).where(eq(registrations.id, placeholders[0].id))

    const result = await deliver(simulatePaymentOutcome(orderOf(payment), 'success'))
    expect(result).toMatchObject({ ok: true, body: { ok: true, confirmed: true } })
    if (result.ok) await result.afterCommit

    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, groupId))
    const byId = new Map(rows.map((r) => [r.id, r.status]))
    expect(byId.get(headRegistration.id)).toBe('CONFIRMED')
    expect(byId.get(joinedRegistration.id)).toBe('CONFIRMED')
    expect(byId.get(placeholders[0].id)).toBe('CANCELLED')
  })
})
