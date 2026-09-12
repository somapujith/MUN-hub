'use server'

import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, portfolios, registrationProducts, users } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import type { MunDetail, MunSummary } from '@/lib/types'

/**
 * Statuses visible to the public marketplace by default. Every other status
 * (DRAFT, SUBMITTED, UNDER_REVIEW, REJECTED, CHANGES_REQUESTED, ONBOARDING,
 * CONTENT_SUBMITTED, VERIFICATION) is an internal/pre-publication state and
 * must never be shown to anonymous visitors.
 */
const DEFAULT_PUBLIC_STATUSES: MunStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
]

/** Statuses considered "publicly visible" for getMunBySlug (PUBLISHED and later lifecycle states). */
const PUBLIC_DETAIL_STATUSES: MunStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CONFERENCE_ACTIVE',
  'COMPLETED',
  'ARCHIVED',
]

export interface MunSearchParams {
  query?: string
  city?: string
  country?: string
  minPrice?: number
  maxPrice?: number
  sortBy?: 'date' | 'price' | 'newest'
  status?: MunStatus[]
  limit?: number
  offset?: number
}

export interface MunSearchResult {
  results: MunSummary[]
  total: number
}

/**
 * Per-mun cheapest active registration product price, as a subquery so it can
 * be joined, filtered, and sorted on in the outer query.
 */
function minPriceSubquery() {
  return db
    .select({
      munId: registrationProducts.munId,
      minPrice: sql<number>`min(${registrationProducts.price})`.as('min_price'),
    })
    .from(registrationProducts)
    .where(eq(registrationProducts.status, 'active'))
    .groupBy(registrationProducts.munId)
    .as('min_price_sq')
}

/**
 * Searches publicly-visible MUNs with text/city/country/price filters,
 * pagination, and sorting. Never returns DRAFT/SUBMITTED/etc rows unless the
 * caller explicitly overrides `status` (internal use only — no caller in the
 * public marketplace UI should ever pass a non-public status).
 */
export async function searchMuns(params: MunSearchParams): Promise<MunSearchResult> {
  const statuses = params.status ?? DEFAULT_PUBLIC_STATUSES
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0

  const priceSq = minPriceSubquery()

  const conditions = [inArray(muns.status, statuses)]

  if (params.city) {
    conditions.push(eq(muns.city, params.city))
  }
  if (params.country) {
    conditions.push(eq(muns.country, params.country))
  }
  if (params.query) {
    const pattern = `%${params.query}%`
    conditions.push(
      or(ilike(muns.name, pattern), ilike(muns.city, pattern)) ?? sql`true`,
    )
  }
  if (params.minPrice !== undefined) {
    conditions.push(gte(priceSq.minPrice, params.minPrice))
  }
  if (params.maxPrice !== undefined) {
    conditions.push(lte(priceSq.minPrice, params.maxPrice))
  }

  const whereClause = and(...conditions)

  const orderByClause =
    params.sortBy === 'price'
      ? [asc(priceSq.minPrice)]
      : params.sortBy === 'newest'
        ? [desc(muns.createdAt)]
        : [asc(muns.startDate)]

  const rows = await db
    .select({
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      city: muns.city,
      country: muns.country,
      startDate: muns.startDate,
      endDate: muns.endDate,
      status: muns.status,
      minPrice: priceSq.minPrice,
      organizerName: users.name,
    })
    .from(muns)
    .leftJoin(priceSq, eq(priceSq.munId, muns.id))
    .leftJoin(users, eq(users.id, muns.organizerId))
    .where(whereClause)
    .orderBy(...orderByClause)
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(muns)
    .leftJoin(priceSq, eq(priceSq.munId, muns.id))
    .where(whereClause)

  const results: MunSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    city: row.city,
    country: row.country,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    minPrice: row.minPrice ?? null,
    // No cover-image column exists on `muns` yet — see final report note.
    coverImage: null,
    organizerName: row.organizerName ?? null,
  }))

  return { results, total: count }
}

/**
 * Full MUN detail for the public MUN detail page: mun row, committees with
 * nested portfolios, active registration products, organizer name. Returns
 * null if the slug doesn't exist OR the mun is in an internal/pre-publication
 * state (DRAFT, SUBMITTED, UNDER_REVIEW, REJECTED, CHANGES_REQUESTED,
 * ONBOARDING, CONTENT_SUBMITTED, VERIFICATION) — those must never be visible
 * to the public even if someone knows the slug.
 */
export async function getMunBySlug(slug: string): Promise<MunDetail | null> {
  const [mun] = await db.select().from(muns).where(eq(muns.slug, slug)).limit(1)

  if (!mun || !PUBLIC_DETAIL_STATUSES.includes(mun.status)) {
    return null
  }

  const [organizer, committeeRows, activeProducts] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, mun.organizerId)).limit(1),
    db.select().from(committees).where(eq(committees.munId, mun.id)),
    db
      .select()
      .from(registrationProducts)
      .where(and(eq(registrationProducts.munId, mun.id), eq(registrationProducts.status, 'active'))),
  ])

  const committeeIds = committeeRows.map((c) => c.id)
  const portfolioRows = committeeIds.length
    ? await db.select().from(portfolios).where(inArray(portfolios.committeeId, committeeIds))
    : []

  const portfoliosByCommittee = new Map<string, typeof portfolioRows>()
  for (const portfolio of portfolioRows) {
    const existing = portfoliosByCommittee.get(portfolio.committeeId) ?? []
    portfoliosByCommittee.set(portfolio.committeeId, [...existing, portfolio])
  }

  return {
    ...mun,
    committees: committeeRows.map((committee) => ({
      ...committee,
      portfolios: portfoliosByCommittee.get(committee.id) ?? [],
    })),
    registrationProducts: activeProducts,
    organizerName: organizer[0]?.name ?? null,
  }
}

/** Distinct city/country values across publicly-visible muns, for filter dropdowns. */
export async function getMarketplaceFacets(): Promise<{ cities: string[]; countries: string[] }> {
  const [cityRows, countryRows] = await Promise.all([
    db
      .selectDistinct({ city: muns.city })
      .from(muns)
      .where(and(inArray(muns.status, DEFAULT_PUBLIC_STATUSES), sql`${muns.city} is not null`)),
    db
      .selectDistinct({ country: muns.country })
      .from(muns)
      .where(and(inArray(muns.status, DEFAULT_PUBLIC_STATUSES), sql`${muns.country} is not null`)),
  ])

  return {
    cities: cityRows.map((r) => r.city).filter((c): c is string => c !== null).sort(),
    countries: countryRows.map((r) => r.country).filter((c): c is string => c !== null).sort(),
  }
}
