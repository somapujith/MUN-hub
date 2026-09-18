import { and, desc, eq, gte, inArray, lte, sql, type Column } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrations, users } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { countedPaymentsFilter } from '@/lib/payments/counted-payments'
import { organizerNetAmountSql, REVENUE_REGISTRATION_STATUSES } from '@/lib/actions/mun-analytics'
import { LIVE_MUN_STATUSES } from '@/lib/actions/admin-analytics'

// -----------------------------------------------------------------------------
// admin-reporting — the admin console's "Analytics" section: time-series
// trends, a registration/payment conversion funnel, top-conference and
// organizer leaderboards, a geography breakdown, and a platform-fee summary.
//
// Distinct from admin-analytics.ts (all-time platform totals for the /admin
// Overview cards) — this file is the date-ranged reporting suite behind it.
// Every function is staff-only (OPERATIONS/ADMIN/SUPER_ADMIN, via
// `requireRole`) and every query counts real money the same way the rest of
// the app does: `countedPaymentsFilter()` excludes mock-provider payments,
// and money reuses `organizerNetAmountSql` from mun-analytics.ts rather than
// re-deriving "net of platform fee" a second time.
// -----------------------------------------------------------------------------

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export const REPORTING_RANGE_DAYS = [7, 30, 90] as const
export type ReportingRangeDays = (typeof REPORTING_RANGE_DAYS)[number]
export type TrendGranularity = 'day' | 'week'

/** Statuses that mean a MUN has been live at least once — a lifetime count, not range-scoped. */
const EVER_PUBLISHED_MUN_STATUSES: MunStatus[] = [
  ...LIVE_MUN_STATUSES,
  'UNPUBLISHED',
  'RESULTS_PENDING',
  'RESULTS_UNDER_REVIEW',
  'COMPLETED',
  'ARCHIVED',
]

function rangeStart(now: Date, days: ReportingRangeDays): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Date-bucket helpers (UTC, matching the SQL side's `date_trunc(_, _, 'UTC')`)
// so every trend series is zero-filled — a day/week with no rows still shows
// a 0 point instead of a gap in the line.
// ---------------------------------------------------------------------------

function truncateUtc(date: Date, granularity: TrendGranularity): Date {
  const truncated = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  if (granularity === 'day') return truncated
  // ISO week, Monday start. getUTCDay(): 0 = Sunday .. 6 = Saturday.
  const day = truncated.getUTCDay()
  const diffToMonday = (day === 0 ? -6 : 1) - day
  truncated.setUTCDate(truncated.getUTCDate() + diffToMonday)
  return truncated
}

function stepBucket(date: Date, granularity: TrendGranularity): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + (granularity === 'day' ? 1 : 7))
  return next
}

function bucketKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Every bucket start from `start` through `end` (both truncated), inclusive. */
function generateBuckets(start: Date, end: Date, granularity: TrendGranularity): string[] {
  const buckets: string[] = []
  let cursor = truncateUtc(start, granularity)
  const last = truncateUtc(end, granularity)
  // A day range under 1 bucket (e.g. `start`/`end` land in the same week)
  // still yields exactly one bucket via the `<=` bound below.
  while (cursor.getTime() <= last.getTime()) {
    buckets.push(bucketKey(cursor))
    cursor = stepBucket(cursor, granularity)
  }
  return buckets
}

/** The grouped-by-date SQL expression every trend query buckets on. */
function dateTruncBucket(column: Column, granularity: TrendGranularity) {
  return sql<string>`to_char(date_trunc(${granularity}, ${column}, 'UTC'), 'YYYY-MM-DD')`
}

export interface TrendPoint {
  /** UTC bucket start, `YYYY-MM-DD`. For `week`, the Monday the ISO week starts on. */
  bucket: string
  value: number
}

function zeroFillSeries(buckets: string[], byBucket: Map<string, number>): TrendPoint[] {
  return buckets.map((bucket) => ({ bucket, value: byBucket.get(bucket) ?? 0 }))
}

// ---------------------------------------------------------------------------
// 1a. Registration trend
// ---------------------------------------------------------------------------

/**
 * Registrations created per day/week over the selected range — every
 * registration counts once, at creation, regardless of its current status
 * (mirrors the funnel's "started" definition below). One grouped query.
 */
