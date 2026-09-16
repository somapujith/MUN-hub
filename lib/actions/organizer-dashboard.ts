import { and, count, desc, eq, exists, inArray, sql, sum } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations } from '@/lib/db/schema'
import type { MunStatus, PaymentStatus } from '@/lib/db/schema-enums'

export interface MunOverview {
  totalRegistrations: number
  revenue: number
  pendingPayments: number
  availableSeats: number
}

const COUNTABLE_REGISTRATION_STATUSES = ['CONFIRMED', 'ATTENDED'] as const

/**
 * Seat-reserved-but-not-yet-paid statuses, for the workspace-wide "pending"
 * total below. Mirrors the Next app's now-superseded
 * `app/organizer/dashboard/(workspace)/workspace-data.ts#PENDING_STATUSES` —
 * that file is Next-coupled (`"server-only"`, React `cache()`) and out of
 * scope for the framework-agnostic `/lib` contract, so the aggregate lives
 * here instead, callable from both the Next app and the Hono API.
 */
const PENDING_REGISTRATION_STATUSES = ['PENDING', 'PAYMENT_PENDING'] as const

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

// ---------------------------------------------------------------------------
// Organizer-wide workspace overview (Overview + My MUNs pages)
// ---------------------------------------------------------------------------

export interface OrganizerWorkspaceMunSummary {
  id: string
  name: string
  slug: string
  edition: string | null
  status: MunStatus
  startDate: Date | null
  endDate: Date | null
  /** CONFIRMED/ATTENDED + PENDING/PAYMENT_PENDING for this mun. */
  registrationCount: number
  /** CONFIRMED/ATTENDED only. */
  confirmedCount: number
  /** Summed capacity of this mun's *active* registration products; 0 if none exist. */
  capacity: number
}

export interface OrganizerWorkspaceTotals {
  registrations: number
  confirmed: number
  pending: number
  capacity: number
  /** capacity - confirmed, floored at 0. */
  availableSeats: number
}

export interface OrganizerWorkspaceOverview {
  muns: OrganizerWorkspaceMunSummary[]
  totals: OrganizerWorkspaceTotals
}

/**
 * Organizer-wide dashboard data: every mun `session`'s user owns, plus
 * registration/capacity totals summed across all of them. Backs both the
 * Overview and My MUNs workspace pages (a single call covers both — My MUNs
 * just renders the `muns` array the Overview page also uses for totals).
 *
 * A fixed number of queries regardless of mun count, same approach as
 * `getMunOverview` above but grouped across the whole owned-mun id set
 * instead of a single mun.
 *
 * IDOR: `session.userId` is the only source of the organizer id — there is
 * no munId or organizerId parameter for a caller to widen. Throws
 * `Forbidden` for an unauthenticated caller.
 */
export async function getOrganizerWorkspaceOverview(session: Session | null): Promise<OrganizerWorkspaceOverview> {
  if (!session) throw new Error('Forbidden')

  const emptyTotals: OrganizerWorkspaceTotals = {
    registrations: 0,
    confirmed: 0,
    pending: 0,
    capacity: 0,
    availableSeats: 0,
  }

  const ownedMuns = await db
    .select({
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      edition: muns.edition,
      status: muns.status,
      startDate: muns.startDate,
      endDate: muns.endDate,
    })
    .from(muns)
    .where(eq(muns.organizerId, session.userId))
    .orderBy(desc(muns.createdAt))

  if (ownedMuns.length === 0) {
    return { muns: [], totals: emptyTotals }
  }

  const munIds = ownedMuns.map((mun) => mun.id)

  const [statusCounts, products] = await Promise.all([
    db
      .select({ munId: registrations.munId, status: registrations.status, total: count() })
      .from(registrations)
      .where(
        and(
          inArray(registrations.munId, munIds),
          inArray(registrations.status, [...COUNTABLE_REGISTRATION_STATUSES, ...PENDING_REGISTRATION_STATUSES]),
        ),
      )
      .groupBy(registrations.munId, registrations.status),
    db
      .select({ munId: registrationProducts.munId, capacity: registrationProducts.capacity, status: registrationProducts.status })
      .from(registrationProducts)
      .where(inArray(registrationProducts.munId, munIds)),
  ])

  const confirmedByMun = new Map<string, number>()
  const pendingByMun = new Map<string, number>()
  const countableStatuses: readonly string[] = COUNTABLE_REGISTRATION_STATUSES
  for (const row of statusCounts) {
    const bucket = countableStatuses.includes(row.status) ? confirmedByMun : pendingByMun
    bucket.set(row.munId, (bucket.get(row.munId) ?? 0) + row.total)
  }

  const capacityByMun = new Map<string, number>()
  for (const product of products) {
    // An inactive product isn't selling, so its seats aren't available.
    // Mirrors the same rule the marketplace and the Next workspace-data
    // aggregate both apply.
    if (product.status !== 'active') continue
    capacityByMun.set(product.munId, (capacityByMun.get(product.munId) ?? 0) + product.capacity)
  }

  const summaries: OrganizerWorkspaceMunSummary[] = ownedMuns.map((mun) => {
    const confirmedCount = confirmedByMun.get(mun.id) ?? 0
    const pendingCount = pendingByMun.get(mun.id) ?? 0
    return {
      ...mun,
      confirmedCount,
      registrationCount: confirmedCount + pendingCount,
      capacity: capacityByMun.get(mun.id) ?? 0,
    }
  })

  const confirmed = sumBy(summaries, (row) => row.confirmedCount)
  const totalRegistrations = sumBy(summaries, (row) => row.registrationCount)
  const capacity = sumBy(summaries, (row) => row.capacity)

  return {
    muns: summaries,
    totals: {
      registrations: totalRegistrations,
      confirmed,
      pending: totalRegistrations - confirmed,
      capacity,
      availableSeats: Math.max(capacity - confirmed, 0),
    },
  }
}

function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0)
}
