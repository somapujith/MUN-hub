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

munsRoutes.get('/', async (c) => {
  const params = searchQuerySchema.parse(pickSearchQuery(c.req.query()))
  const result = await searchMuns(params)
  return c.json(result)
})

munsRoutes.get('/facets', async (c) => {
  const facets = await getMarketplaceFacets()
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

  const includeInactive = await resolveIncludeInactive(
    mun.id,
    c.req.query('includeInactive'),
    c.get('session'),
  )

  if (!includeInactive) {
    return c.json(mun.registrationProducts)
  }

  const products = await listRegistrationProducts(mun.id, { includeInactive: true })
  return c.json(products)
})

munsRoutes.get('/:slug', async (c) => {
  const { slug } = slugParamSchema.parse({ slug: c.req.param('slug') })
  const mun = await getMunBySlug(slug)

  if (!mun) {
    throw new Error('Mun not found')
  }

  return c.json(mun)
})
