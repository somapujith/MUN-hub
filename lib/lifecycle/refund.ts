'use server'

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments, refundRequests, registrations } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

// Belt-and-suspenders bound on the free-text reason field — this is
// user-controlled input persisted verbatim into `admin_actions.reason` and
// `refund_requests.reason`, so it needs a boundary validation cap like any
// other input at a system boundary (CLAUDE.md "Validate all input at system
// boundaries"), independent of whatever the DB column type allows.
const MAX_REASON_LENGTH = 1000

export type RefundRequestRow = typeof refundRequests.$inferSelect

function assertReasonLength(reason: string): void {
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`Reason must be ${MAX_REASON_LENGTH} characters or fewer`)
  }
}

/**
 * Requests a refund against a registration's payment.
 *
 * The caller must either own the registration (a student refunding their
 * own purchase) or hold an admin-tier role (an operator filing a goodwill
 * refund on a student's behalf) — never trust a client-supplied
 * registrationId alone as proof of ownership, per the registration-integrity
 * invariant in CLAUDE.md. Actor identity always comes from `getSession()`.
 *
 * Request-time idempotency guard (defense in depth, not the sole guard —
 * see `approveRefund`'s `payment.status !== 'PAID'` check for the one that
 * actually closes the double-refund exploit): rejects creating a new
 * request if an active (REQUESTED) request already exists for the same
 * payment, so a user spamming this endpoint can't pile up N separate
 * `refund_requests` rows against one payment for an admin to approve N
 * times. This check alone is not race-proof (two concurrent calls can both
 * pass it before either inserts) — that's why `approveRefund` also row-locks
 * the payment and checks its status before refunding.
 */
export async function requestRefund(registrationId: string, reason: string): Promise<RefundRequestRow> {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')
  assertReasonLength(reason)

  const [registration] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1)
  if (!registration) throw new Error('Registration not found')

  const isOwner = registration.userId === session.userId
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(session.role)
  if (!isOwner && !isAdmin) throw new Error('Forbidden')

  const [payment] = await db.select().from(payments).where(eq(payments.registrationId, registrationId)).limit(1)
  if (!payment) throw new Error('No payment found for this registration')

  const [existingActiveRequest] = await db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(and(eq(refundRequests.paymentId, payment.id), eq(refundRequests.status, 'REQUESTED')))
    .limit(1)
  if (existingActiveRequest) {
    throw new Error('A refund request is already pending for this payment')
  }

  const [request] = await db
    .insert(refundRequests)
    .values({
      registrationId,
      paymentId: payment.id,
      requestedBy: session.userId,
      reason,
      amount: payment.amount,
    })
    .returning()

  return request
}

/**
 * Approves and immediately executes the refund via the payments adapter —
 * there is no separate provider-confirmation step in this mock-adapter
 * world, so approval and execution happen atomically in one transaction.
 *
 * Row-locks both the refund_requests row AND the payments row (same
 * `.for('update')` concurrency-safety pattern as
 * `lib/lifecycle/mun-state-machine.ts` / `suspendMun`). The payments lock is
 * the one that actually closes the double-refund exploit: `payments.registrationId`
 * is unique (one payment per registration), but nothing stops a caller from
 * creating multiple `refund_requests` rows against that same payment (see
 * `requestRefund`'s request-time guard, which is best-effort, not race-proof)
 * — each such row has its own id, so a `.for('update')` lock scoped only to
 * `refund_requests.id` would never contend between them, letting an admin
 * approve N rows and trigger N real provider refunds on one payment. Locking
 * the shared `payments` row instead means a second concurrent approval
 * attempt against a different refund_requests row for the same payment
 * blocks on this same lock, and by the time it acquires it the first
 * approval has already flipped `payment.status` to `REFUNDED` — which the
 * `payment.status !== 'PAID'` check below then rejects.
 *
 * That same check also guards against refunding a payment that was never
 * actually PAID (FAILED/CREATED/PENDING) — approving a refund must never be
 * able to force a registration into REFUNDED from an unrelated state.
 *
 * Ordering: every validation (both row locks, both status checks) happens
 * BEFORE calling `mockPaymentsAdapter.refund()`, so the adapter call is the
 * last thing in this function that can plausibly fail or reject. Immediately
 * after it returns, the very first write is persisting `providerRefundId`
 * onto the refund_requests row — before touching payments/registrations or
 * writing the audit row — so if anything after the adapter call did fail,
 * the transaction rollback is the only way that provider result is lost.
 * A real (non-mock) adapter is expected to throw before ever returning a
 * result if the provider call itself failed, which keeps the "provider
 * charged with zero DB trace" window as small as it can be made without a
 * durable pre-commit/intent record — that would need a schema change (e.g.
 * a PROCESSING refund status persisted before the adapter call), which is
 * out of scope for this fix but worth revisiting before a real payments
 * provider replaces the mock adapter.
 */
