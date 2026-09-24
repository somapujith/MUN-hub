import { Hono } from 'hono'
import { z } from 'zod'
import { getMarketplaceFacets, getMunBySlug, searchMuns } from '@/lib/actions/marketplace'
import { listRegistrationProducts } from '@/lib/actions/mun-config'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { munStatusEnum } from '@/lib/db/schema-enums'
import type { AppVariables } from '../src/types'

const munStatusSchema = z.enum(munStatusEnum.enumValues)

// Any status value is accepted here, but searchMuns clips the list to the
// publicly visible statuses — `?status=DRAFT` answers with no results, never
// with draft muns.
const searchQuerySchema = z
  .object({
    query: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    sortBy: z.enum(['date', 'deadline', 'price', 'newest']).optional(),
    status: z
      .union([munStatusSchema, z.array(munStatusSchema)])
      .optional()
      .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const slugParamSchema = z
  .object({
    slug: z.string().min(1),
  })
  .strict()

/** Empty query-string values (`?city=`) mean "no filter", not an empty-string match. */
function presentOrUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

function pickSearchQuery(query: Record<string, string>) {
  const statusRaw = presentOrUndefined(query.status)
  const status =
    statusRaw === undefined
      ? undefined
      : statusRaw.includes(',')
        ? statusRaw.split(',').map((part) => part.trim()).filter(Boolean)
        : statusRaw

  return {
    query: presentOrUndefined(query.query),
    city: presentOrUndefined(query.city),
    country: presentOrUndefined(query.country),
    minPrice: presentOrUndefined(query.minPrice),
    maxPrice: presentOrUndefined(query.maxPrice),
    dateFrom: presentOrUndefined(query.dateFrom),
    dateTo: presentOrUndefined(query.dateTo),
    sortBy: presentOrUndefined(query.sortBy),
    status,
    limit: presentOrUndefined(query.limit),
    offset: presentOrUndefined(query.offset),
  }
}

async function resolveIncludeInactive(
  munId: string,
  raw: string | undefined,
  session: AppVariables['session'],
): Promise<boolean> {
  if (raw !== 'true') {
    return false
  }

  try {
    await assertOwnsOrAdmin(munId, session)
    return true
  } catch {
    return false
  }
}

export const munsRoutes = new Hono<{ Variables: AppVariables }>()

// Public, anonymous, non-personalized: searchMuns always clips to the
// publicly-visible statuses regardless of caller, and this handler never
// reads `c.get('session')`, so the response is identical for every caller of
// the same query string — safe for Cloudflare's edge cache and browsers to
// share. Short-ish TTL since price/capacity/newly-published listings can
// change; `stale-while-revalidate` means a cache hit is never blocked behind
// a fresh Neon round trip.
const MARKETPLACE_LIST_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
// Facets (distinct city/country values) change only when a MUN in a new
// city/country is published — much lower churn than the listing itself.
const MARKETPLACE_FACETS_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=7200'

munsRoutes.get('/', async (c) => {
  const params = searchQuerySchema.parse(pickSearchQuery(c.req.query()))
  const result = await searchMuns(params)
  c.header('Cache-Control', MARKETPLACE_LIST_CACHE)
  return c.json(result)
})

munsRoutes.get('/facets', async (c) => {
  const facets = await getMarketplaceFacets()
  c.header('Cache-Control', MARKETPLACE_FACETS_CACHE)
  return c.json(facets)
})

// This path shape is shared with the organizer's by-id listing,
// `GET /muns/:munId/products` (server/routes/mun-config.ts), which is mounted
// after this router. When the segment isn't the slug of a publicly visible
// mun, fall through to that handler instead of answering "Mun not found" —
// otherwise the by-id route is unreachable.
munsRoutes.get('/:slug/products', async (c, next) => {
  const { slug } = slugParamSchema.parse({ slug: c.req.param('slug') })

  const mun = await getMunBySlug(slug)
  if (!mun) {
    await next()
    return
  }

  const rawIncludeInactive = c.req.query('includeInactive')
  const includeInactive = await resolveIncludeInactive(mun.id, rawIncludeInactive, c.get('session'))

  if (!includeInactive) {
    // Only cache when the URL itself is unambiguous. With no `includeInactive`
    // param, resolveIncludeInactive never even looks at the session, so this
    // exact URL always serves the same public list to every caller — same
    // shape as GET /:slug, safe to cache. A URL that DOES carry
    // `?includeInactive=true` can serve two different bodies for the exact
    // same URL depending on who's asking (owner/staff vs. everyone else, who
    // gets silently downgraded to this branch) — a shared edge/browser cache
    // can't key on session, so caching a downgraded response here risks the
    // owner later being served a stale public-only list from the cache.
    c.header('Cache-Control', rawIncludeInactive === 'true' ? 'no-store' : MARKETPLACE_LIST_CACHE)
    return c.json(mun.registrationProducts)
  }

  // Owner/staff branch: archived/inactive products, session-dependent. Never
  // cache — would leak inactive products to the public if ever served back
  // from a shared cache.
  c.header('Cache-Control', 'no-store')
  const products = await listRegistrationProducts(mun.id, { includeInactive: true })
  return c.json(products)
})

// Public, anonymous, non-personalized: getMunBySlug only ever returns
// publicly-visible-status muns (never reads session), so this response is
// identical for every caller. Detail content (dates, venue, description,
// committees) changes far less often than the listing, so it gets a longer
// TTL.
const MUN_DETAIL_CACHE = 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'

munsRoutes.get('/:slug', async (c) => {
  const { slug } = slugParamSchema.parse({ slug: c.req.param('slug') })
  const mun = await getMunBySlug(slug)

  if (!mun) {
    throw new Error('Mun not found')
  }

  c.header('Cache-Control', MUN_DETAIL_CACHE)
  return c.json(mun)
})
