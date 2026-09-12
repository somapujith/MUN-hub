'use server'

import { and, eq, inArray, sum } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations } from '@/lib/db/schema'

/**
 * Verifies the current session's user owns the given mun, or holds an
 * ADMIN/SUPER_ADMIN role. Throws `Forbidden` otherwise.
 *
 * IDOR: the acting user/role always comes from `getSession()` — callers
 * never pass a session or userId in.
 */
async function assertOwnsOrAdmin(munId: string): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return

  const [mun] = await db.select({ organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)

  if (!mun || mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}

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
 * Requires the current session's user to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise.
 */
export async function getMunOverview(munId: string): Promise<MunOverview> {
  await assertOwnsOrAdmin(munId)

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
  paymentStatus?: string
}

export type DelegateRow = Awaited<ReturnType<typeof queryDelegates>>[number]

function queryDelegates(munId: string, filters?: DelegateFilters) {
  const conditions = [eq(registrations.munId, munId)]
  if (filters?.committeeId) {
    conditions.push(eq(registrations.committeeId, filters.committeeId))
  }

  return db.query.registrations.findMany({
    where: and(...conditions),
    with: {
      user: true,
      committee: true,
      portfolio: true,
      payment: true,
      registrationProduct: true,
    },
  })
}

/**
 * Delegate roster for an organizer's mun, optionally filtered by committee
 * and/or payment status.
 *
 * Requires the current session's user to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise. `filters.paymentStatus`
 * is applied against the joined payment row, not silently ignored.
 */
export async function getDelegateList(munId: string, filters?: DelegateFilters): Promise<DelegateRow[]> {
  await assertOwnsOrAdmin(munId)

  const rows = await queryDelegates(munId, filters)

  if (!filters?.paymentStatus) return rows

  return rows.filter((row) => row.payment.some((payment) => payment.status === filters.paymentStatus))
}
