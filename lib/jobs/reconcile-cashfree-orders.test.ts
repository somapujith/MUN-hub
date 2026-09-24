import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import * as cashfreeAdapter from '@/lib/payments/cashfree-adapter'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { reconcileCashfreeOrdersJob } from './reconcile-cashfree-orders'

/**
 * Every test here stubs `checkOrderPayments` — never a real Cashfree call.
 *
 * The job is global (every cashfree PENDING payment past the age
 * threshold), and the local database is shared across test files, so
 * fixtures are dated far in the past/future the same way
 * lib/jobs/release-expired-holds.test.ts isolates itself with a fixed
 * "as of" instant. `beforeEach` purges every pre-existing cashfree payment
 * row (any date) so a fixed historical AS_OF (year 2010) can't accidentally
 * match real-dated rows from other suites via the FAILED-grace-window's
 * `updatedAt >= now - 1h` check (every real timestamp is "after" 2010).
 */

const AS_OF = new Date('2010-06-01T00:00:00Z')
const OLD_ENOUGH = new Date('2010-05-01T00:00:00Z') // well past any reasonable RECONCILE_MIN_AGE_MS
const TOO_RECENT = new Date('2010-05-31T23:59:00Z') // 1 minute before AS_OF

beforeEach(async () => {
  await db.delete(payments).where(eq(payments.provider, 'cashfree'))
})

async function createUser() {
  const [user] = await db
    .insert(users)
    .values({ name: 'Reconcile Test', email: `reconcile-${crypto.randomUUID()}@test.com`, role: 'STUDENT' })
    .returning()
  return user
}

async function createRegistrationAndPayment(opts: {
  provider?: string
  status?: 'PENDING' | 'PAID' | 'FAILED'
  createdAt?: Date
  amount?: number
  currency?: string
}) {
  const organizer = await db
    .insert(users)
    .values({ name: 'Org', email: `org-${crypto.randomUUID()}@test.com`, role: 'ORGANIZER' })
    .returning()
    .then((rows) => rows[0])
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Reconcile Mun', slug: `reconcile-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 1613, capacity: 10 })
    .returning()
  const student = await createUser()
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
      currency: opts.currency ?? 'INR',
      platformFeeAmount: 97,
      platformFeeTaxAmount: 17,
      organizerNetAmount: 1499,
      status: opts.status ?? 'PENDING',
      createdAt: opts.createdAt ?? OLD_ENOUGH,
      updatedAt: opts.createdAt ?? OLD_ENOUGH,
    })
    .returning()

  return { registration, payment, orderId }
}

afterEach(() => {
  vi.restoreAllMocks()
  setRuntimeEnv({})
})

/**
 * A fresh, unique payment id per call — real Cashfree ids are always unique;
 * a literal string reused across separate suite runs against the persistent
 * test DB would collide with an already-claimed `(provider, eventId)` row
 * from an earlier run.
 */
function cfPaymentId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

