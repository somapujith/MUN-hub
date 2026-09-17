import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrations, users } from '@/lib/db/schema'
import type { PaymentStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { PAYMENT_EXCEPTION_REASONS } from './exception-reasons'

/**
 * Admin queue of payment exceptions — money taken with no valid
 * registration behind it (see ./exception-reasons.ts). Stored on the payment
 * row by the webhook processor; resolved by an admin with a note.
 */

const EXCEPTION_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export const PAYMENT_EXCEPTION_ERRORS = {
  notFound: 'Payment exception not found',
  alreadyResolved: 'This payment exception is already resolved',
  noteRequired: 'A resolution note is required',
  noteTooLong: 'The resolution note must be at most 2000 characters',
} as const

export const RESOLUTION_NOTE_MAX_LENGTH = 2000

export interface PaymentExceptionRow {
  paymentId: string
  registrationId: string
  reason: string
  amount: number
  currency: string
  paymentStatus: PaymentStatus
  registrationStatus: RegistrationStatus
  providerOrderId: string
  providerPaymentId: string | null
  studentName: string
  studentEmail: string
  munName: string
  raisedAt: Date
}

// LEGACY: before payment exceptions existed (migration 0031), the webhook
// stored a payment captured after its seat hold as status REFUNDED — which
// meant exactly "money owed back", never an actual refund. Those rows have no
// exception_reason, so they're surfaced as PAYMENT_AFTER_HOLD_EXPIRED until
// an admin resolves them.
const openException = and(
  isNull(payments.exceptionResolvedAt),
  or(isNotNull(payments.exceptionReason), eq(payments.status, 'REFUNDED')),
)

/**
 * Open payment exceptions, newest first, capped at 100 (no pagination yet —
 * the queue is expected to stay short, and a fresh exception must always
 * be on the first page). OPERATIONS/ADMIN/SUPER_ADMIN only.
 */
export async function listOpenPaymentExceptions(session: Session | null): Promise<PaymentExceptionRow[]> {
  requireRole(session, [...EXCEPTION_ROLES])

  const raisedAt = sql<Date>`coalesce(${payments.exceptionRaisedAt}, ${payments.updatedAt})`

  const rows = await db
    .select({
      paymentId: payments.id,
      registrationId: registrations.id,
      exceptionReason: payments.exceptionReason,
      amount: payments.amount,
      currency: payments.currency,
      paymentStatus: payments.status,
      registrationStatus: registrations.status,
      providerOrderId: payments.providerOrderId,
      providerPaymentId: payments.providerPaymentId,
      studentName: users.name,
      studentEmail: users.email,
      munName: muns.name,
      exceptionRaisedAt: payments.exceptionRaisedAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(registrations, eq(payments.registrationId, registrations.id))
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(openException)
    .orderBy(desc(raisedAt), desc(payments.id))
    .limit(100)

  return rows.map((row) => ({
    paymentId: row.paymentId,
    registrationId: row.registrationId,
    reason: row.exceptionReason ?? PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired,
    amount: row.amount,
    currency: row.currency,
    paymentStatus: row.paymentStatus,
    registrationStatus: row.registrationStatus,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    studentName: row.studentName,
    studentEmail: row.studentEmail,
    munName: row.munName,
    raisedAt: row.exceptionRaisedAt ?? row.updatedAt,
  }))
}

export interface ResolvedPaymentException {
  paymentId: string
  reason: string
  resolvedAt: Date
  resolvedBy: string
  note: string
}

/**
 * Marks an open payment exception resolved (the admin has returned the money
 * or otherwise settled it off-platform) and records who did it and why.
 * Row-locks the payment and writes the admin_actions entry in the same
 * transaction. OPERATIONS/ADMIN/SUPER_ADMIN only.
 *
 * Audit action: `PAYMENT_DETAILS_CHANGED` on target type 'payment' with
 * `metadata.kind = 'PAYMENT_EXCEPTION_RESOLVED'` — the closest existing
 * admin_action value; a dedicated enum value needs a migration.
 */
export async function resolvePaymentException(
  paymentId: string,
  note: string,
  session: Session | null,
): Promise<ResolvedPaymentException> {
  requireRole(session, [...EXCEPTION_ROLES])

  const trimmed = note.trim()
  if (!trimmed) throw new Error(PAYMENT_EXCEPTION_ERRORS.noteRequired)
  if (trimmed.length > RESOLUTION_NOTE_MAX_LENGTH) throw new Error(PAYMENT_EXCEPTION_ERRORS.noteTooLong)

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select({
        id: payments.id,
        registrationId: payments.registrationId,
        status: payments.status,
        amount: payments.amount,
        currency: payments.currency,
        exceptionReason: payments.exceptionReason,
        exceptionRaisedAt: payments.exceptionRaisedAt,
        exceptionResolvedAt: payments.exceptionResolvedAt,
        updatedAt: payments.updatedAt,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update')
      .limit(1)

    const isLegacy = payment?.exceptionReason === null && payment?.status === 'REFUNDED'
    if (!payment || (payment.exceptionReason === null && !isLegacy)) {
      throw new Error(PAYMENT_EXCEPTION_ERRORS.notFound)
    }
    if (payment.exceptionResolvedAt !== null) {
      throw new Error(PAYMENT_EXCEPTION_ERRORS.alreadyResolved)
    }

    const reason = payment.exceptionReason ?? PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired
    const now = new Date()

    await tx
      .update(payments)
      .set({
        // Legacy rows get their implied reason written down on resolution.
        exceptionReason: reason,
        exceptionRaisedAt: payment.exceptionRaisedAt ?? payment.updatedAt,
        exceptionResolvedAt: now,
        exceptionResolvedBy: session.userId,
        exceptionResolutionNote: trimmed,
        updatedAt: now,
      })
      .where(eq(payments.id, payment.id))

    await recordAdminAction(tx, session.userId, 'PAYMENT_DETAILS_CHANGED', 'payment', payment.id, trimmed, {
      kind: 'PAYMENT_EXCEPTION_RESOLVED',
      exceptionReason: reason,
      registrationId: payment.registrationId,
      amount: payment.amount,
      currency: payment.currency,
      paymentStatus: payment.status,
    })

    return { paymentId: payment.id, reason, resolvedAt: now, resolvedBy: session.userId, note: trimmed }
  })
}
