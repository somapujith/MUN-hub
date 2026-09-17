import { and, asc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  committees,
  munContacts,
  munMedia,
  muns,
  portfolios,
  registrationProducts,
  users,
} from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import type {
  MunSummary,
  PublicCommittee,
  PublicMunDetail,
  PublicPortfolio,
} from '@/lib/types'
import { listFormFields } from './registration-form'

/**
 * Statuses the public marketplace lists by default. Every status outside
 * `PUBLICLY_VISIBLE_STATUSES` (DRAFT, SUBMITTED, UNDER_REVIEW, REJECTED,
 * CHANGES_REQUESTED, ONBOARDING, the whole Gate-2 content pipeline,
 * UNPUBLISHED, SUSPENDED, CANCELLED, ...) is an internal state and must never
 * be shown to anonymous visitors.
 */
const DEFAULT_PUBLIC_STATUSES: MunStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
]

/**
 * Every status in which a mun is publicly visible: PUBLISHED and the later
 * lifecycle states it moves through while staying live (registration, the
 * conference itself, results, completion, archive). getMunBySlug serves
 * exactly these, and searchMuns clips any caller-requested status list to
 * them.
 */
export const PUBLICLY_VISIBLE_STATUSES: readonly MunStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CONFERENCE_ACTIVE',
  'RESULTS_PENDING',
  'RESULTS_UNDER_REVIEW',
  'COMPLETED',
  'ARCHIVED',
]

/**
 * The same set under its older name, still used by `mun-read-access.ts` for
 * the published-or-owner by-id reads, so those reads and the slug page agree.
 */
export const PUBLIC_DETAIL_STATUSES = PUBLICLY_VISIBLE_STATUSES

export function isPubliclyVisibleStatus(status: MunStatus): boolean {
  return PUBLICLY_VISIBLE_STATUSES.includes(status)
}

/**
 * Narrows a caller-supplied status list to publicly visible statuses. An
 * absent list means "the default listing"; a list with nothing public left in
 * it stays empty (the search then returns nothing) rather than widening back
 * to the default.
 */
export function clipToPublicStatuses(requested: readonly MunStatus[] | undefined): MunStatus[] {
  if (requested === undefined) return [...DEFAULT_PUBLIC_STATUSES]
  return [...new Set(requested)].filter(isPubliclyVisibleStatus)
}

/**
 * Throws `Mun not found` unless `munId` names a publicly visible mun. For
 * public by-id reads (e.g. FAQs) — a hidden mun answers exactly like a
 * missing one.
 */
export async function assertMunPubliclyVisible(munId: string): Promise<void> {
  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || !isPubliclyVisibleStatus(mun.status)) {
    throw new Error('Mun not found')
  }
}

export type MunSortBy = 'date' | 'deadline' | 'price' | 'newest'

export interface MunSearchParams {
  /** Free text; every whitespace-separated term must match at least one searchable field. */
  query?: string
  city?: string
  country?: string
  minPrice?: number
  maxPrice?: number
  /** Only muns whose conference dates overlap [dateFrom, dateTo] (either bound optional). */
  dateFrom?: Date
  dateTo?: Date
  sortBy?: MunSortBy
  /** Clipped to PUBLICLY_VISIBLE_STATUSES — see clipToPublicStatuses. */
  status?: MunStatus[]
  limit?: number
  offset?: number
}

export interface MunSearchResult {
  results: MunSummary[]
  total: number
}

const MAX_QUERY_TERMS = 8

/** Escapes LIKE metacharacters so a user's `%` or `_` matches literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
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

/** URL of a mun's first media item of `kind`, as a correlated subquery on `muns.id`. */
function mediaUrlSql(kind: 'COVER' | 'LOGO') {
  return sql<string | null>`(
    select ${munMedia.url} from ${munMedia}
    where ${munMedia.munId} = ${muns.id} and ${munMedia.kind} = ${kind}
    order by ${munMedia.displayOrder} asc, ${munMedia.createdAt} asc
    limit 1
  )`
}

/**
 * Text match: every term has to hit at least one of the mun's name, city,
 * country or theme, or the organizer's name or institution.
 */
function textMatchCondition(query: string): SQL | undefined {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_TERMS)
  if (terms.length === 0) return undefined

  return and(
    ...terms.map((term) => {
      const pattern = `%${escapeLikePattern(term)}%`
      return or(
        ilike(muns.name, pattern),
        ilike(muns.city, pattern),
        ilike(muns.country, pattern),
        ilike(muns.theme, pattern),
        ilike(users.name, pattern),
        ilike(users.institution, pattern),
      )
    }),
  )
}

/**
 * Searches publicly-visible MUNs with text/city/country/price/date filters,
 * pagination, and sorting. Never returns a non-public mun: any `status` the
 * caller passes is clipped to PUBLICLY_VISIBLE_STATUSES first.
 */
