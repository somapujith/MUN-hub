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
import { approveRefund, cancelRefundRequest, listRefundRequests, rejectRefund, requestRefund } from './refund'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'
import * as auditLog from '@/lib/audit/log'

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

/** Second registration/payment/product for cross-registration (NEW-1) tests. */
async function seedSecondPaidRegistration(overrides?: { munId?: string }) {
  const [student] = await db
    .insert(users)
    .values({ name: 'Student B', email: `sb-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  let munId = overrides?.munId
  if (!munId) {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org B', email: `ob-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Refund Mun B', slug: `refund-mun-b-${crypto.randomUUID()}` })
      .returning()
    munId = mun.id
  }
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId, name: 'Delegate', price: 75000, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId: student.id, munId, registrationProductId: product.id, status: 'CONFIRMED' })
    .returning()
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      providerPaymentId: `pay-${crypto.randomUUID()}`,
      amount: 75000,
      status: 'PAID',
    })
    .returning()
  return { student, registration, payment }
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

  // NEW-3 design choice (round 2): admin-filed refunds were dropped entirely
  // rather than kept alongside a cancel path — see the doc comment on
  // requestRefund. An admin session must be treated the same as any other
  // non-owner.
  it('throws Forbidden if an admin tries to request a refund on someone else\'s registration', async () => {
    const { admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })

    await expect(requestRefund(registration.id, 'goodwill refund')).rejects.toThrow('Forbidden')
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

  // Regression test for red-team NEW-4: a payment that's already REFUNDED
  // (nothing left to refund) or otherwise not PAID must never accept a new
  // refund request in the first place — closes off queue junk before it can
  // accumulate.
  it('rejects a request against a payment that is not PAID', async () => {
    const { student, registration } = await seedUnpaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    await expect(requestRefund(registration.id, 'x')).rejects.toThrow(
      'Cannot request a refund for a payment with status FAILED',
    )
  })
})

describe('cancelRefundRequest', () => {
  it('lets the requester cancel their own REQUESTED request', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'changed my mind')

    const cancelled = await cancelRefundRequest(req.id)
    expect(cancelled.status).toBe('REJECTED')
  })

  it('throws Forbidden if a different user tries to cancel', async () => {
    const { student, otherStudent, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: otherStudent.id, role: 'STUDENT' })
    await expect(cancelRefundRequest(req.id)).rejects.toThrow('Forbidden')
  })

  it('unblocks a new request once the stuck request is cancelled', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const first = await requestRefund(registration.id, 'first')
    await cancelRefundRequest(first.id)

    const second = await requestRefund(registration.id, 'second')
    expect(second.status).toBe('REQUESTED')
  })
})

