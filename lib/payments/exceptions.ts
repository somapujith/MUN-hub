import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrations, users } from '@/lib/db/schema'
import type { PaymentStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { countedPaymentsFilter } from './counted-payments'
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
  /** Set only for a resolved row (status: 'resolved'); null for an open one. */
  resolvedAt: Date | null
  resolvedByUserId: string | null
  resolutionNote: string | null
}

// LEGACY: before payment exceptions existed (migration 0031), the webhook
// stored a payment captured after its seat hold as status REFUNDED — which
// meant exactly "money owed back", never an actual refund. Those rows have no
// exception_reason, so they're surfaced as PAYMENT_AFTER_HOLD_EXPIRED until
// an admin resolves them.
const hasException = or(isNotNull(payments.exceptionReason), eq(payments.status, 'REFUNDED'))

function pattern(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export interface ListPaymentExceptionsParams {
  /** Default 'open'. */
  status?: 'open' | 'resolved'
  /** Matches the delegate's email or the MUN's name, case-insensitive substring. */
  search?: string
  /** Default 50. */
  limit?: number
  /** Default 0. */
  offset?: number
}

export interface ListPaymentExceptionsResult {
  results: PaymentExceptionRow[]
  total: number
}

/**
 * Payment exceptions, newest-raised first, paginated. Mock checkout rows
 * (including legacy REFUNDED ones) are listed only while the mock adapter is
 * active: they took no money, so there is nothing to return.
 * OPERATIONS/ADMIN/SUPER_ADMIN only.
 */
export async function listPaymentExceptions(
  params: ListPaymentExceptionsParams,
  session: Session | null,
): Promise<ListPaymentExceptionsResult> {
  requireRole(session, [...EXCEPTION_ROLES])

  const limit = params.limit ?? 50
  const offset = params.offset ?? 0
  const statusFilter =
    params.status === 'resolved' ? and(hasException, isNotNull(payments.exceptionResolvedAt)) : and(hasException, isNull(payments.exceptionResolvedAt))

  const q = params.search?.trim()
  const searchFilter = q
    ? or(ilike(users.email, `%${pattern(q)}%`), ilike(muns.name, `%${pattern(q)}%`))
    : undefined

  const whereClause = and(statusFilter, countedPaymentsFilter(), searchFilter)
  const raisedAt = sql<Date>`coalesce(${payments.exceptionRaisedAt}, ${payments.updatedAt})`

  const [rows, [{ count } = { count: 0 }]] = await Promise.all([
    db
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
        exceptionResolvedAt: payments.exceptionResolvedAt,
        exceptionResolvedBy: payments.exceptionResolvedBy,
        exceptionResolutionNote: payments.exceptionResolutionNote,
      })
      .from(payments)
      .innerJoin(registrations, eq(payments.registrationId, registrations.id))
      .innerJoin(users, eq(registrations.userId, users.id))
      .innerJoin(muns, eq(registrations.munId, muns.id))
      .where(whereClause)
      .orderBy(desc(raisedAt), desc(payments.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payments)
      .innerJoin(registrations, eq(payments.registrationId, registrations.id))
      .innerJoin(users, eq(registrations.userId, users.id))
      .innerJoin(muns, eq(registrations.munId, muns.id))
      .where(whereClause),
  ])

  const results = rows.map((row) => ({
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
    resolvedAt: row.exceptionResolvedAt,
    resolvedByUserId: row.exceptionResolvedBy,
    resolutionNote: row.exceptionResolutionNote,
  }))

  return { results, total: count }
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
 * Audit action: `PAYMENT_EXCEPTION_RESOLVED` on target type 'payment'
 * (migration 0035). `metadata.kind` repeats the name, as rows written before
 * the dedicated value existed stored `PAYMENT_DETAILS_CHANGED` with it.
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

    await recordAdminAction(tx, session.userId, 'PAYMENT_EXCEPTION_RESOLVED', 'payment', payment.id, trimmed, {
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
