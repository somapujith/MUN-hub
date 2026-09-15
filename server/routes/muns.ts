import { Hono } from 'hono'
import { z } from 'zod'
import { getMunBySlug, searchMuns } from '@/lib/actions/marketplace'
import { listRegistrationProducts } from '@/lib/actions/mun-config'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { munStatusEnum } from '@/lib/db/schema-enums'
import type { AppVariables } from '../src/types'

const munStatusSchema = z.enum(munStatusEnum.enumValues)

const searchQuerySchema = z
  .object({
    query: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    sortBy: z.enum(['date', 'price', 'newest']).optional(),
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

function pickSearchQuery(query: Record<string, string>) {
  const statusRaw = query.status
  const status =
    statusRaw === undefined
      ? undefined
      : statusRaw.includes(',')
        ? statusRaw.split(',').map((part) => part.trim()).filter(Boolean)
        : statusRaw

  return {
    query: query.query,
    city: query.city,
    country: query.country,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sortBy: query.sortBy,
    status,
    limit: query.limit,
    offset: query.offset,
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

munsRoutes.get('/:slug/products', async (c) => {
  const { slug } = slugParamSchema.parse({ slug: c.req.param('slug') })

  const mun = await getMunBySlug(slug)
  if (!mun) {
    throw new Error('Mun not found')
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