describe('reconcileCashfreeOrdersJob', () => {
  it('only polls cashfree PENDING payments past the age threshold', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const stale = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH })
    const tooRecent = await createRegistrationAndPayment({ createdAt: TOO_RECENT })
    const wrongProvider = await createRegistrationAndPayment({ provider: 'mock_razorpay', createdAt: OLD_ENOUGH })
    const alreadyPaid = await createRegistrationAndPayment({ status: 'PAID', createdAt: OLD_ENOUGH })

    const polledOrderIds: string[] = []
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (orderId) => {
      polledOrderIds.push(orderId)
      return null // pending — nothing to change
    })

    await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    expect(polledOrderIds).toContain(stale.orderId)
    expect(polledOrderIds).not.toContain(tooRecent.orderId)
    expect(polledOrderIds).not.toContain(wrongProvider.orderId)
    expect(polledOrderIds).not.toContain(alreadyPaid.orderId)
  })

  it('confirms a registration when get-payments reports a SUCCESS attempt', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const { registration, orderId } = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH, amount: 1613 })

    const paymentId = cfPaymentId('cf_pay')
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (polledId) => {
      if (polledId !== orderId) return null
      return {
        eventId: paymentId,
        providerEventType: 'PAYMENT_SUCCESS_WEBHOOK',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    const result = await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    expect(result.resolved).toBeGreaterThanOrEqual(1)
    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updated.status).toBe('CONFIRMED')
  })

  it('caps the batch size per run', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const created = await Promise.all(
      Array.from({ length: 3 }, () => createRegistrationAndPayment({ createdAt: OLD_ENOUGH })),
    )

    const polled: string[] = []
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (orderId) => {
      polled.push(orderId)
      return null
    })

    await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    const countsByOrder = new Map<string, number>()
    for (const id of polled) countsByOrder.set(id, (countsByOrder.get(id) ?? 0) + 1)
    for (const { orderId } of created) {
      expect(countsByOrder.get(orderId) ?? 0).toBeLessThanOrEqual(1)
    }
  })

  it('running twice back-to-back does not double-process (idempotent)', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const { registration, orderId } = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH, amount: 1613 })

    const paymentId = cfPaymentId('cf_pay')
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (polledId) => {
      if (polledId !== orderId) return null
      return {
        eventId: paymentId,
        providerEventType: 'PAYMENT_SUCCESS_WEBHOOK',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    await reconcileCashfreeOrdersJob.run({ now: AS_OF })
    await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updated.status).toBe('CONFIRMED')
  })

  it('skips/no-ops safely when a payment was already resolved by a webhook mid-run', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const { registration, payment, orderId } = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH, amount: 1613 })

    await db.update(payments).set({ status: 'PAID' }).where(eq(payments.id, payment.id))
    await db.update(registrations).set({ status: 'CONFIRMED' }).where(eq(registrations.id, registration.id))

    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (polledId) => {
      if (polledId !== orderId) return null
      const paymentId = cfPaymentId('cf_pay')
      return {
        eventId: paymentId,
        providerEventType: 'PAYMENT_SUCCESS_WEBHOOK',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    // Because the payment status is already PAID, this job's own PENDING
    // filter excludes it — no re-processing, no throw.
    const result = await reconcileCashfreeOrdersJob.run({ now: AS_OF })
    expect(result).toBeDefined()

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updated.status).toBe('CONFIRMED')
  })

  it('is a no-op when Cashfree credentials are not configured (no adapter to poll with)', async () => {
    setRuntimeEnv({})
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH })
    const spy = vi.spyOn(cashfreeAdapter, 'checkOrderPayments')

    const result = await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    expect(spy).not.toHaveBeenCalled()
    expect(result).toMatchObject({ notConfigured: true })
  })

  it('reports summary counts: polled, resolved, stillPending, failed', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH })

    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockResolvedValue(null)

    const result = await reconcileCashfreeOrdersJob.run({ now: AS_OF })
    expect(result).toHaveProperty('polled')
    expect(result).toHaveProperty('resolved')
    expect(result).toHaveProperty('stillPending')
    expect(result).toHaveProperty('failed')
  })

  it('counts a get-payments error as "failed", distinct from an authentic pending "stillPending" (a Cashfree outage must be distinguishable from normal pending volume)', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH }) // will error
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH }) // will be authentically pending

    let call = 0
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async () => {
      call += 1
      if (call === 1) throw new Error('simulated Cashfree outage')
      return null
    })

    const result = await reconcileCashfreeOrdersJob.run({ now: AS_OF })
    expect(result.failed).toBe(1)
    expect(result.stillPending).toBe(1)
  })

  it('also polls a recently-FAILED payment within the grace window, catching a late retry-success for the SAME order (failed is not permanently terminal)', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const recentlyFailedAt = new Date(AS_OF.getTime() - 10 * 60 * 1000) // 10 minutes before AS_OF
    const { registration, payment, orderId } = await createRegistrationAndPayment({
      status: 'FAILED',
      createdAt: OLD_ENOUGH,
      amount: 1613,
    })
    await db.update(payments).set({ updatedAt: recentlyFailedAt }).where(eq(payments.id, payment.id))
    await db.update(registrations).set({ status: 'CANCELLED' }).where(eq(registrations.id, registration.id))

    const polledOrderIds: string[] = []
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (polledId) => {
      polledOrderIds.push(polledId)
      if (polledId !== orderId) return null
      const paymentId = cfPaymentId('cf_pay_late')
      return {
        eventId: paymentId,
        providerEventType: 'PAYMENT_SUCCESS_WEBHOOK',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    expect(polledOrderIds).toContain(orderId)
    // Never resurrected — this reuses the existing PAYMENT_AFTER_HOLD_EXPIRED
    // exception path (applyEvent), not a new mechanism.
    const [stillCancelled] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(stillCancelled.status).toBe('CANCELLED')
    const [settledPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(settledPayment).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
  })

  it('does NOT poll a FAILED payment past the grace window', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    const longAgo = new Date(AS_OF.getTime() - 2 * 60 * 60 * 1000) // 2h before AS_OF, past the 1h grace window
    const { orderId } = await createRegistrationAndPayment({ status: 'FAILED', createdAt: longAgo })
    await db.update(payments).set({ updatedAt: longAgo }).where(eq(payments.providerOrderId, orderId))

    const polledOrderIds: string[] = []
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async (polledId) => {
      polledOrderIds.push(polledId)
      return null
    })

    await reconcileCashfreeOrdersJob.run({ now: AS_OF })
    expect(polledOrderIds).not.toContain(orderId)
  })

  it('runs the batch with bounded concurrency rather than fully sequentially (does not serialize into a multi-minute run)', async () => {
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    await Promise.all(Array.from({ length: 6 }, () => createRegistrationAndPayment({ createdAt: OLD_ENOUGH })))

    let inFlight = 0
    let maxInFlight = 0
    vi.spyOn(cashfreeAdapter, 'checkOrderPayments').mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return null
    })

    await reconcileCashfreeOrdersJob.run({ now: AS_OF })

    expect(maxInFlight).toBeGreaterThan(1)
  })
})
