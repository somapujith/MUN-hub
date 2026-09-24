import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, paymentWebhookEvents, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { setRuntimeEnv } from '@/lib/runtime-env'
import * as cashfreeAdapter from './cashfree-adapter'
import * as webhookModule from './webhook'
import {
  getPaymentTimeline,
  PAYMENT_RECONCILE_ERRORS,
  reconcilePaymentAsAdmin,
} from './admin-reconcile'

/**
 * Every test here stubs `checkOrderPayments` — never a real Cashfree call —
 * same discipline as lib/jobs/reconcile-cashfree-orders.test.ts, whose
 * per-order check this admin action reuses directly (not a copy of it).
 */

async function makeUser(role: 'STUDENT' | 'OPERATIONS' | 'ADMIN' | 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `admin-reconcile-${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

function sess(user: { id: string; role: Session['role'] }): Session {
  return { userId: user.id, role: user.role }
}

async function createRegistrationAndPayment(opts: {
  provider?: string
  status?: 'CREATED' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED'
  amount?: number
}) {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Admin Reconcile Mun', slug: `admin-reconcile-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 1613, capacity: 10 })
    .returning()
  const student = await makeUser('STUDENT')
  const [registration] = await db
    .insert(registrations)
    .values({
      userId: student.id,
      munId: mun.id,
      registrationProductId: product.id,
      status: 'PAYMENT_PENDING',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    .returning()

  const orderId = `mh_${crypto.randomUUID()}`
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      provider: opts.provider ?? 'cashfree',
      providerOrderId: orderId,
      amount: opts.amount ?? 1613,
      currency: 'INR',
      platformFeeAmount: 97,
      platformFeeTaxAmount: 17,
      organizerNetAmount: 1499,
      status: opts.status ?? 'PENDING',
    })
    .returning()

  return { registration, payment, orderId }
}

function cfPaymentId(): string {
  return `cf_pay_${crypto.randomUUID()}`
}

function capturedEvent(orderId: string, amount: number) {
  return {
    eventId: cfPaymentId(),
    providerEventType: 'PAYMENT_SUCCESS_WEBHOOK',
    type: 'payment.captured' as const,
    providerOrderId: orderId,
    providerPaymentId: cfPaymentId(),
    amount,
    currency: 'INR',
    occurredAt: new Date(),
    signedAt: null,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  setRuntimeEnv({})
})

describe('reconcilePaymentAsAdmin', () => {
  it('throws Forbidden for a STUDENT and for no session', async () => {
    const { payment } = await createRegistrationAndPayment({})
    const student = await makeUser('STUDENT')

    await expect(reconcilePaymentAsAdmin(payment.id, sess(student))).rejects.toThrow('Forbidden')
    await expect(reconcilePaymentAsAdmin(payment.id, null)).rejects.toThrow('Forbidden')
  })

  it('throws notFound for an unknown payment id', async () => {
    const admin = await makeUser('ADMIN')
    await expect(reconcilePaymentAsAdmin('does-not-exist', sess(admin))).rejects.toThrow(PAYMENT_RECONCILE_ERRORS.notFound)
  })

  it('throws unsupportedProvider for a non-cashfree payment', async () => {
    const admin = await makeUser('ADMIN')
    const { payment } = await createRegistrationAndPayment({ provider: 'mock_razorpay' })

    await expect(reconcilePaymentAsAdmin(payment.id, sess(admin))).rejects.toThrow(
      PAYMENT_RECONCILE_ERRORS.unsupportedProvider,
    )
  })

  it('throws alreadySettled for a PAID or REFUNDED payment, without calling Cashfree', async () => {
    const admin = await makeUser('ADMIN')
    const { payment: paid } = await createRegistrationAndPayment({ status: 'PAID' })
    const { payment: refunded } = await createRegistrationAndPayment({ status: 'REFUNDED' })
    const spy = vi.spyOn(cashfreeAdapter, 'checkOrderPayments')

    await expect(reconcilePaymentAsAdmin(paid.id, sess(admin))).rejects.toThrow(PAYMENT_RECONCILE_ERRORS.alreadySettled)
    await expect(reconcilePaymentAsAdmin(refunded.id, sess(admin))).rejects.toThrow(PAYMENT_RECONCILE_ERRORS.alreadySettled)
    expect(spy).not.toHaveBeenCalled()
  })

  it('throws notConfigured when Cashfree credentials are absent', async () => {
    setRuntimeEnv({})
    const admin = await makeUser('ADMIN')
    const { payment } = await createRegistrationAndPayment({})

    await expect(reconcilePaymentAsAdmin(payment.id, sess(admin))).rejects.toThrow(PAYMENT_RECONCILE_ERRORS.notConfigured)
  })

  it('reuses the job\'s per-order checkOrderPayments call — polls the payment\'s own providerOrderId', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const admin = await makeUser('ADMIN')
    const { payment, orderId } = await createRegistrationAndPayment({})

    const spy = vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockResolvedValue(null)

    await reconcilePaymentAsAdmin(payment.id, sess(admin))

    expect(spy).toHaveBeenCalledWith(orderId, expect.objectContaining({ clientId: 'id', clientSecret: 'secret' }))
  })

  it('reports no_decisive_attempt and leaves the payment untouched when Cashfree has nothing decisive yet', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const admin = await makeUser('ADMIN')
    const { payment } = await createRegistrationAndPayment({})
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockResolvedValue(null)

    const result = await reconcilePaymentAsAdmin(payment.id, sess(admin))

    expect(result).toMatchObject({
      paymentId: payment.id,
      statusBefore: 'PENDING',
      statusAfter: 'PENDING',
      outcome: 'no_decisive_attempt',
    })
  })

  it('delegates settlement to processNormalizedPaymentEvent — the exact same call the webhook route and the cron job use — rather than writing to payments/registrations itself', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const admin = await makeUser('ADMIN')
    const { registration, payment, orderId } = await createRegistrationAndPayment({ amount: 1613 })
    const event = capturedEvent(orderId, 1613)
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockResolvedValue(event)
    const processSpy = vi.spyOn(webhookModule, 'processNormalizedPaymentEvent')

    const result = await reconcilePaymentAsAdmin(payment.id, sess(admin))

    // Proof of delegation, not duplication: the same shared settlement
    // function was called with the exact normalized event checkOrderPayments
    // produced, for the same provider this file never re-derives its own copy of.
    expect(processSpy).toHaveBeenCalledWith('cashfree', event, expect.any(String), expect.any(Date))
    expect(result.outcome).toBe('confirmed')
    expect(result.statusAfter).toBe('PAID')

    // Behavioral proof, not just a spy: the real settlement transaction ran —
    // the registration is genuinely CONFIRMED, not just reported as such.
    const [updatedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updatedRegistration.status).toBe('CONFIRMED')
    const [updatedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(updatedPayment.status).toBe('PAID')
  })

  it('records one admin_actions row per trigger regardless of outcome', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const admin = await makeUser('ADMIN')
    const { payment } = await createRegistrationAndPayment({})
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockResolvedValue(null)

    await reconcilePaymentAsAdmin(payment.id, sess(admin))

    const rows = await db.query.adminActions.findMany({
      where: (adminActions, { eq: eqOp, and: andOp }) =>
        andOp(eqOp(adminActions.targetId, payment.id), eqOp(adminActions.action, 'PAYMENT_RECONCILE_TRIGGERED')),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].actorId).toBe(admin.id)
  })

  it('running the settlement twice back-to-back is idempotent, the same guarantee the webhook path itself provides', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const admin = await makeUser('ADMIN')
    const { registration, payment, orderId } = await createRegistrationAndPayment({ amount: 1613 })
    const event = capturedEvent(orderId, 1613)
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockResolvedValue(event)

    const first = await reconcilePaymentAsAdmin(payment.id, sess(admin))
    expect(first.outcome).toBe('confirmed')

    // Second call: payment status is now PAID, so the eligibility guard
    // itself refuses it (mirrors the cron job's own PENDING-only filter) —
    // this is the "already settled, nothing to reconcile" path, not a
    // duplicate-processing path, since a settled payment is no longer
    // RECONCILABLE_STATUSES-eligible.
    await expect(reconcilePaymentAsAdmin(payment.id, sess(admin))).rejects.toThrow(
      PAYMENT_RECONCILE_ERRORS.alreadySettled,
    )

    const [updatedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updatedRegistration.status).toBe('CONFIRMED')
  })
})

