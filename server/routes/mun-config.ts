import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createCommittee,
  createPortfolio,
  createPortfolios,
  createRegistrationProduct,
  deleteCommittee,
  deletePortfolio,
  deleteRegistrationProduct,
  getMunDetails,
  listCommittees,
  listPortfolios,
  listRegistrationProducts,
  MAX_PORTFOLIOS_PER_REQUEST,
  updateCommittee,
  updateMunDetails,
  updatePortfolio,
  updateRegistrationProduct,
} from '@/lib/actions/mun-config'
import { getMunPreview } from '@/lib/actions/marketplace'
import {
  assertMunReadable,
  findMunIdForCommittee,
  resolveMunReadAccess,
} from '@/lib/actions/mun-read-access'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

// NOTE on ordering: `z.coerce.date()` coerces `null` via `new Date(null)`,
// which JS resolves to the epoch (1970-01-01) instead of failing — so a
// union that tries the date branch first silently turns an explicit JSON
// `null` into a bogus real date rather than surfacing it as a validation
// error or preserving it as "no value". Putting `z.null()` first makes the
// union short-circuit on an explicit null before `z.coerce.date()` ever
// sees it. Verified against both branches: `z.coerce.date().safeParse(null)`
// returns `{ success: true, data: 1970-01-01T00:00:00.000Z }` on its own.
const nullableDate = z.union([z.null(), z.coerce.date()]).optional()
// Create endpoints have no "explicit null" input in their lib types (e.g.
// `CreateRegistrationProductInput.deadline?: Date`, no `| null` branch) —
// only "omit" or "set". A client that sends an empty date field as JSON
// `null` (as the registration-products create form does) should be treated
// the same as omitting it, not coerced into the epoch bug described above.
const optionalDate = z
  .union([z.null(), z.coerce.date()])
  .optional()
  .transform((value) => value ?? undefined)

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

const createPortfoliosBodySchema = z
  .object({
    portfolios: z
      .array(createPortfolioBodySchema)
      .min(1)
      .max(MAX_PORTFOLIOS_PER_REQUEST),
  })
  .strict()

const updatePortfolioBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.string().optional(),
    availability: z.number().int().nonnegative().optional(),
  })
  .strict()

// NOTE: description/eligibility are `?: string` / `?: Record<...>` (NOT
// nullable) on lib/actions/mun-config.ts's Create/UpdateRegistrationProductInput
// — there's no lib-layer way to explicitly clear either back to null via
// these actions, only to omit them (leave unchanged) or set a new value. The
// schemas below match that exactly rather than accepting `null`, since a
// nullable value here would fail to type-check against the lib input type.
const eligibilitySchema = z.record(z.string(), z.unknown()).optional()

const createRegistrationProductBodySchema = z
  .object({
    name: z.string().min(1),
    price: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    currency: z.string().optional(),
    deadline: optionalDate,
    // Registration Types PRD (Slice 1, 2026-09-15) fields — already accepted
    // by lib/actions/mun-config.ts's CreateRegistrationProductInput, just not
    // previously exposed on this route. See commit b77d787.
    description: z.string().optional(),
    allowsIndividual: z.boolean().optional(),
    allowsDelegation: z.boolean().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    eligibility: eligibilitySchema,
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
    description: z.string().optional(),
    allowsIndividual: z.boolean().optional(),
    allowsDelegation: z.boolean().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    eligibility: eligibilitySchema,
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
    addressLine1: z.string().nullable().optional(),
    addressState: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    mapUrl: z.string().url().nullable().optional(),
    registrationOpensAt: nullableDate,
    registrationDeadline: nullableDate,
  })
  .strict()

export const munConfigRoutes = new Hono<{ Variables: AppVariables }>()

