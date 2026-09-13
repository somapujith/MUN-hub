import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  adminActions,
  muns,
  payments,
  refundRequests,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { approveRefund, listRefundRequests, rejectRefund, requestRefund } from './refund'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

async function seedPaidRegistration() {
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Org', email: `o-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [student] = await db
    .insert(users)
    .values({ name: 'Student', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  const [otherStudent] = await db
    .insert(users)
    .values({ name: 'Other Student', email: `s2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  const [admin] = await db
    .insert(users)
    .values({ name: 'Admin', email: `admin-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Refund Mun', slug: `refund-mun-${crypto.randomUUID()}` })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 50000, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
    .returning()
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      providerPaymentId: `pay-${crypto.randomUUID()}`,
      amount: 50000,
      status: 'PAID',
    })
    .returning()
  return { student, otherStudent, admin, registration, payment }
}

/** Same shape as seedPaidRegistration, but the payment never actually paid. */
async function seedUnpaidRegistration() {
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Org', email: `o-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [student] = await db
    .insert(users)
    .values({ name: 'Student', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  const [admin] = await db
    .insert(users)
    .values({ name: 'Admin', email: `admin-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Refund Mun', slug: `refund-mun-${crypto.randomUUID()}` })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 50000, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CANCELLED' })
    .returning()
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      providerPaymentId: `pay-${crypto.randomUUID()}`,
      amount: 50000,
      status: 'FAILED',
    })
    .returning()
  return { student, admin, registration, payment }
}

describe('requestRefund', () => {
  it('creates a REQUESTED refund_requests row', async () => {
    const { student, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const req = await requestRefund(registration.id, 'conference cancelled')
    expect(req.status).toBe('REQUESTED')
    expect(req.paymentId).toBe(payment.id)
    expect(req.amount).toBe(50000)
  })

  it('throws Forbidden if the caller does not own the registration', async () => {
    const { otherStudent, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: otherStudent.id, role: 'STUDENT' })

    await expect(requestRefund(registration.id, 'not mine')).rejects.toThrow('Forbidden')
  })

  it('allows an admin to request a refund on a student registration', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })

    const req = await requestRefund(registration.id, 'goodwill refund')
    expect(req.status).toBe('REQUESTED')
    expect(req.paymentId).toBe(payment.id)
  })

  it('throws for an unauthenticated caller', async () => {
    const { registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(requestRefund(registration.id, 'x')).rejects.toThrow('Forbidden')
  })

  // Regression test for red-team CRITICAL #1 (request-time half of the fix):
  // a second requestRefund call against the same payment while a REQUESTED
  // request is still active must be rejected outright, not silently create a
  // second refund_requests row for an admin to approve twice.
  it('rejects a second request while one is already REQUESTED for the same payment', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    await requestRefund(registration.id, 'first request')

    await expect(requestRefund(registration.id, 'second request')).rejects.toThrow(
      'A refund request is already pending for this payment',
    )
  })

  it('allows a new request once the prior one was rejected', async () => {
    const { student, admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const first = await requestRefund(registration.id, 'first request')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await rejectRefund(first.id, 'not eligible')

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const second = await requestRefund(registration.id, 'trying again')
    expect(second.status).toBe('REQUESTED')
  })

  it('throws if reason exceeds the max length', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    await expect(requestRefund(registration.id, 'x'.repeat(1001))).rejects.toThrow(
      'Reason must be 1000 characters or fewer',
    )
  })
})

describe('approveRefund', () => {
  it('transitions REQUESTED -> REFUNDED, updates registration and payment status, logs REFUND_APPROVED', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'conference cancelled')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const approved = await approveRefund(req.id)
    expect(approved.status).toBe('REFUNDED')
    expect(approved.providerRefundId).toBeTruthy()

    const [updatedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updatedRegistration.status).toBe('REFUNDED')

    const [updatedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(updatedPayment.status).toBe('REFUNDED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, req.id))
    expect(log.action).toBe('REFUND_APPROVED')
  })

  it('throws Forbidden for a student session', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    await expect(approveRefund(req.id)).rejects.toThrow('Forbidden')
  })

  it('throws for a refund request that is not REQUESTED', async () => {
    const { student, admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await approveRefund(req.id)

    await expect(approveRefund(req.id)).rejects.toThrow(`Invalid transition from REFUNDED to REFUNDED`)
  })

  it('two concurrent approvals on the same request serialize (row lock, only one REFUNDED)', async () => {
    const { student, admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const [r1, r2] = await Promise.allSettled([approveRefund(req.id), approveRefund(req.id)])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
  })

  // Regression test for red-team CRITICAL #1: proven exploit was 3 separate
  // refund_requests rows against ONE payment, each approved, triggering 3
  // real provider refund calls (150000 refunded on a 50000 payment). The
  // request-time guard in requestRefund normally prevents a 2nd/3rd row from
  // ever being created, so to prove the approve-time guard (the one that
  // actually closes the exploit) independently, this test bypasses
  // requestRefund and inserts the sibling rows directly — simulating two
  // requests that slipped through a race at request-time, or were created
  // before this fix shipped. Only the first approval must succeed; the
  // second must be rejected by the `payment.status !== 'PAID'` check, and
  // the provider adapter must be called exactly once.
  it('blocks approving a second refund_requests row against an already-refunded payment', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const reqA = await requestRefund(registration.id, 'first request')

    // Simulate a second REQUESTED row against the SAME payment (e.g. a race
    // at request-time) by inserting it directly, bypassing requestRefund's
    // own duplicate check.
    const [reqB] = await db
      .insert(refundRequests)
      .values({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: student.id,
        reason: 'second request (simulated race)',
        amount: payment.amount,
      })
      .returning()

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const approvedA = await approveRefund(reqA.id)
    expect(approvedA.status).toBe('REFUNDED')

    await expect(approveRefund(reqB.id)).rejects.toThrow('Cannot refund a payment with status REFUNDED')

    // The exploit was N real provider calls for N approvals on one payment —
    // assert the adapter was only ever invoked once.
    expect(refundSpy).toHaveBeenCalledTimes(1)

    const [finalPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(finalPayment.status).toBe('REFUNDED')
    expect(finalPayment.amount).toBe(50000) // never doubled/tripled

    const [untouchedReqB] = await db.select().from(refundRequests).where(eq(refundRequests.id, reqB.id))
    expect(untouchedReqB.status).toBe('REQUESTED') // rejected attempt leaves it as-is

    refundSpy.mockRestore()
  })

  // Regression test for red-team CRITICAL #2: a payment that was never PAID
  // (FAILED here) must never be refundable, and the registration must never
  // be force-set to REFUNDED from an unrelated status as a side effect.
  it('rejects approving a refund against a payment that is not PAID', async () => {
    const { student, admin, registration, payment } = await seedUnpaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'refund a failed payment')

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(approveRefund(req.id)).rejects.toThrow('Cannot refund a payment with status FAILED')

    // The provider must never be called for an unpaid payment.
    expect(refundSpy).not.toHaveBeenCalled()

    const [untouchedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(untouchedRegistration.status).toBe('CANCELLED') // unchanged, not force-flipped to REFUNDED

    const [untouchedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(untouchedPayment.status).toBe('FAILED')

    refundSpy.mockRestore()
  })

  // Regression test for red-team HIGH #3: the payment.status precondition
  // must be checked BEFORE the provider adapter is ever called, so a
  // rejected approval never reaches the point of moving money. Asserts call
  // ordering directly rather than just the end state.
  it('never calls the payments adapter before all validation has passed', async () => {
    const { student, admin, registration } = await seedUnpaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'refund a failed payment')

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(approveRefund(req.id)).rejects.toThrow()

    expect(refundSpy).not.toHaveBeenCalled()
    refundSpy.mockRestore()
  })
})

describe('rejectRefund', () => {
  it('transitions REQUESTED -> REJECTED, logs REFUND_REJECTED, does not touch registration/payment', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const rejected = await rejectRefund(req.id, 'not eligible')
    expect(rejected.status).toBe('REJECTED')

    const [reg] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(reg.status).toBe('CONFIRMED')

    const [pay] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(pay.status).toBe('PAID')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, req.id))
    expect(log.action).toBe('REFUND_REJECTED')
    expect(log.reason).toBe('not eligible')
  })

  it('throws Forbidden for a student session', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    await expect(rejectRefund(req.id, 'no')).rejects.toThrow('Forbidden')
  })

  it('throws if reason exceeds the max length', async () => {
    const { student, admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(rejectRefund(req.id, 'x'.repeat(1001))).rejects.toThrow(
      'Reason must be 1000 characters or fewer',
    )
  })
})

// Regression test for red-team MEDIUM #4: listRefundRequests must never be
// an unbounded SELECT * — assert it respects a hard cap even when more
// REQUESTED rows exist than the cap.
describe('listRefundRequests', () => {
  it('caps results at 100 even when more than 100 REQUESTED rows exist', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()

    // Seed 101 REQUESTED rows directly against one registration/payment (this
    // violates the one-active-request invariant requestRefund enforces, but
    // that's fine here — the point is to prove listRefundRequests' own query
    // has a hard limit, independent of how the rows got there).
    await db.insert(refundRequests).values(
      Array.from({ length: 101 }, (_, i) => ({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: admin.id,
        reason: `bulk request ${i}`,
        amount: payment.amount,
      })),
    )

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const results = await listRefundRequests()
    expect(results.length).toBe(100)
  })

  it('throws Forbidden for a student session', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'irrelevant', role: 'STUDENT' })
    await expect(listRefundRequests()).rejects.toThrow('Forbidden')
  })
})