describe('getPaymentTimeline', () => {
  it('throws Forbidden for a STUDENT and for no session', async () => {
    const { payment } = await createRegistrationAndPayment({})
    const student = await makeUser('STUDENT')

    await expect(getPaymentTimeline(payment.id, sess(student))).rejects.toThrow('Forbidden')
    await expect(getPaymentTimeline(payment.id, null)).rejects.toThrow('Forbidden')
  })

  it('throws notFound for an unknown payment id', async () => {
    const admin = await makeUser('ADMIN')
    await expect(getPaymentTimeline('does-not-exist', sess(admin))).rejects.toThrow(PAYMENT_RECONCILE_ERRORS.notFound)
  })

  it('returns this payment\'s events in chronological (oldest-first) order, excluding other payments\' events', async () => {
    const admin = await makeUser('OPERATIONS')
    const { payment, orderId } = await createRegistrationAndPayment({})
    const { orderId: otherOrderId } = await createRegistrationAndPayment({})

    const older = new Date('2026-01-01T00:00:00Z')
    const newer = new Date('2026-01-02T00:00:00Z')

    await db.insert(paymentWebhookEvents).values([
      {
        provider: 'cashfree',
        eventId: crypto.randomUUID(),
        eventType: 'PAYMENT_FAILED_WEBHOOK',
        providerOrderId: orderId,
        payloadSha256: 'sha-1',
        outcome: 'FAILED',
        receivedAt: newer,
        processedAt: newer,
      },
      {
        provider: 'cashfree',
        eventId: crypto.randomUUID(),
        eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        providerOrderId: orderId,
        payloadSha256: 'sha-2',
        outcome: 'CONFIRMED',
        receivedAt: older,
        processedAt: older,
      },
      // A different payment's event — must never leak into this timeline.
      {
        provider: 'cashfree',
        eventId: crypto.randomUUID(),
        eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        providerOrderId: otherOrderId,
        payloadSha256: 'sha-3',
        outcome: 'CONFIRMED',
        receivedAt: older,
        processedAt: older,
      },
    ])

    const timeline = await getPaymentTimeline(payment.id, sess(admin))

    expect(timeline.paymentId).toBe(payment.id)
    expect(timeline.providerOrderId).toBe(orderId)
    expect(timeline.events).toHaveLength(2)
    expect(timeline.events.map((e) => e.outcome)).toEqual(['CONFIRMED', 'FAILED'])
    expect(timeline.events[0].receivedAt.getTime()).toBeLessThan(timeline.events[1].receivedAt.getTime())
  })

  it('returns an empty events list for a payment with no recorded webhook/reconcile events', async () => {
    const admin = await makeUser('ADMIN')
    const { payment } = await createRegistrationAndPayment({})

    const timeline = await getPaymentTimeline(payment.id, sess(admin))
    expect(timeline.events).toEqual([])
  })
})
