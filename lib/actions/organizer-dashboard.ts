import { and, eq, exists, inArray, sql, sum } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { db } from '@/lib/db/client'
import { payments, registrationProducts, registrations } from '@/lib/db/schema'
import type { PaymentStatus } from '@/lib/db/schema-enums'

export interface MunOverview {
  totalRegistrations: number
  revenue: number
  pendingPayments: number
  availableSeats: number
}

const COUNTABLE_REGISTRATION_STATUSES = ['CONFIRMED', 'ATTENDED'] as const

/**
 * Aggregate stats for an organizer's mun dashboard: registration count,
 * revenue collected, payments still pending, and remaining seat capacity.
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise. Missing mun throws
 * `Mun not found` (shared `assertOwnsOrAdmin`; previously this file's local
 * helper folded not-found into Forbidden).
 */
export async function getMunOverview(munId: string, session: Session | null): Promise<MunOverview> {
  await assertOwnsOrAdmin(munId, session)

  const [totalRegistrations, revenueRow, pendingPayments, products] = await Promise.all([
    db.$count(
      registrations,
      and(eq(registrations.munId, munId), inArray(registrations.status, [...COUNTABLE_REGISTRATION_STATUSES])),
    ),
    db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .innerJoin(registrations, eq(payments.registrationId, registrations.id))
      .where(and(eq(registrations.munId, munId), eq(payments.status, 'PAID')))
      .then((rows) => rows[0]),
    db.$count(
      payments,
      and(
        eq(payments.status, 'PENDING'),
        inArray(
          payments.registrationId,
          db.select({ id: registrations.id }).from(registrations).where(eq(registrations.munId, munId)),
        ),
      ),
    ),
    db.select({ capacity: registrationProducts.capacity }).from(registrationProducts).where(eq(registrationProducts.munId, munId)),
  ])

  const totalCapacity = products.reduce((sumCapacity, product) => sumCapacity + product.capacity, 0)

  return {
    totalRegistrations,
    revenue: revenueRow?.total ? Number(revenueRow.total) : 0,
    pendingPayments,
    availableSeats: totalCapacity - totalRegistrations,
  }
}

export interface DelegateFilters {
  committeeId?: string
  paymentStatus?: PaymentStatus
  limit?: number
  offset?: number
}

export type DelegateRow = Awaited<ReturnType<typeof queryDelegates>>[number]

/**
 * `filters.paymentStatus` is pushed into the query as a EXISTS subquery
 * against `payments` (not fetched-then-`.filter()`'d in application memory
 * — a mun with thousands of delegates would otherwise pull every row on
 * every filtered request, flagged during frontend review at BITSMUN-scale
 * conference sizes). Paginated (default 50/page) for the same reason: this
 * grows with delegate count, not with anything platform-wide, but a single
 * conference can still run into the thousands.
 */
function buildDelegateConditions(munId: string, filters?: DelegateFilters) {
  const conditions = [eq(registrations.munId, munId)]
  if (filters?.committeeId) {
    conditions.push(eq(registrations.committeeId, filters.committeeId))
  }
  if (filters?.paymentStatus) {
    const paymentStatus = filters.paymentStatus
    conditions.push(
      exists(
        db
          .select({ id: payments.id })
          .from(payments)
          .where(and(eq(payments.registrationId, registrations.id), eq(payments.status, paymentStatus))),
      ),
    )
  }
  return conditions
}

function queryDelegates(munId: string, filters?: DelegateFilters) {
  return db.query.registrations.findMany({
    where: and(...buildDelegateConditions(munId, filters)),
    with: {
      user: true,
      committee: true,
      portfolio: true,
      payment: true,
      registrationProduct: true,
    },
    limit: filters?.limit ?? 50,
    offset: filters?.offset ?? 0,
  })
}

export interface DelegateListResult {
  results: DelegateRow[]
  total: number
}

/**
 * Delegate roster for an organizer's mun, optionally filtered by committee
 * and/or payment status, paginated.
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise.
 */
export async function getDelegateList(
  munId: string,
  filters: DelegateFilters | undefined,
  session: Session | null,
): Promise<DelegateListResult> {
  await assertOwnsOrAdmin(munId, session)

  const [results, [{ count } = { count: 0 }]] = await Promise.all([
    queryDelegates(munId, filters),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(registrations)
      .where(and(...buildDelegateConditions(munId, filters))),
  ])

  return { results, total: count }
}
