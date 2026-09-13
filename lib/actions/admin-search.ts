'use server'

import { and, eq, ilike, ne, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, payments, portfolios, registrations, users } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export interface RegistrationSearchResult {
  registrationId: string
  studentName: string
  munName: string
  committeeName: string | null
  portfolioName: string | null
  paymentStatus: string | null
  registrationStatus: string
}

/**
 * Matches PRD section 24 fields: registration ID, student, mun, committee,
 * portfolio, payment/order ID. One ILIKE-based search across the joined
 * view — a registration ID exact match also falls out of the same ILIKE
 * since ids are text.
 *
 * `payments.registrationId` is unique (one payment per registration), so the
 * left join can't fan a registration out into duplicate rows.
 */
export async function searchRegistrations(query: string): Promise<RegistrationSearchResult[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const pattern = `%${query}%`

  const rows = await db
    .select({
      registrationId: registrations.id,
      studentName: users.name,
      munName: muns.name,
      committeeName: committees.name,
      portfolioName: portfolios.name,
      paymentStatus: payments.status,
      registrationStatus: registrations.status,
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .leftJoin(committees, eq(registrations.committeeId, committees.id))
    .leftJoin(portfolios, eq(registrations.portfolioId, portfolios.id))
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(
      or(
        ilike(users.name, pattern),
        ilike(muns.name, pattern),
        ilike(committees.name, pattern),
        ilike(portfolios.name, pattern),
        eq(registrations.id, query),
        ilike(payments.providerOrderId, pattern),
      ),
    )
    .limit(50)

  return rows
}

export interface PaymentExceptionRow {
  registrationId: string
  paymentId: string
  reason: 'PAYMENT_FAILED' | 'CONFIRMATION_MISMATCH'
  amount: number
  studentName: string
  munName: string
}

/**
 * Computed, not a stored state (matches project convention — the webhook
 * handler's refundOwed logic already treats this as derived). Two cases:
 * a FAILED payment, or a PAID payment whose registration isn't CONFIRMED
 * (the registration expired/was cancelled after the webhook fired — see
 * CLAUDE.md "Registration integrity" section for the underlying webhook
 * behavior this surfaces).
 */
export async function listPaymentExceptions(): Promise<PaymentExceptionRow[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const rows = await db
    .select({
      registrationId: registrations.id,
      paymentId: payments.id,
      paymentStatus: payments.status,
      registrationStatus: registrations.status,
      amount: payments.amount,
      studentName: users.name,
      munName: muns.name,
    })
    .from(payments)
    .innerJoin(registrations, eq(payments.registrationId, registrations.id))
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(
      or(
        eq(payments.status, 'FAILED'),
        and(eq(payments.status, 'PAID'), ne(registrations.status, 'CONFIRMED')),
      ),
    )

  return rows.map((row) => ({
    registrationId: row.registrationId,
    paymentId: row.paymentId,
    reason: row.paymentStatus === 'FAILED' ? ('PAYMENT_FAILED' as const) : ('CONFIRMATION_MISMATCH' as const),
    amount: row.amount,
    studentName: row.studentName,
    munName: row.munName,
  }))
}