export async function getRegistrationTrend(
  params: { days: ReportingRangeDays; granularity: TrendGranularity },
  session: Session | null,
  now: Date = new Date(),
): Promise<TrendPoint[]> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)
  const buckets = generateBuckets(start, now, params.granularity)

  const bucketExpr = dateTruncBucket(registrations.createdAt, params.granularity)
  const rows = await db
    .select({ bucket: bucketExpr, value: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(gte(registrations.createdAt, start), lte(registrations.createdAt, now)))
    // Group by ordinal position (1 = `bucket`), not by repeating `bucketExpr`:
    // drizzle re-parameterizes the same `sql` object independently in SELECT
    // vs GROUP BY, so `date_trunc($1, ...)` in one and `date_trunc($4, ...)`
    // in the other are, to Postgres, two syntactically different expressions
    // it refuses to treat as the same group-by key ("column must appear in
    // the GROUP BY clause" even though both bind to the same value).
    .groupBy(sql`1`)

  return zeroFillSeries(buckets, new Map(rows.map((row) => [row.bucket, Number(row.value)])))
}

// ---------------------------------------------------------------------------
// 1b. Revenue trend (gross + net-of-fee)
// ---------------------------------------------------------------------------

export interface RevenueTrend {
  /** Sum of `payments.amount` — what delegates paid. */
  gross: TrendPoint[]
  /** Sum of `organizerNetAmountSql` — gross minus the platform fee and GST on it. */
  net: TrendPoint[]
}

/**
 * Revenue collected per day/week, gross and net-of-platform-fee, over the
 * selected range. PAID, non-mock payments only (`countedPaymentsFilter`).
 * One grouped query producing both sums per bucket.
 */
