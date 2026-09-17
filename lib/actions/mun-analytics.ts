import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { db } from '@/lib/db/client'
import { payments, registrationProducts, registrations } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/db/schema-enums'

// -----------------------------------------------------------------------------
// mun-analytics — read-only registration/revenue rollup for the organizer
// "Analytics" dashboard section (PRD Section 28 MVP does not define a
// dedicated analytics endpoint; this is the minimal per-product breakdown
// requested to back that section, reusing the same tables/conventions
// `getMunOverview` (organizer-dashboard.ts) already established rather than
// duplicating its aggregate-registrations-and-revenue logic — this file adds
// the missing per-product GROUP BY that overview intentionally collapses
// into a single mun-wide total).
// -----------------------------------------------------------------------------

/** Matches organizer-dashboard.ts's COUNTABLE_REGISTRATION_STATUSES: a registration only "counts" once it's CONFIRMED or the delegate ATTENDED — PENDING/PAYMENT_PENDING never held a seat that materialized, CANCELLED/REFUNDED gave it back. */
const COUNTABLE_REGISTRATION_STATUSES = ['CONFIRMED', 'ATTENDED'] as const

/**
 * Registrations whose PAID payment counts as organizer revenue: the seat
 * still stands. A PAID payment on a released registration is a payment
 * exception (money an admin settles manually), not revenue. Same rule as
 * payment-settlement.ts#getMunPaymentsSummary, so the analytics and finance
 * pages agree.
 */
export const REVENUE_REGISTRATION_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'ATTENDED', 'NO_SHOW']

/**
 * What the organizer is owed for one payment: the net stored with its fee
 * breakdown, or the whole amount for payments recorded before the fee model
 * existed (they carry no breakdown and no fee).
 */
export const organizerNetAmountSql = sql`coalesce(${payments.organizerNetAmount}, ${payments.amount})`

export interface ProductAnalytics {
  productId: string
  productName: string
  price: number
  capacity: number
  registrationCount: number
  /** Gross collected: what delegates paid, platform fee and GST included. */
  revenue: number
  /** Net to the organizer: `revenue` minus the platform fee and the GST on it. */
  organizerNet: number
}

export interface MunAnalytics {
  totalRegistrations: number
  /** Gross collected across every pass. */
  totalRevenue: number
  /** Net to the organizer across every pass. */
  totalOrganizerNet: number
  products: ProductAnalytics[]
}

/**
 * Registration counts, gross collected and net-to-organizer for one mun,
 * grouped by registration product. Two grouped aggregate queries (counts,
 * money) run in parallel against the product list, then merge in memory by
 * product id — same "batch the aggregates, don't N+1 per product" shape as
 * `getMunOverview`/`getDelegateList` in organizer-dashboard.ts. Money counts
 * PAID payments on standing registrations only (`REVENUE_REGISTRATION_STATUSES`).
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise (via `assertOwnsOrAdmin`).
 */
export async function getMunAnalytics(munId: string, session: Session | null): Promise<MunAnalytics> {
  await assertOwnsOrAdmin(munId, session)

  const [products, countRows, revenueRows] = await Promise.all([
    db
      .select({
        id: registrationProducts.id,
        name: registrationProducts.name,
        price: registrationProducts.price,
        capacity: registrationProducts.capacity,
      })
      .from(registrationProducts)
      .where(eq(registrationProducts.munId, munId))
      .orderBy(asc(registrationProducts.displayOrder)),
    db
      .select({ productId: registrations.registrationProductId, count: count() })
      .from(registrations)
      .where(
        and(eq(registrations.munId, munId), inArray(registrations.status, [...COUNTABLE_REGISTRATION_STATUSES])),
      )
      .groupBy(registrations.registrationProductId),
    db
      .select({
        productId: registrations.registrationProductId,
        collected: sql<string>`coalesce(sum(${payments.amount}), 0)::bigint`,
        organizerNet: sql<string>`coalesce(sum(${organizerNetAmountSql}), 0)::bigint`,
      })
      .from(payments)
      .innerJoin(registrations, eq(payments.registrationId, registrations.id))
      .where(
        and(
          eq(registrations.munId, munId),
          eq(payments.status, 'PAID'),
          inArray(registrations.status, REVENUE_REGISTRATION_STATUSES),
        ),
      )
      .groupBy(registrations.registrationProductId),
  ])

  const countByProduct = new Map(countRows.map((row) => [row.productId, Number(row.count)]))
  const moneyByProduct = new Map(
    revenueRows.map((row) => [row.productId, { collected: Number(row.collected), organizerNet: Number(row.organizerNet) }]),
  )

  const productAnalytics: ProductAnalytics[] = products.map((product) => ({
    productId: product.id,
    productName: product.name,
    price: product.price,
    capacity: product.capacity,
    registrationCount: countByProduct.get(product.id) ?? 0,
    revenue: moneyByProduct.get(product.id)?.collected ?? 0,
    organizerNet: moneyByProduct.get(product.id)?.organizerNet ?? 0,
  }))

  return {
    totalRegistrations: productAnalytics.reduce((total, product) => total + product.registrationCount, 0),
    totalRevenue: productAnalytics.reduce((total, product) => total + product.revenue, 0),
    totalOrganizerNet: productAnalytics.reduce((total, product) => total + product.organizerNet, 0),
    products: productAnalytics,
  }
}
