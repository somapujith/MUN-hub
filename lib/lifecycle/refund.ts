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
 * NEW-3 design choice: restricted to the registration's OWNER only —
 * dropped the earlier "admin can file on a student's behalf" branch. This
 * PRD slice has no requirement for an admin-filed goodwill refund, and
 * keeping it open meant an admin (or a compromised admin session) could
 * file a REQUESTED row against a student's registration that only an
 * admin could then cancel — a student who never asked for a refund had no
 * way to clear their own registration's queue slot. If a future slice needs
 * admin-filed refunds, reintroduce the override deliberately alongside a
 * cancel/dismiss path scoped to that case specifically, rather than as a
 * silent side door here. Actor identity always comes from `getSession()`,
 * never a client-supplied parameter, per the registration-integrity
 * invariant in CLAUDE.md.
 *
 * Request-time idempotency guard (defense in depth, not the sole guard —
 * see `approveRefund`'s two-phase commit for the one that actually closes
 * the double-refund exploit): rejects creating a new request if an active
 * (REQUESTED) request already exists for the same payment, and rejects
 * outright if the payment isn't currently PAID (NEW-4 — a REFUNDED or
 * FAILED payment has nothing left to refund and shouldn't accrue queue
 * junk). Neither check is race-proof alone (two concurrent calls can both
 * pass before either inserts) — that's why `approveRefund` re-validates
 * everything itself under a row lock before ever calling the provider.
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

  if (registration.userId !== session.userId) throw new Error('Forbidden')

  const [payment] = await db.select().from(payments).where(eq(payments.registrationId, registrationId)).limit(1)
  if (!payment) throw new Error('No payment found for this registration')
  if (payment.status !== 'PAID') {
    throw new Error(`Cannot request a refund for a payment with status ${payment.status}`)
  }

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
 * Cancels the caller's own REQUESTED refund request (NEW-3). Restricted to
 * REQUESTED — once a request has moved to PROCESSING/REFUNDED/REJECTED
 * there is nothing left to "cancel" (PROCESSING in particular must never be
 * touched by anything other than `approveRefund`'s own phase 2, since it
 * means a provider call may already be in flight or committed). Only the
 * requester may cancel their own request — this is not an admin action.
 */
export async function cancelRefundRequest(refundRequestId: string): Promise<RefundRequestRow> {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundRequestId))
      .for('update')
      .limit(1)
    if (!request) throw new Error('Refund request not found')
    if (request.requestedBy !== session.userId) throw new Error('Forbidden')
    if (request.status !== 'REQUESTED') {
      throw new Error(`Invalid transition from ${request.status} to REJECTED`)
    }

    const [updated] = await tx
      .update(refundRequests)
      .set({ status: 'REJECTED', updatedAt: new Date() })
      .where(eq(refundRequests.id, refundRequestId))
      .returning()

    await recordAdminAction(tx, session.userId, 'REFUND_REJECTED', 'refund_request', refundRequestId, 'Cancelled by requester')

    return updated
  })
}