export async function approveRefund(refundRequestId: string): Promise<RefundRequestRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundRequestId))
      .for('update')
      .limit(1)
    if (!request) throw new Error('Refund request not found')
    if (request.status !== 'REQUESTED') throw new Error(`Invalid transition from ${request.status} to REFUNDED`)

    const [payment] = await tx.select().from(payments).where(eq(payments.id, request.paymentId)).for('update').limit(1)
    if (!payment) throw new Error('Payment not found')
    if (!payment.providerPaymentId) throw new Error('Payment has no provider payment id')
    // Closes CRITICAL #1 (payment-level idempotency) and #2 (payment
    // precondition) together: a payment already flipped to REFUNDED by a
    // prior approval — of this request or of a sibling request against the
    // same payment — fails this check exactly the same way an
    // unpaid/failed/pending payment does.
    if (payment.status !== 'PAID') {
      throw new Error(`Cannot refund a payment with status ${payment.status}`)
    }

    // Last thing that can fail before money moves.
    const { providerRefundId } = await mockPaymentsAdapter.refund(payment.providerPaymentId, request.amount)

    // First write after the provider call returns — persists proof the
    // refund happened before any other write in this transaction.
    const [updated] = await tx
      .update(refundRequests)
      .set({
        status: 'REFUNDED',
        approverId: session.userId,
        approvedAt: new Date(),
        providerRefundId,
        updatedAt: new Date(),
      })
      .where(eq(refundRequests.id, refundRequestId))
      .returning()

    await tx.update(payments).set({ status: 'REFUNDED', updatedAt: new Date() }).where(eq(payments.id, request.paymentId))
    await tx.update(registrations).set({ status: 'REFUNDED' }).where(eq(registrations.id, request.registrationId))

    await recordAdminAction(tx, session.userId, 'REFUND_APPROVED', 'refund_request', refundRequestId)

    return updated
  })
}

/**
 * Rejects a refund request. Leaves the registration and payment untouched —
 * a rejection is a decision not to refund, not a state change on the
 * underlying purchase.
 */
export async function rejectRefund(refundRequestId: string, reason: string): Promise<RefundRequestRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])
  assertReasonLength(reason)

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundRequestId))
      .for('update')
      .limit(1)
    if (!request) throw new Error('Refund request not found')
    if (request.status !== 'REQUESTED') throw new Error(`Invalid transition from ${request.status} to REJECTED`)

    const [updated] = await tx
      .update(refundRequests)
      .set({ status: 'REJECTED', approverId: session.userId, updatedAt: new Date() })
      .where(eq(refundRequests.id, refundRequestId))
      .returning()

    await recordAdminAction(tx, session.userId, 'REFUND_REJECTED', 'refund_request', refundRequestId, reason)

    return updated
  })
}

const LIST_REFUND_REQUESTS_LIMIT = 100

/**
 * Lists pending (REQUESTED) refund requests, for the admin refunds queue.
 * Bounded like `listOrganizers`/`getReviewQueue` elsewhere in the codebase —
 * this grows with total refund-request volume, not per-mun, so it needs a
 * cap before real platform volume rather than an unbounded `SELECT *`.
 */
export async function listRefundRequests(): Promise<RefundRequestRow[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])
  return db
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.status, 'REQUESTED'))
    .orderBy(refundRequests.createdAt)
    .limit(LIST_REFUND_REQUESTS_LIMIT)
}
