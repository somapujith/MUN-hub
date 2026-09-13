'use server'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments, refundRequests, registrations } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type RefundRequestRow = typeof refundRequests.$inferSelect

/**
 * Requests a refund against a registration's payment.
 *
 * The caller must either own the registration (a student refunding their
 * own purchase) or hold an admin-tier role (an operator filing a goodwill
 * refund on a student's behalf) — never trust a client-supplied
 * registrationId alone as proof of ownership, per the registration-integrity
 * invariant in CLAUDE.md. Actor identity always comes from `getSession()`.
 */
export async function requestRefund(registrationId: string, reason: string): Promise<RefundRequestRow> {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

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
 * Row-locks both the refund_requests row and the payments row (same
 * `.for('update')` concurrency-safety pattern as
 * `lib/lifecycle/mun-state-machine.ts` / `suspendMun`) so two concurrent
 * approvals of the same request serialize instead of both refunding.
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
    if (!payment?.providerPaymentId) throw new Error('Payment has no provider payment id')

    const { providerRefundId } = await mockPaymentsAdapter.refund(payment.providerPaymentId, request.amount)

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

/** Lists all pending (REQUESTED) refund requests, for the admin refunds queue. */
export async function listRefundRequests(): Promise<RefundRequestRow[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])
  return db.select().from(refundRequests).where(eq(refundRequests.status, 'REQUESTED'))
}