export async function getRevenueTrend(
  params: { days: ReportingRangeDays; granularity: TrendGranularity },
  session: Session | null,
  now: Date = new Date(),
): Promise<RevenueTrend> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)
  const buckets = generateBuckets(start, now, params.granularity)

  const bucketExpr = dateTruncBucket(payments.createdAt, params.granularity)
  const rows = await db
    .select({
      bucket: bucketExpr,
      gross: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`,
      net: sql<number>`coalesce(sum(${organizerNetAmountSql}), 0)::bigint`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'PAID'),
        gte(payments.createdAt, start),
        lte(payments.createdAt, now),
        countedPaymentsFilter(),
      ),
    )
    // See the ordinal-groupBy comment in getRegistrationTrend above.
    .groupBy(sql`1`)

  const grossByBucket = new Map(rows.map((row) => [row.bucket, Number(row.gross)]))
  const netByBucket = new Map(rows.map((row) => [row.bucket, Number(row.net)]))
  return {
    gross: zeroFillSeries(buckets, grossByBucket),
    net: zeroFillSeries(buckets, netByBucket),
  }
}

// ---------------------------------------------------------------------------
// 1c. Signup trend (new organizers + new delegates)
// ---------------------------------------------------------------------------

export interface SignupTrend {
  organizers: TrendPoint[]
  delegates: TrendPoint[]
}

/**
 * New ORGANIZER and new STUDENT accounts created per day/week over the
 * selected range. One grouped query (bucket x role), split by role in JS.
 */
export async function getSignupTrend(
  params: { days: ReportingRangeDays; granularity: TrendGranularity },
  session: Session | null,
  now: Date = new Date(),
): Promise<SignupTrend> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)
  const buckets = generateBuckets(start, now, params.granularity)

  const bucketExpr = dateTruncBucket(users.createdAt, params.granularity)
  const rows = await db
    .select({ bucket: bucketExpr, role: users.role, value: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        inArray(users.role, ['ORGANIZER', 'STUDENT']),
        gte(users.createdAt, start),
        lte(users.createdAt, now),
      ),
    )
    // Ordinal position (1 = `bucket`, 2 = `role`). See the comment in
    // getRegistrationTrend above.
    .groupBy(sql`1`, sql`2`)

  const organizerByBucket = new Map(
    rows.filter((row) => row.role === 'ORGANIZER').map((row) => [row.bucket, Number(row.value)]),
  )
  const delegateByBucket = new Map(
    rows.filter((row) => row.role === 'STUDENT').map((row) => [row.bucket, Number(row.value)]),
  )
  return {
    organizers: zeroFillSeries(buckets, organizerByBucket),
    delegates: zeroFillSeries(buckets, delegateByBucket),
  }
}

// ---------------------------------------------------------------------------
// 2. Conversion funnel
// ---------------------------------------------------------------------------

export interface RegistrationFunnel {
  /** Every registration created in the range — every one starts PENDING. */
  started: number
  /** Currently CONFIRMED, ATTENDED or NO_SHOW. */
  confirmed: number
  /** Currently CANCELLED — the seat hold expired or the payment failed. */
  cancelled: number
  /** `confirmed / started`, 0 when `started` is 0. */
  conversionRate: number
}

export interface PaymentFunnel {
  totalPayments: number
  paid: number
  failed: number
  /** `paid / (paid + failed)`, 0 when both are 0. */
  successRate: number
  /** Payments with an open or resolved exception raised against them. */
  exceptionsOpened: number
  /** `exceptionsOpened / totalPayments`, 0 when `totalPayments` is 0. */
  exceptionRate: number
}

export interface ConversionFunnel {
  registrations: RegistrationFunnel
  payments: PaymentFunnel
}

/**
 * Registration and payment conversion for the selected range. Two single-row
 * aggregate queries (one `count(*) filter (where ...)` per bucket, no
 * `GROUP BY` needed since each is a single total).
 */
export async function getConversionFunnel(
  params: { days: ReportingRangeDays },
  session: Session | null,
  now: Date = new Date(),
): Promise<ConversionFunnel> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)

  // "Confirmed" reuses the same status set mun-analytics.ts/admin-analytics.ts
  // treat as a standing, revenue-eligible registration.
  const confirmedCondition = inArray(registrations.status, REVENUE_REGISTRATION_STATUSES)
  const cancelledCondition = eq(registrations.status, 'CANCELLED')
  const paidCondition = eq(payments.status, 'PAID')
  const failedCondition = eq(payments.status, 'FAILED')
  const exceptionCondition = sql`${payments.exceptionRaisedAt} is not null`

  const [[registrationRow], [paymentRow]] = await Promise.all([
    db
      .select({
        started: sql<number>`count(*)::int`,
        confirmed: sql<number>`count(*) filter (where ${confirmedCondition})::int`,
        cancelled: sql<number>`count(*) filter (where ${cancelledCondition})::int`,
      })
      .from(registrations)
      .where(and(gte(registrations.createdAt, start), lte(registrations.createdAt, now))),
    db
      .select({
        totalPayments: sql<number>`count(*)::int`,
        paid: sql<number>`count(*) filter (where ${paidCondition})::int`,
        failed: sql<number>`count(*) filter (where ${failedCondition})::int`,
        exceptionsOpened: sql<number>`count(*) filter (where ${exceptionCondition})::int`,
      })
      .from(payments)
      .where(and(gte(payments.createdAt, start), lte(payments.createdAt, now), countedPaymentsFilter())),
  ])

  const started = registrationRow?.started ?? 0
  const confirmed = registrationRow?.confirmed ?? 0
  const cancelled = registrationRow?.cancelled ?? 0
  const totalPayments = paymentRow?.totalPayments ?? 0
  const paid = paymentRow?.paid ?? 0
  const failed = paymentRow?.failed ?? 0
  const exceptionsOpened = paymentRow?.exceptionsOpened ?? 0

  return {
    registrations: {
      started,
      confirmed,
      cancelled,
      conversionRate: started > 0 ? confirmed / started : 0,
    },
    payments: {
      totalPayments,
      paid,
      failed,
      successRate: paid + failed > 0 ? paid / (paid + failed) : 0,
      exceptionsOpened,
      exceptionRate: totalPayments > 0 ? exceptionsOpened / totalPayments : 0,
    },
  }
}

// ---------------------------------------------------------------------------
// 3. Top conferences
// ---------------------------------------------------------------------------

const TOP_N = 10

export interface TopConferenceRow {
  munId: string
  name: string
  slug: string
  value: number
}

export interface TopConferences {
  byRegistrations: TopConferenceRow[]
  byRevenue: TopConferenceRow[]
}

/**
 * Top 10 conferences by registration count and top 10 by revenue, both
 * scoped to the selected range. Two single-purpose grouped queries.
 */
export async function getTopConferences(
  params: { days: ReportingRangeDays },
  session: Session | null,
  now: Date = new Date(),
): Promise<TopConferences> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)

  const [byRegistrations, byRevenue] = await Promise.all([
    db
      .select({
        munId: muns.id,
        name: muns.name,
        slug: muns.slug,
        value: sql<number>`count(*)::int`,
      })
      .from(registrations)
      .innerJoin(muns, eq(muns.id, registrations.munId))
      .where(and(gte(registrations.createdAt, start), lte(registrations.createdAt, now)))
      .groupBy(muns.id, muns.name, muns.slug)
      .orderBy(desc(sql`count(*)`))
      .limit(TOP_N),
    db
      .select({
        munId: muns.id,
        name: muns.name,
        slug: muns.slug,
        value: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`,
      })
      .from(payments)
      .innerJoin(registrations, eq(registrations.id, payments.registrationId))
      .innerJoin(muns, eq(muns.id, registrations.munId))
      .where(
        and(
          eq(payments.status, 'PAID'),
          inArray(registrations.status, REVENUE_REGISTRATION_STATUSES),
          gte(payments.createdAt, start),
          lte(payments.createdAt, now),
          countedPaymentsFilter(),
        ),
      )
      .groupBy(muns.id, muns.name, muns.slug)
      .orderBy(desc(sql`coalesce(sum(${payments.amount}), 0)`))
      .limit(TOP_N),
  ])

  return {
    byRegistrations: byRegistrations.map((row) => ({ ...row, value: Number(row.value) })),
    byRevenue: byRevenue.map((row) => ({ ...row, value: Number(row.value) })),
  }
}

