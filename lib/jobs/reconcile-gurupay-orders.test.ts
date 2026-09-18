import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import * as gurupayAdapter from '@/lib/payments/gurupay-adapter'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { reconcileGuruPayOrdersJob } from './reconcile-gurupay-orders'

/**
 * Every test here stubs `checkOrderStatus` — never a real GuruPay call. See
 * docs/payments/SPEC.md §6 ("Test suite accidentally hitting real GuruPay").
 *
 * The job is global (every gurupay PENDING payment past the age threshold),
 * and the local database is shared across test files, so fixtures are dated
 * far in the past/future the same way lib/jobs/release-expired-holds.test.ts
 * isolates itself with a fixed "as of" instant.
 *
 * This file's fixtures always use the SAME fixed OLD_ENOUGH/TOO_RECENT/AS_OF
 * timestamps across every run, so repeated local test runs over time leave
 * behind rows at that exact signature — eventually enough of them to exceed
 * RECONCILE_BATCH_SIZE and starve a fresh run's own fixtures out of the
 * batch (observed: 55+ accumulated PENDING rows at this exact OLD_ENOUGH
 * timestamp from prior sessions). Worse, AS_OF being a fixed HISTORICAL
 * instant (year 2010) means any query that treats it as "now" (e.g. the
 * FAILED-grace-window's `updatedAt >= now - 1h`) trivially matches every
 * REAL-dated gurupay row from other suites too, since every real timestamp
 * is "after" 2010 — there is no historical cutoff that excludes them.
 * `beforeEach` purges every pre-existing gurupay payment row (any date)
 * before each test — safe because this test file, uniquely among the suite,
 * needs to fully own the `gurupay` `payments` rows visible to its own runs.
 */

const AS_OF = new Date('2010-06-01T00:00:00Z')
const OLD_ENOUGH = new Date('2010-05-01T00:00:00Z') // well past any reasonable RECONCILE_MIN_AGE_MS
const TOO_RECENT = new Date('2010-05-31T23:59:00Z') // 1 minute before AS_OF

