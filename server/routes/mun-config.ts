import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createCommittee,
  createPortfolio,
  createRegistrationProduct,
  deleteCommittee,
  deletePortfolio,
  deleteRegistrationProduct,
  listCommittees,
  listPortfolios,
  listRegistrationProducts,
  updateCommittee,
  updateMunDetails,
  updatePortfolio,
  updateRegistrationProduct,
} from '@/lib/actions/mun-config'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const optionalDate = z.coerce.date().optional()
const nullableDate = z.union([z.coerce.date(), z.null()]).optional()

const createCommitteeBodySchema = z
  .object({
    name: z.string().min(1),
    agenda: z.string().optional(),
    description: z.string().optional(),
    capacity: z.number().int().positive(),
  })
  .strict()

const updateCommitteeBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    agenda: z.string().optional(),
    description: z.string().optional(),
    capacity: z.number().int().positive().optional(),
  })
  .strict()

const createPortfolioBodySchema = z
  .object({
    name: z.string().min(1),
    type: z.string().optional(),
    availability: z.number().int().nonnegative().optional(),
  })
  .strict()

const updatePortfolioBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.string().optional(),
    availability: z.number().int().nonnegative().optional(),
  })
  .strict()

const createRegistrationProductBodySchema = z
  .object({
    name: z.string().min(1),
    price: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    currency: z.string().optional(),
    deadline: optionalDate,
  })
  .strict()

const updateRegistrationProductBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    price: z.number().int().nonnegative().optional(),
    capacity: z.number().int().positive().optional(),
    currency: z.string().optional(),
    deadline: nullableDate,
    status: z.string().optional(),
  })
  .strict()

const updateMunDetailsBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    edition: z.string().nullable().optional(),
    theme: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    startDate: nullableDate,
    endDate: nullableDate,
    venue: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  })
  .strict()

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

export const munConfigRoutes = new Hono<{ Variables: AppVariables }>()

munConfigRoutes.get('/muns/:munId/committees', async (c) => {
  const committees = await listCommittees(c.req.param('munId'))
  return c.json(committees)
})

munConfigRoutes.post(
  '/muns/:munId/committees',
  requireAuth,
  zValidator('json', createCommitteeBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const committee = await createCommittee(
      { ...body, munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(committee, 201)
  },
)

munConfigRoutes.patch(
  '/committees/:committeeId',
  requireAuth,
  zValidator('json', updateCommitteeBodySchema),
  async (c) => {
    const committee = await updateCommittee(
      c.req.param('committeeId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(committee)
  },
)

munConfigRoutes.delete('/committees/:committeeId', requireAuth, async (c) => {
  await deleteCommittee(c.req.param('committeeId'), c.get('session'))
  return c.body(null, 204)
})

munConfigRoutes.get('/committees/:committeeId/portfolios', async (c) => {
  const items = await listPortfolios(c.req.param('committeeId'))
  return c.json(items)
})

munConfigRoutes.post(
  '/committees/:committeeId/portfolios',
  requireAuth,
  zValidator('json', createPortfolioBodySchema),
  async (c) => {
    const portfolio = await createPortfolio(
      { ...c.req.valid('json'), committeeId: c.req.param('committeeId') },
      c.get('session'),
    )
    return c.json(portfolio, 201)
  },
)

munConfigRoutes.patch(
  '/portfolios/:portfolioId',
  requireAuth,
  zValidator('json', updatePortfolioBodySchema),
  async (c) => {
    const portfolio = await updatePortfolio(
      c.req.param('portfolioId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(portfolio)
  },
)

munConfigRoutes.delete('/portfolios/:portfolioId', requireAuth, async (c) => {
  await deletePortfolio(c.req.param('portfolioId'), c.get('session'))
  return c.body(null, 204)
})

munConfigRoutes.get('/muns/:munId/products', async (c) => {
  const munId = c.req.param('munId')
  const includeInactive = await resolveIncludeInactive(
    munId,
    c.req.query('includeInactive'),
    c.get('session'),
  )
  const products = await listRegistrationProducts(munId, { includeInactive })
  return c.json(products)
})

munConfigRoutes.post(
  '/muns/:munId/products',
  requireAuth,
  zValidator('json', createRegistrationProductBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const product = await createRegistrationProduct(
      { ...body, munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(product, 201)
  },
)

munConfigRoutes.patch(
  '/products/:productId',
  requireAuth,
  zValidator('json', updateRegistrationProductBodySchema),
  async (c) => {
    const product = await updateRegistrationProduct(
      c.req.param('productId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(product)
  },
)

munConfigRoutes.delete('/products/:productId', requireAuth, async (c) => {
  await deleteRegistrationProduct(c.req.param('productId'), c.get('session'))
  return c.body(null, 204)
})

munConfigRoutes.patch(
  '/muns/:munId',
  requireAuth,
  zValidator('json', updateMunDetailsBodySchema),
  async (c) => {
    const mun = await updateMunDetails(
      c.req.param('munId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(mun)
  },
)