describe('approveRefund', () => {
  it('transitions REQUESTED -> PROCESSING -> REFUNDED, updates registration and payment status, logs REFUND_APPROVED', async () => {
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

  // Regression test: proven exploit was 3 separate refund_requests rows
  // against ONE payment, each approved, triggering 3 real provider refund
  // calls (150000 refunded on a 50000 payment). The request-time guard in
  // requestRefund normally prevents a 2nd/3rd row from ever being created,
  // so to prove the approve-time guard independently, this test bypasses
  // requestRefund and inserts the sibling row directly — simulating a
  // request that slipped through a race at request-time. Only the first
  // approval must succeed; the second must be rejected once the payment is
  // no longer PAID, and the provider adapter must be called exactly once.
  it('blocks approving a second refund_requests row against an already-refunded payment', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const reqA = await requestRefund(registration.id, 'first request')

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

    expect(refundSpy).toHaveBeenCalledTimes(1)

    const [finalPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(finalPayment.status).toBe('REFUNDED')
    expect(finalPayment.amount).toBe(50000) // never doubled/tripled

    const [untouchedReqB] = await db.select().from(refundRequests).where(eq(refundRequests.id, reqB.id))
    expect(untouchedReqB.status).toBe('REQUESTED') // rejected attempt leaves it as-is

    refundSpy.mockRestore()
  })

  it('rejects approving a refund against a payment that is not PAID', async () => {
    // requestRefund itself now refuses to create a request against a non-PAID
    // payment (NEW-4), so simulate a request that predates that guard (or a
    // payment that failed after the request was filed) by inserting the
    // refund_requests row directly against seedUnpaidRegistration's payment.
    const { student, admin, registration, payment } = await seedUnpaidRegistration()
    const [req] = await db
      .insert(refundRequests)
      .values({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: student.id,
        reason: 'refund a failed payment',
        amount: payment.amount,
      })
      .returning()

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(approveRefund(req.id)).rejects.toThrow('Cannot refund a payment with status FAILED')

    expect(refundSpy).not.toHaveBeenCalled()

    const [untouchedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(untouchedRegistration.status).toBe('CANCELLED') // unchanged, not force-flipped to REFUNDED

    const [untouchedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(untouchedPayment.status).toBe('FAILED')

    const [untouchedRequest] = await db.select().from(refundRequests).where(eq(refundRequests.id, req.id))
    expect(untouchedRequest.status).toBe('REQUESTED') // never advanced to PROCESSING

    refundSpy.mockRestore()
  })

  it('never calls the payments adapter before all phase-1 validation has passed', async () => {
    const { student, admin, registration, payment } = await seedUnpaidRegistration()
    const [req] = await db
      .insert(refundRequests)
      .values({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: student.id,
        reason: 'refund a failed payment',
        amount: payment.amount,
      })
      .returning()

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(approveRefund(req.id)).rejects.toThrow()

    expect(refundSpy).not.toHaveBeenCalled()
    refundSpy.mockRestore()
  })

  // Regression test for NEW-1 (cross-registration refund): a refund_requests
  // row whose paymentId doesn't actually belong to its registrationId must
  // never be approved — this simulates data that has drifted apart (or an
  // attempted tamper) by inserting a row that points registrationId at one
  // registration but paymentId at a completely different one's payment.
  it('rejects approving a request whose payment does not belong to its registration', async () => {
    const { student: studentA, registration: registrationA } = await seedPaidRegistration()
    const { payment: paymentB } = await seedSecondPaidRegistration()

    const [mismatchedRequest] = await db
      .insert(refundRequests)
      .values({
        registrationId: registrationA.id,
        paymentId: paymentB.id, // belongs to a different registration entirely
        requestedBy: studentA.id,
        reason: 'mismatched row',
        amount: paymentB.amount,
      })
      .returning()

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: 'irrelevant-admin', role: 'ADMIN' })
    // requireRole only checks role membership, not that the id exists, so
    // this reaches the NEW-1 check without needing a real admin row.
    await expect(approveRefund(mismatchedRequest.id)).rejects.toThrow(
      'Refund request payment does not match registration',
    )

    expect(refundSpy).not.toHaveBeenCalled()
    refundSpy.mockRestore()
  })

  // Regression test for NEW-2 (amount tampering): if request.amount has
  // drifted from the payment's actual current amount, approval must be
  // rejected rather than refunding whatever amount is sitting on the
  // (potentially stale/tampered) request row.
  it('rejects approving a request whose amount does not match the payment', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    const [tamperedRequest] = await db
      .insert(refundRequests)
      .values({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: student.id,
        reason: 'tampered amount',
        amount: payment.amount * 3, // does not match payment.amount (50000)
      })
      .returning()

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(approveRefund(tamperedRequest.id)).rejects.toThrow(
      'Refund amount does not match payment amount',
    )

    expect(refundSpy).not.toHaveBeenCalled()

    const [untouchedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(untouchedPayment.status).toBe('PAID') // never touched

    refundSpy.mockRestore()
  })

  // --- Two-phase-commit recovery regression tests (the round-2 core fix) ---
  //
  // These directly reproduce the red-team's proven exploit: force a failure
  // AFTER the provider call has already "succeeded" (the mock adapter always
  // succeeds, so phase 1 committing PROCESSING plus the adapter call
  // returning is the point of no return) and assert the row is left at
  // PROCESSING — NOT reset to REQUESTED — so a second approval attempt
  // cannot silently trigger a second provider call.

  it('leaves the row at PROCESSING (not REQUESTED) if phase 2 fails on an approver FK violation, and blocks a second approval', async () => {
    const { student, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    // Reproduce red-team's exact repro: an admin session whose userId does
    // not exist in `users` (a deleted/deactivated admin) — phase 2's
    // `approverId: session.userId` write on refund_requests violates the
    // approver_id -> users.id FK, which is exactly the failure red-team
    // injected.
    vi.mocked(getSession).mockResolvedValue({ userId: 'nonexistent-admin-id', role: 'ADMIN' })

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    await expect(approveRefund(req.id)).rejects.toThrow()

    // The provider WAS called (phase 1 committed PROCESSING and the adapter
    // ran) — this is the money-already-moved scenario.
    expect(refundSpy).toHaveBeenCalledTimes(1)

    // The row must be stuck at PROCESSING, never reset to REQUESTED.
    const [afterFailure] = await db.select().from(refundRequests).where(eq(refundRequests.id, req.id))
    expect(afterFailure.status).toBe('PROCESSING')
    expect(afterFailure.status).not.toBe('REQUESTED')

    // A second approval attempt on the PROCESSING row must be rejected, not
    // silently re-run the provider call.
    await expect(approveRefund(req.id)).rejects.toThrow('Invalid transition from PROCESSING to REFUNDED')
    expect(refundSpy).toHaveBeenCalledTimes(1) // still only once — not called again

    // The payment must NOT have been marked REFUNDED — phase 2 never
    // committed, so the payment-side state never changed even though the
    // provider was called. This is the honest state: money may have moved
    // at the provider, but the DB says PROCESSING, which is the visible
    // "needs manual reconciliation" signal, not a silent double-refund.
    const [finalPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(finalPayment.status).toBe('PAID')

    refundSpy.mockRestore()
  })

  it('leaves the row at PROCESSING (not REQUESTED) if the audit insert fails in phase 2, and blocks a second approval', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')
    const auditSpy = vi.spyOn(auditLog, 'recordAdminAction').mockRejectedValueOnce(new Error('simulated audit failure'))

    await expect(approveRefund(req.id)).rejects.toThrow('simulated audit failure')

    // The provider was still called once — money already moved.
    expect(refundSpy).toHaveBeenCalledTimes(1)

    const [afterFailure] = await db.select().from(refundRequests).where(eq(refundRequests.id, req.id))
    expect(afterFailure.status).toBe('PROCESSING')
    expect(afterFailure.status).not.toBe('REQUESTED')

    auditSpy.mockRestore() // restore to the real (working) implementation

    // A second approval attempt on the PROCESSING row must be rejected.
    await expect(approveRefund(req.id)).rejects.toThrow('Invalid transition from PROCESSING to REFUNDED')
    expect(refundSpy).toHaveBeenCalledTimes(1) // still only once

    const [finalPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(finalPayment.status).toBe('PAID') // phase 2 never committed

    refundSpy.mockRestore()
  })

  it('rejects approving a request that is already PROCESSING via a direct approval attempt', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()
    // Insert a row directly at PROCESSING, simulating one already mid-flight
    // (e.g. left there by a crash between phase 1 and phase 2).
    const [stuckRequest] = await db
      .insert(refundRequests)
      .values({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: admin.id,
        reason: 'stuck mid-flight',
        amount: payment.amount,
        status: 'PROCESSING',
      })
      .returning()

    const refundSpy = vi.spyOn(mockPaymentsAdapter, 'refund')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(approveRefund(stuckRequest.id)).rejects.toThrow('Invalid transition from PROCESSING to REFUNDED')

    // approveRefund's phase 1 requires status === REQUESTED, so a stuck
    // PROCESSING row never even reaches the provider call again.
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

  it('cannot reject a PROCESSING request', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()
    const [stuckRequest] = await db
      .insert(refundRequests)
      .values({
        registrationId: registration.id,
        paymentId: payment.id,
        requestedBy: admin.id,
        reason: 'stuck mid-flight',
        amount: payment.amount,
        status: 'PROCESSING',
      })
      .returning()

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(rejectRefund(stuckRequest.id, 'no')).rejects.toThrow('Invalid transition from PROCESSING to REJECTED')
  })
})

// Regression test for red-team MEDIUM #4 (list bound): listRefundRequests
// must never be an unbounded SELECT * — assert it respects a hard cap even
// when more REQUESTED rows exist than the cap.
describe('listRefundRequests', () => {
  it('caps results at 100 even when more than 100 REQUESTED rows exist', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()

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

  it('excludes PROCESSING rows', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()
    await db.insert(refundRequests).values({
      registrationId: registration.id,
      paymentId: payment.id,
      requestedBy: admin.id,
      reason: 'stuck mid-flight',
      amount: payment.amount,
      status: 'PROCESSING',
    })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const results = await listRefundRequests()
    expect(results.every((r) => r.status === 'REQUESTED')).toBe(true)
  })

  it('throws Forbidden for a student session', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'irrelevant', role: 'STUDENT' })
    await expect(listRefundRequests()).rejects.toThrow('Forbidden')
  })
})