export async function searchMuns(params: MunSearchParams): Promise<MunSearchResult> {
  const statuses = clipToPublicStatuses(params.status)
  if (statuses.length === 0) {
    return { results: [], total: 0 }
  }

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0

  const priceSq = minPriceSubquery()

  const conditions: (SQL | undefined)[] = [inArray(muns.status, statuses)]

  if (params.city) {
    conditions.push(eq(muns.city, params.city))
  }
  if (params.country) {
    conditions.push(eq(muns.country, params.country))
  }
  if (params.query) {
    conditions.push(textMatchCondition(params.query))
  }
  if (params.minPrice !== undefined) {
    conditions.push(gte(priceSq.minPrice, params.minPrice))
  }
  if (params.maxPrice !== undefined) {
    conditions.push(lte(priceSq.minPrice, params.maxPrice))
  }
  // Overlap test on [startDate, coalesce(endDate, startDate)]. A mun with no
  // dates yet never matches a date filter.
  if (params.dateFrom) {
    // Raw sql params skip drizzle's column encoder, so the Date is serialized here.
    conditions.push(
      sql`coalesce(${muns.endDate}, ${muns.startDate}) >= ${params.dateFrom.toISOString()}::timestamptz`,
    )
  }
  if (params.dateTo) {
    conditions.push(lte(muns.startDate, params.dateTo))
  }

  const whereClause = and(...conditions)

  const byStartDate = sql`${muns.startDate} asc nulls last`
  const orderByClause: SQL[] =
    params.sortBy === 'price'
      ? [sql`${priceSq.minPrice} asc nulls last`, byStartDate]
      : params.sortBy === 'newest'
        ? [sql`coalesce(${muns.publishedAt}, ${muns.createdAt}) desc`]
        : params.sortBy === 'deadline'
          ? [
              // Closing soonest: deadlines still ahead first (nearest first),
              // then muns with no deadline or one already passed.
              sql`(${muns.registrationDeadline} is null or ${muns.registrationDeadline} < now()) asc`,
              sql`${muns.registrationDeadline} asc nulls last`,
              byStartDate,
            ]
          : [byStartDate]

  const rows = await db
    .select({
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      city: muns.city,
      country: muns.country,
      startDate: muns.startDate,
      endDate: muns.endDate,
      registrationOpensAt: muns.registrationOpensAt,
      registrationDeadline: muns.registrationDeadline,
      status: muns.status,
      minPrice: priceSq.minPrice,
      organizerName: users.name,
      coverImage: mediaUrlSql('COVER'),
    })
    .from(muns)
    .leftJoin(priceSq, eq(priceSq.munId, muns.id))
    .leftJoin(users, eq(users.id, muns.organizerId))
    .where(whereClause)
    // id last: a stable tiebreaker so paging never repeats or skips a row.
    .orderBy(...orderByClause, asc(muns.id))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(muns)
    .leftJoin(priceSq, eq(priceSq.munId, muns.id))
    .leftJoin(users, eq(users.id, muns.organizerId))
    .where(whereClause)

  const results: MunSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    city: row.city,
    country: row.country,
    startDate: row.startDate,
    endDate: row.endDate,
    registrationOpensAt: row.registrationOpensAt,
    registrationDeadline: row.registrationDeadline,
    status: row.status,
    minPrice: row.minPrice ?? null,
    coverImage: row.coverImage ?? null,
    organizerName: row.organizerName ?? null,
  }))

  return { results, total: count }
}

/**
 * The `muns` columns getMunBySlug may return — mirrors `PublicMun` in
 * lib/types/mun.ts. Never spread `getTableColumns(muns)` here: that would
 * publish `organizerId` and any column added later.
 */
const PUBLIC_MUN_COLUMNS = {
  id: muns.id,
  name: muns.name,
  slug: muns.slug,
  edition: muns.edition,
  theme: muns.theme,
  description: muns.description,
  startDate: muns.startDate,
  endDate: muns.endDate,
  venue: muns.venue,
  addressLine1: muns.addressLine1,
  city: muns.city,
  addressState: muns.addressState,
  postalCode: muns.postalCode,
  country: muns.country,
  mapUrl: muns.mapUrl,
  conferenceType: muns.conferenceType,
  targetParticipantType: muns.targetParticipantType,
  registrationOpensAt: muns.registrationOpensAt,
  registrationDeadline: muns.registrationDeadline,
  accommodationProvided: muns.accommodationProvided,
  status: muns.status,
}

const PUBLIC_PRODUCT_COLUMNS = {
  id: registrationProducts.id,
  munId: registrationProducts.munId,
  name: registrationProducts.name,
  price: registrationProducts.price,
  currency: registrationProducts.currency,
  capacity: registrationProducts.capacity,
  deadline: registrationProducts.deadline,
  status: registrationProducts.status,
  registrationType: registrationProducts.registrationType,
  earlyBirdPrice: registrationProducts.earlyBirdPrice,
  earlyBirdDeadline: registrationProducts.earlyBirdDeadline,
  description: registrationProducts.description,
  allowsIndividual: registrationProducts.allowsIndividual,
  allowsDelegation: registrationProducts.allowsDelegation,
  displayOrder: registrationProducts.displayOrder,
  eligibility: registrationProducts.eligibility,
}