/**
 * Approves and executes a refund request via a two-phase commit.
 *
 * WHY TWO PHASES (round 2 of this fix): round 1 called the payments adapter
 * inside the same transaction that later wrote REFUNDED, on the theory that
 * keeping every write after the adapter call small and simple made failure
 * after a successful provider call vanishingly unlikely. Red-team proved
 * that reasoning wrong — they forced the FIRST post-adapter write to fail
 * (an `approver_id` FK violation from a deleted/deactivated admin, a
 * realistic case) and separately forced the audit insert to fail. In both
 * cases the provider call had already succeeded (money moved), the
 * transaction rolled back, and the row reset to REQUESTED with
 * providerRefundId still null — zero DB trace the refund ever happened, and
 * a second approval on the same now-REQUESTED row succeeded, refunding
 * twice. No amount of narrowing "what can fail after the adapter call" ever
 * closes this: ANY write after an irreversible external call can fail
 * (FK violation, connection drop, commit failure), so the fix has to be
 * architectural, not just "make the window smaller."
 *
 * The fix: the provider call must never be able to succeed without a
 * durable, idempotent record surviving independently of whatever happens
 * next. Concretely:
 *
 *   PHASE 1 (its own transaction, committed before any external call):
 *     row-lock refund_requests, re-validate everything (status, payment
 *     status/ownership/amount — see NEW-1/NEW-2 below), then flip the row
 *     to PROCESSING and COMMIT. This durably records "we are about to call
 *     the provider for THIS row" before the provider is ever touched.
 *
 *   PROVIDER CALL, outside any DB transaction, keyed by refundRequestId as
 *     the idempotency key (see lib/payments/adapter.ts).
 *
 *   PHASE 2 (a second, separate transaction, after the adapter call
 *     returns): row-lock the request again, require it still be PROCESSING
 *     (guards against a concurrent process somehow racing this — see the
 *     regression test), then write providerRefundId + REFUNDED + update
 *     payments/registrations + the audit row, all together.
 *
 * RECOVERY PATH: if the process crashes/throws between phase 1 committing
 * and phase 2 starting (including the provider call itself throwing), the
 * row is left at PROCESSING — NOT reset to REQUESTED. This is the actual
 * fix, not a detail: a stuck PROCESSING row is visible (it will never
 * satisfy `status !== 'REQUESTED'`, so `approveRefund` called again on it
 * throws instead of silently re-running the provider call) and demands
 * manual attention; a row silently reset to REQUESTED looks exactly like a
 * fresh, never-touched request and invites exactly the silent second
 * approval this whole fix exists to prevent. This function does not build
 * an automatic PROCESSING-sweep/retry mechanism — a stuck PROCESSING row
 * needs a human to check the payments provider's dashboard for whether the
 * refund actually landed (using refundRequestId as the idempotency key to
 * look it up) and then manually resolve the row, or a future retry job that
 * calls the adapter again with the SAME idempotency key (safe exactly
 * because real providers de-duplicate on it) and re-attempts phase 2. That
 * sweep is out of scope for this fix.
 */
export async function approveRefund(refundRequestId: string): Promise<RefundRequestRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  // --- Phase 1: validate everything and durably mark PROCESSING. ---
  const processing = await db.transaction(async (tx) => {
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

    // NEW-1: a refund_requests row's paymentId and registrationId must
    // actually belong to each other. Nothing upstream currently lets these
    // drift apart, but approveRefund is the last line of defense before
    // real money moves and a mismatched registration/payment pair here
    // would mean crediting a refund against the wrong purchase.
    if (payment.registrationId !== request.registrationId) {
      throw new Error('Refund request payment does not match registration')
    }

    // Closes the original double-refund exploit together with the
    // PROCESSING guard below: a payment already REFUNDED by a prior
    // approval, or a payment that was never PAID to begin with
    // (FAILED/CREATED/PENDING), fails this the same way.
    if (payment.status !== 'PAID') {
      throw new Error(`Cannot refund a payment with status ${payment.status}`)
    }

    // NEW-2: never trust the amount snapshotted onto the request row at
    // request-time — re-check it against the payment's current amount,
    // read fresh under the same lock, immediately before committing to
    // PROCESSING (and therefore before the provider is ever called).
    if (request.amount !== payment.amount) {
      throw new Error('Refund amount does not match payment amount')
    }

    const [updated] = await tx
      .update(refundRequests)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(eq(refundRequests.id, refundRequestId))
      .returning()

    return { request: updated, payment }
  })

  // --- Provider call: outside any transaction, keyed for idempotency. ---
  // If this throws, the row is left at PROCESSING (see the doc comment
  // above) rather than being reset — that's the fix.
  const { providerRefundId } = await mockPaymentsAdapter.refund(
    processing.payment.providerPaymentId as string,
    processing.request.amount,
    refundRequestId,
  )

  // --- Phase 2: a second, separate transaction that persists the result. ---
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundRequestId))
      .for('update')
      .limit(1)
    if (!request) throw new Error('Refund request not found')
    // Guards against a concurrent process having already moved this row
    // (e.g. a retry sweep racing this same call) — only the process that
    // observes PROCESSING here gets to write the terminal REFUNDED state.
    if (request.status !== 'PROCESSING') {
      throw new Error(`Invalid transition from ${request.status} to REFUNDED`)
    }

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
 * underlying purchase. Only legal from REQUESTED — a PROCESSING row must
 * never be rejected out from under an in-flight/possibly-already-succeeded
 * provider call.
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
 * Deliberately excludes PROCESSING rows — those aren't "pending admin
 * decision," they're mid-flight/stuck and need the separate manual-
 * reconciliation path described on `approveRefund`, not a second approve
 * click from this queue. Bounded like `listOrganizers`/`getReviewQueue`
 * elsewhere in the codebase — this grows with total refund-request volume,
 * not per-mun, so it needs a cap before real platform volume rather than an
 * unbounded `SELECT *`.
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