// Organizer's own setup/edit read — NOT the public `/muns/:slug` route
// (marketplace.ts's getMunBySlug filters by publication status; this must
// not). Namespaced under /organizer/muns/... (same convention as
// organizer-dashboard.ts's /organizer/muns/:munId/overview) so it never
// collides with munsRoutes' public `GET /muns/:slug`, which is mounted
// ahead of this bundle in apiV1 and would otherwise win the match first.
munConfigRoutes.get('/organizer/muns/:munId/details', requireAuth, async (c) => {
  const mun = await getMunDetails(c.req.param('munId'), c.get('session'))
  return c.json(mun)
})

// "Preview as a delegate": the public page's data before the MUN is live.
// Owner and staff only.
munConfigRoutes.get('/organizer/muns/:munId/preview', requireAuth, async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await getMunPreview(c.req.param('munId'), c.get('session')))
})

// Published MUNs for anyone; unpublished ones for the owner and staff only
// (404 otherwise) — same session-dependent-URL hazard as the other by-id
// module reads (mun-documents.ts etc.), so only the resolved-'public' case
// may carry a shared Cache-Control; owner/staff gets no-store. TTL matches
// the mun detail page (muns.ts's MUN_DETAIL_CACHE) — committee names/
// capacities change about as often as the rest of the detail content.
const COMMITTEES_CACHE = 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'

munConfigRoutes.get('/muns/:munId/committees', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const committees = await listCommittees(munId)
  c.header('Cache-Control', access === 'public' ? COMMITTEES_CACHE : 'no-store')
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

// Same visibility as the committee's MUN; an unknown committee and an
// unreadable one both answer 404. listPortfolios is a plain select (no live
// "seats taken" aggregate — that's computed at registration time, not stored
// here), so it changes only when the organizer edits the roster, same churn
// as the committee list itself — reuses COMMITTEES_CACHE. Only the
// resolved-'public' case may carry a shared Cache-Control, for the same
// reason as the committees route above.
munConfigRoutes.get('/committees/:committeeId/portfolios', async (c) => {
  const committeeId = c.req.param('committeeId')
  const munId = await findMunIdForCommittee(committeeId)
  const access = munId ? await resolveMunReadAccess(munId, c.get('session')) : 'none'
  if (access === 'none') {
    throw new Error('Committee not found')
  }
  const items = await listPortfolios(committeeId)
  c.header('Cache-Control', access === 'public' ? COMMITTEES_CACHE : 'no-store')
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

// Many portfolios at once (a pasted list), all or nothing.
munConfigRoutes.post(
  '/committees/:committeeId/portfolios/bulk',
  requireAuth,
  zValidator('json', createPortfoliosBodySchema),
  async (c) => {
    const created = await createPortfolios(
      c.req.param('committeeId'),
      c.req.valid('json').portfolios,
      c.get('session'),
    )
    return c.json(created, 201)
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

// Reached for ids only (munsRoutes answers public slugs first). Published
// MUNs for anyone; unpublished ones for the owner and staff only (404
// otherwise). Archived products only for the owner/admin.
//
// Same shape and same cache reasoning as muns.ts's `/:slug/products`,
// including the same URL-poisoning guard: a non-owner's `?includeInactive=true`
// is silently downgraded to the active-only list, but the URL string is still
// ambiguous (owner vs. everyone else), so it stays no-store based on the raw
// query param — never on the resolved `includeInactive` flag — even though
// the resolved flag is false for that caller too. Only a published mun's
// plain URL (no includeInactive param at all) is byte-identical for every
// caller and safe to cache.
const PRODUCTS_BY_ID_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

munConfigRoutes.get('/muns/:munId/products', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const rawIncludeInactive = c.req.query('includeInactive')
  const includeInactive = access === 'owner' && rawIncludeInactive === 'true'
  const products = await listRegistrationProducts(munId, { includeInactive })
  c.header(
    'Cache-Control',
    access === 'public' ? (rawIncludeInactive === 'true' ? 'no-store' : PRODUCTS_BY_ID_CACHE) : 'no-store',
  )
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
