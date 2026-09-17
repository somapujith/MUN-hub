import { and, asc, count, eq, inArray, sum } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { db } from '@/lib/db/client'
import { payments, registrationProducts, registrations } from '@/lib/db/schema'
import { countedPaymentsFilter } from '@/lib/payments/counted-payments'

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

export interface ProductAnalytics {
  productId: string
  productName: string
  price: number
  capacity: number
  registrationCount: number
  revenue: number
}

export interface MunAnalytics {
  totalRegistrations: number
  totalRevenue: number
  products: ProductAnalytics[]
}

/**
 * Registration counts and revenue for one mun, grouped by registration
 * product. Two grouped aggregate queries (counts, revenue) run in parallel
 * against the product list, then merge in memory by product id — same
 * "batch the aggregates, don't N+1 per product" shape as
 * `getMunOverview`/`getDelegateList` in organizer-dashboard.ts.
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
      .select({ productId: registrations.registrationProductId, total: sum(payments.amount) })
      .from(payments)
      .innerJoin(registrations, eq(payments.registrationId, registrations.id))
      .where(and(eq(registrations.munId, munId), eq(payments.status, 'PAID'), countedPaymentsFilter()))
      .groupBy(registrations.registrationProductId),
  ])

  const countByProduct = new Map(countRows.map((row) => [row.productId, Number(row.count)]))
  const revenueByProduct = new Map(revenueRows.map((row) => [row.productId, row.total ? Number(row.total) : 0]))

  const productAnalytics: ProductAnalytics[] = products.map((product) => ({
    productId: product.id,
    productName: product.name,
    price: product.price,
    capacity: product.capacity,
    registrationCount: countByProduct.get(product.id) ?? 0,
    revenue: revenueByProduct.get(product.id) ?? 0,
  }))

  return {
    totalRegistrations: productAnalytics.reduce((total, product) => total + product.registrationCount, 0),
    totalRevenue: productAnalytics.reduce((total, product) => total + product.revenue, 0),
    products: productAnalytics,
  }
}
