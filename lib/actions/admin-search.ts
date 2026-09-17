import { eq, ilike, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, payments, portfolios, registrations, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'

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
export async function searchRegistrations(
  query: string,
  session: Session | null,
): Promise<RegistrationSearchResult[]> {
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

// Payment exceptions are stored on the payment row by the webhook processor
// and live in lib/payments/exceptions.ts. Re-exported here because the admin
// overview (admin-audit.ts) and the admin payments route read them from this
// module. A failed payment is NOT an exception — no money was taken.
export type { ListPaymentExceptionsParams, ListPaymentExceptionsResult, PaymentExceptionRow } from '@/lib/payments/exceptions'
export { listPaymentExceptions, resolvePaymentException } from '@/lib/payments/exceptions'