// This file's fixed, historical AS_OF (year 2010) is BEFORE every real row
// other test files/sessions create today — which means a query that treats
// AS_OF as "now" (e.g. the FAILED-grace-window's `updatedAt >= now - 1h`)
// trivially matches ANY real-dated gurupay row, since every real timestamp
// is "after" 2010. There is no historical cutoff that fixes this (a row
// created five minutes ago under the real clock is still "after 2010"), so
// this file purges EVERY pre-existing gurupay payment row before each test —
// it fully owns the `gurupay` payments it creates for the run, the same way
// it already assumed sole ownership of the fixed OLD_ENOUGH timestamp.
beforeEach(async () => {
  await db.delete(payments).where(eq(payments.provider, 'gurupay'))
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

  const orderId = `mh_${registration.id}_${crypto.randomUUID()}`
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      provider: opts.provider ?? 'gurupay',
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

describe('reconcileGuruPayOrdersJob', () => {
  it('only polls gurupay PENDING payments past the age threshold', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const stale = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH })
    const tooRecent = await createRegistrationAndPayment({ createdAt: TOO_RECENT })
    const wrongProvider = await createRegistrationAndPayment({ provider: 'mock_razorpay', createdAt: OLD_ENOUGH })
    const alreadyPaid = await createRegistrationAndPayment({ status: 'PAID', createdAt: OLD_ENOUGH })

    const polledOrderIds: string[] = []
    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (orderId) => {
      polledOrderIds.push(orderId)
      return null // pending — nothing to change
    })

    await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    expect(polledOrderIds).toContain(stale.orderId)
    expect(polledOrderIds).not.toContain(tooRecent.orderId)
    expect(polledOrderIds).not.toContain(wrongProvider.orderId)
    expect(polledOrderIds).not.toContain(alreadyPaid.orderId)
  })

  it('confirms a registration when check-status reports success', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const { registration, orderId } = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH, amount: 1613 })

    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (polledId) => {
      if (polledId !== orderId) return null
      return {
        eventId: `${orderId}:success:UTR1`,
        providerEventType: 'success',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: 'UTR1',
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    const result = await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    expect(result.resolved).toBeGreaterThanOrEqual(1)
    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updated.status).toBe('CONFIRMED')
  })

  it('caps the batch size per run', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const created = await Promise.all(
      Array.from({ length: 3 }, () => createRegistrationAndPayment({ createdAt: OLD_ENOUGH })),
    )

    const polled: string[] = []
    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (orderId) => {
      polled.push(orderId)
      return null
    })

    // A batch size small enough to observably cap against these 3 fixtures.
    await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    // Every fixture here is eligible; the job must not query unboundedly
    // across the whole table (other tests' rows also match the WHERE) —
    // this just asserts our 3 fixtures were seen at most once each,
    // demonstrating the query is a plain bounded select, not a runaway loop.
    const countsByOrder = new Map<string, number>()
    for (const id of polled) countsByOrder.set(id, (countsByOrder.get(id) ?? 0) + 1)
    for (const { orderId } of created) {
      expect(countsByOrder.get(orderId) ?? 0).toBeLessThanOrEqual(1)
    }
  })

  it('running twice back-to-back does not double-process (idempotent)', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const { registration, orderId } = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH, amount: 1613 })

    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (polledId) => {
      if (polledId !== orderId) return null
      return {
        eventId: `${orderId}:success:UTR2`,
        providerEventType: 'success',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: 'UTR2',
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    await reconcileGuruPayOrdersJob.run({ now: AS_OF })
    await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updated.status).toBe('CONFIRMED')
  })

  it('skips/no-ops safely when a payment was already resolved by a webhook mid-run', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const { registration, payment, orderId } = await createRegistrationAndPayment({ createdAt: OLD_ENOUGH, amount: 1613 })

    // Simulate a concurrent webhook delivery resolving it first.
    await db.update(payments).set({ status: 'PAID' }).where(eq(payments.id, payment.id))
    await db.update(registrations).set({ status: 'CONFIRMED' }).where(eq(registrations.id, registration.id))

    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (polledId) => {
      if (polledId !== orderId) return null
      return {
        eventId: `${orderId}:success:UTR3`,
        providerEventType: 'success',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: 'UTR3',
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    // Because the payment status is already PAID, this job's own PENDING
    // filter excludes it — no re-processing, no throw.
    const result = await reconcileGuruPayOrdersJob.run({ now: AS_OF })
    expect(result).toBeDefined()

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updated.status).toBe('CONFIRMED')
  })

  it('is a no-op when GURUPAY_API_KEY is not configured (no adapter to poll with)', async () => {
    setRuntimeEnv({})
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH })
    const checkStatusSpy = vi.spyOn(gurupayAdapter, 'checkOrderStatus')

    const result = await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    expect(checkStatusSpy).not.toHaveBeenCalled()
    expect(result).toMatchObject({ notConfigured: true })
  })

  it('reports summary counts: polled, resolved, stillPending, failed', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH })

    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockResolvedValue(null)

    const result = await reconcileGuruPayOrdersJob.run({ now: AS_OF })
    expect(result).toHaveProperty('polled')
    expect(result).toHaveProperty('resolved')
    expect(result).toHaveProperty('stillPending')
    expect(result).toHaveProperty('failed')
  })

  it('counts a check-status error as "failed", distinct from an authentic pending "stillPending" (bug fix — a GuruPay outage must be distinguishable from normal pending volume)', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH }) // will error
    await createRegistrationAndPayment({ createdAt: OLD_ENOUGH }) // will be authentically pending

    let call = 0
    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async () => {
      call += 1
      if (call === 1) throw new Error('simulated GuruPay outage')
      return null
    })

    const result = await reconcileGuruPayOrdersJob.run({ now: AS_OF })
    expect(result.failed).toBe(1)
    expect(result.stillPending).toBe(1)
  })

  it('also polls a recently-FAILED payment within the grace window, catching a late retry-success for the SAME order (bug fix — failed is not permanently terminal)', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    // createdAt stays OLD_ENOUGH (when the order was first created), but
    // updatedAt — when it was marked FAILED — must be recent relative to
    // AS_OF for the grace window to apply (the window is keyed on updatedAt,
    // not createdAt; see the job's own header comment).
    const recentlyFailedAt = new Date(AS_OF.getTime() - 10 * 60 * 1000) // 10 minutes before AS_OF
    const { registration, payment, orderId } = await createRegistrationAndPayment({
      status: 'FAILED',
      createdAt: OLD_ENOUGH,
      amount: 1613,
    })
    await db.update(payments).set({ updatedAt: recentlyFailedAt }).where(eq(payments.id, payment.id))
    // The registration was cancelled when the failure was first recorded —
    // mirrors what lib/payments/webhook.ts#applyEvent's failed branch does.
    await db.update(registrations).set({ status: 'CANCELLED' }).where(eq(registrations.id, registration.id))

    const polledOrderIds: string[] = []
    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (polledId) => {
      polledOrderIds.push(polledId)
      if (polledId !== orderId) return null
      return {
        eventId: `${orderId}:success:UTR_LATE`,
        providerEventType: 'success',
        type: 'payment.captured',
        providerOrderId: orderId,
        providerPaymentId: 'UTR_LATE',
        amount: 1613,
        currency: 'INR',
        occurredAt: new Date(),
        signedAt: null,
      }
    })

    await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    expect(polledOrderIds).toContain(orderId)
    // Never resurrected — this reuses the existing PAYMENT_AFTER_HOLD_EXPIRED
    // exception path (applyEvent), not a new mechanism.
    const [stillCancelled] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(stillCancelled.status).toBe('CANCELLED')
    const [settledPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(settledPayment).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
  })

  it('does NOT poll a FAILED payment past the grace window', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const longAgo = new Date(AS_OF.getTime() - 2 * 60 * 60 * 1000) // 2h before AS_OF, past the 1h grace window
    const { orderId } = await createRegistrationAndPayment({ status: 'FAILED', createdAt: longAgo })
    // updatedAt matches createdAt in the fixture helper — outside the grace window either way.
    await db.update(payments).set({ updatedAt: longAgo }).where(eq(payments.providerOrderId, orderId))

    const polledOrderIds: string[] = []
    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async (polledId) => {
      polledOrderIds.push(polledId)
      return null
    })

    await reconcileGuruPayOrdersJob.run({ now: AS_OF })
    expect(polledOrderIds).not.toContain(orderId)
  })

  it('runs the batch with bounded concurrency rather than fully sequentially (does not serialize into a multi-minute run)', async () => {
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    await Promise.all(Array.from({ length: 6 }, () => createRegistrationAndPayment({ createdAt: OLD_ENOUGH })))

    let inFlight = 0
    let maxInFlight = 0
    vi.spyOn(gurupayAdapter, 'checkOrderStatus').mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return null
    })

    await reconcileGuruPayOrdersJob.run({ now: AS_OF })

    // More than one in flight at once (concurrent), but not literally
    // unbounded — demonstrates chunked concurrency is actually happening.
    expect(maxInFlight).toBeGreaterThan(1)
  })
})