/**
 * Public MUN detail by slug: the allowlisted mun columns, committees with
 * nested portfolios, active registration products, the organizer's name,
 * cover/logo URLs, the official contact channels and the registration form.
 * Returns null if the slug doesn't exist OR the mun isn't publicly visible —
 * an internal-state mun must never be served, even to someone who knows its
 * slug.
 */
export async function getMunBySlug(slug: string): Promise<PublicMunDetail | null> {
  return loadPublicMunDetail(and(eq(muns.slug, slug), inArray(muns.status, [...PUBLICLY_VISIBLE_STATUSES]))!)
}

/**
 * The public detail page's data for a mun that may not be live yet, so its
 * organizer can see what delegates will see. Same allowlisted shape as
 * `getMunBySlug`, without the publication filter. Owning organizer or staff
 * only; anyone else gets `Error('Forbidden')`.
 */
export async function getMunPreview(munId: string, session: Session | null): Promise<PublicMunDetail> {
  if (!session) throw new Error('Forbidden')
  if (!(PREVIEW_STAFF_ROLES as readonly string[]).includes(session.role)) {
    await assertOwnsOrAdmin(munId, session)
  }
  const detail = await loadPublicMunDetail(eq(muns.id, munId))
  if (!detail) throw new Error('Mun not found')
  return detail
}

const PREVIEW_STAFF_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

async function loadPublicMunDetail(where: SQL): Promise<PublicMunDetail | null> {
  const [row] = await db
    .select({
      ...PUBLIC_MUN_COLUMNS,
      organizerName: users.name,
      coverImage: mediaUrlSql('COVER'),
      logo: mediaUrlSql('LOGO'),
    })
    .from(muns)
    .leftJoin(users, eq(users.id, muns.organizerId))
    .where(where)
    .limit(1)

  if (!row) {
    return null
  }

  const [committeeRows, activeProducts, contactRows, formFields] = await Promise.all([
    db
      .select({
        id: committees.id,
        munId: committees.munId,
        name: committees.name,
        agenda: committees.agenda,
        description: committees.description,
        capacity: committees.capacity,
        committeeType: committees.committeeType,
        portfoliosEnabled: committees.portfoliosEnabled,
      })
      .from(committees)
      .where(eq(committees.munId, row.id))
      .orderBy(asc(committees.createdAt), asc(committees.id)),
    db
      .select(PUBLIC_PRODUCT_COLUMNS)
      .from(registrationProducts)
      .where(and(eq(registrationProducts.munId, row.id), eq(registrationProducts.status, 'active')))
      .orderBy(asc(registrationProducts.displayOrder), asc(registrationProducts.createdAt)),
    db
      .select({
        officialEmail: munContacts.officialEmail,
        phone: munContacts.phone,
        website: munContacts.website,
      })
      .from(munContacts)
      .where(eq(munContacts.munId, row.id))
      .limit(1),
    listFormFields(row.id),
  ])

  const committeeIds = committeeRows.map((c) => c.id)
  const portfolioRows: PublicPortfolio[] = committeeIds.length
    ? await db
        .select({
          id: portfolios.id,
          committeeId: portfolios.committeeId,
          name: portfolios.name,
          type: portfolios.type,
          availability: portfolios.availability,
          description: portfolios.description,
          restrictions: portfolios.restrictions,
        })
        .from(portfolios)
        .where(inArray(portfolios.committeeId, committeeIds))
        .orderBy(asc(portfolios.createdAt), asc(portfolios.id))
    : []

  const portfoliosByCommittee = new Map<string, PublicPortfolio[]>()
  for (const portfolio of portfolioRows) {
    const existing = portfoliosByCommittee.get(portfolio.committeeId) ?? []
    portfoliosByCommittee.set(portfolio.committeeId, [...existing, portfolio])
  }

  const publicCommittees: PublicCommittee[] = committeeRows.map((committee) => ({
    ...committee,
    portfolios: portfoliosByCommittee.get(committee.id) ?? [],
  }))

  return {
    ...row,
    organizerName: row.organizerName ?? null,
    coverImage: row.coverImage ?? null,
    logo: row.logo ?? null,
    committees: publicCommittees,
    registrationProducts: activeProducts,
    contact: contactRows[0] ?? null,
    formFields,
  }
}

/**
 * Slug + updatedAt for every publicly-visible MUN, for sitemap generation.
 * Deliberately lightweight (no joins, no committees/products) since sitemap
 * generation can run frequently — don't reuse getMunBySlug/searchMuns here.
 */
export async function listPublicMunSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const rows = await db
    .select({ slug: muns.slug, updatedAt: muns.updatedAt })
    .from(muns)
    .where(inArray(muns.status, DEFAULT_PUBLIC_STATUSES))

  return rows
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