// ---------------------------------------------------------------------------
// 4. Organizer leaderboard
// ---------------------------------------------------------------------------

export interface OrganizerLeaderboardRow {
  organizerId: string
  name: string
  email: string
  value: number
}

export interface OrganizerLeaderboard {
  /** Lifetime count of muns that have ever gone live — not range-scoped. */
  byConferencesPublished: OrganizerLeaderboardRow[]
  /** Revenue generated in the selected range. */
  byRevenue: OrganizerLeaderboardRow[]
}

/**
 * Top 10 organizers by total conferences ever published (lifetime — a
 * MUN's "ever live" status doesn't reset when it later unpublishes or
 * completes) and top 10 by revenue generated in the selected range. Two
 * single-purpose grouped queries.
 */
export async function getOrganizerLeaderboard(
  params: { days: ReportingRangeDays },
  session: Session | null,
  now: Date = new Date(),
): Promise<OrganizerLeaderboard> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)

  const [byConferencesPublished, byRevenue] = await Promise.all([
    db
      .select({
        organizerId: users.id,
        name: users.name,
        email: users.email,
        value: sql<number>`count(*)::int`,
      })
      .from(muns)
      .innerJoin(users, eq(users.id, muns.organizerId))
      .where(inArray(muns.status, EVER_PUBLISHED_MUN_STATUSES))
      .groupBy(users.id, users.name, users.email)
      .orderBy(desc(sql`count(*)`))
      .limit(TOP_N),
    db
      .select({
        organizerId: users.id,
        name: users.name,
        email: users.email,
        value: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`,
      })
      .from(payments)
      .innerJoin(registrations, eq(registrations.id, payments.registrationId))
      .innerJoin(muns, eq(muns.id, registrations.munId))
      .innerJoin(users, eq(users.id, muns.organizerId))
      .where(
        and(
          eq(payments.status, 'PAID'),
          inArray(registrations.status, REVENUE_REGISTRATION_STATUSES),
          gte(payments.createdAt, start),
          lte(payments.createdAt, now),
          countedPaymentsFilter(),
        ),
      )
      .groupBy(users.id, users.name, users.email)
      .orderBy(desc(sql`coalesce(sum(${payments.amount}), 0)`))
      .limit(TOP_N),
  ])

  return {
    byConferencesPublished: byConferencesPublished.map((row) => ({ ...row, value: Number(row.value) })),
    byRevenue: byRevenue.map((row) => ({ ...row, value: Number(row.value) })),
  }
}

// ---------------------------------------------------------------------------
// 5. Geography
// ---------------------------------------------------------------------------

export interface GeographyRow {
  city: string | null
  country: string | null
  registrationCount: number
  revenue: number
}

/**
 * Registrations and revenue by MUN city, over the selected range. One query:
 * revenue is a left join whose ON clause carries the "counts as revenue"
 * conditions, so an unmatched or non-revenue registration contributes 0
 * rather than being dropped or double-counted (`payments` is at most one row
 * per registration).
 *
 * Grouped by city alone, not by (city, country): some organizer-created MUNs
 * only ever capture a city (the onboarding wizard's "host city" step has no
 * country field — see `lib/actions/organizer-application.ts`'s `city:
 * input.location`), leaving `muns.country` null, while other MUNs for the
 * same real-world city do have it set. Grouping by the raw tuple split one
 * city into two rows — e.g. "Hyderabad"/"India" and "Hyderabad"/null — purely
 * because of that missing field, not because they're different places.
 * `country` here is a best-effort display value (the newest non-null value
 * for the city, via `max()`, which SQL aggregates already skip nulls for)
 * rather than a second grouping key.
 */
export async function getGeographyBreakdown(
  params: { days: ReportingRangeDays },
  session: Session | null,
  now: Date = new Date(),
): Promise<GeographyRow[]> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)

  const rows = await db
    .select({
      city: muns.city,
      country: sql<string | null>`max(${muns.country})`,
      registrationCount: sql<number>`count(distinct ${registrations.id})::int`,
      revenue: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`,
    })
    .from(registrations)
    .innerJoin(muns, eq(muns.id, registrations.munId))
    .leftJoin(
      payments,
      and(
        eq(payments.registrationId, registrations.id),
        eq(payments.status, 'PAID'),
        inArray(registrations.status, REVENUE_REGISTRATION_STATUSES),
        countedPaymentsFilter(),
      ),
    )
    .where(and(gte(registrations.createdAt, start), lte(registrations.createdAt, now)))
    .groupBy(muns.city)
    .orderBy(desc(sql`count(distinct ${registrations.id})`))
    .limit(50)

  return rows.map((row) => ({ ...row, registrationCount: Number(row.registrationCount), revenue: Number(row.revenue) }))
}

// ---------------------------------------------------------------------------
// 6. Platform fee summary
// ---------------------------------------------------------------------------

export interface PlatformFeeSummaryRow {
  currency: string
  /** Sum of `payments.platformFeeAmount` over PAID, non-mock payments with a fee breakdown. */
  platformFeeTotal: number
  /** Sum of `payments.platformFeeTaxAmount` (GST on the platform fee) over the same set. */
  platformFeeTaxTotal: number
  paidPayments: number
}

/**
 * Platform fee (and GST on it) collected in the selected range, grouped by
 * currency. PAID, non-mock payments only. `sum()` ignores nulls, so a
 * pre-fee-model row (no breakdown) simply contributes nothing here rather
 * than needing to be filtered out explicitly.
 */
export async function getPlatformFeeSummary(
  params: { days: ReportingRangeDays },
  session: Session | null,
  now: Date = new Date(),
): Promise<PlatformFeeSummaryRow[]> {
  requireRole(session, [...ADMIN_ROLES])
  const start = rangeStart(now, params.days)

  const rows = await db
    .select({
      currency: payments.currency,
      platformFeeTotal: sql<number>`coalesce(sum(${payments.platformFeeAmount}), 0)::bigint`,
      platformFeeTaxTotal: sql<number>`coalesce(sum(${payments.platformFeeTaxAmount}), 0)::bigint`,
      paidPayments: sql<number>`count(*) filter (where ${payments.platformFeeAmount} is not null)::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'PAID'),
        gte(payments.createdAt, start),
        lte(payments.createdAt, now),
        countedPaymentsFilter(),
      ),
    )
    .groupBy(payments.currency)
    .orderBy(desc(sql`coalesce(sum(${payments.platformFeeAmount}), 0)`))

  return rows.map((row) => ({
    ...row,
    platformFeeTotal: Number(row.platformFeeTotal),
    platformFeeTaxTotal: Number(row.platformFeeTaxTotal),
  }))
}
