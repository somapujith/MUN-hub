import { Hono } from 'hono'
import { z } from 'zod'
import {
  createAccommodationOption,
  createAccommodationOptionField,
  deleteAccommodationOption,
  deleteAccommodationOptionField,
  listAccommodationOptionFields,
  listAccommodationOptions,
  setAccommodationProvided,
  updateAccommodationOption,
  updateAccommodationOptionField,
} from '@/lib/actions/accommodation'
import {
  assertMunReadable,
  findMunIdForAccommodationOption,
  resolveMunReadAccess,
} from '@/lib/actions/mun-read-access'
import { accommodationFieldTypeEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const createOptionBodySchema = z
  .object({
    name: z.string().min(1),
    price: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    description: z.string().optional(),
  })
  .strict()

const updateOptionBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    price: z.number().int().nonnegative().optional(),
    capacity: z.number().int().positive().optional(),
    description: z.string().nullable().optional(),
    status: z.string().optional(),
  })
  .strict()

const createFieldBodySchema = z
  .object({
    fieldType: z.enum(accommodationFieldTypeEnum.enumValues),
    label: z.string().min(1),
    required: z.boolean().optional(),
    choices: z.array(z.string()).optional(),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

const updateFieldBodySchema = z
  .object({
    fieldType: z.enum(accommodationFieldTypeEnum.enumValues).optional(),
    label: z.string().min(1).optional(),
    required: z.boolean().optional(),
    choices: z.array(z.string()).nullable().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

const setProvidedBodySchema = z.object({ provided: z.enum(['PROVIDED', 'NOT_PROVIDED']) }).strict()

export const accommodationRoutes = new Hono<{ Variables: AppVariables }>()

// "Do you offer accommodation?" — NOT_PROVIDED lets the module pass with no options.
accommodationRoutes.put(
  '/muns/:munId/accommodation/provided',
  requireAuth,
  zValidator('json', setProvidedBodySchema),
  async (c) => {
    const result = await setAccommodationProvided(
      c.req.param('munId'),
      c.req.valid('json').provided,
      c.get('session'),
    )
    return c.json(result)
  },
)

// Published MUNs for anyone; unpublished ones for the owner and staff only
// (404 otherwise). Archived options only for the owner/admin.
//
// Cacheable only for the plain public read of a published mun, and only when
// the URL itself carries no `includeInactive` param — same guard as muns.ts's
// `/:slug/products`. A non-owner's `?includeInactive=true` is silently
// downgraded to the active-only list (same body as the plain URL), but the
// URL string itself is still ambiguous: a shared cache keys on the URL, not
// on who's asking, so caching THIS response under THIS URL risks a later
// owner request being served back this stale downgraded list instead of ever
// reaching the origin. Checking the raw query param (not the resolved
// `includeInactive` flag) is what keeps that URL out of the cache regardless
// of whose request first populated it. Price/capacity here behaves like
// registration products, so it reuses that same TTL (muns.ts's
// MARKETPLACE_LIST_CACHE) rather than the longer mun-detail one.
const ACCOMMODATION_OPTIONS_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

accommodationRoutes.get('/muns/:munId/accommodation', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const rawIncludeInactive = c.req.query('includeInactive')
  const includeInactive = access === 'owner' && rawIncludeInactive === 'true'
  const options = await listAccommodationOptions(munId, { includeInactive })
  c.header(
    'Cache-Control',
    access === 'public' ? (rawIncludeInactive === 'true' ? 'no-store' : ACCOMMODATION_OPTIONS_CACHE) : 'no-store',
  )
  return c.json(options)
})

accommodationRoutes.post(
  '/muns/:munId/accommodation',
  requireAuth,
  zValidator('json', createOptionBodySchema),
  async (c) => {
    const option = await createAccommodationOption(
      { ...c.req.valid('json'), munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(option, 201)
  },
)

accommodationRoutes.patch(
  '/accommodation/:optionId',
  requireAuth,
  zValidator('json', updateOptionBodySchema),
  async (c) => {
    const option = await updateAccommodationOption(c.req.param('optionId'), c.req.valid('json'), c.get('session'))
    return c.json(option)
  },
)

accommodationRoutes.delete('/accommodation/:optionId', requireAuth, async (c) => {
  await deleteAccommodationOption(c.req.param('optionId'), c.get('session'))
  return c.body(null, 204)
})

// Same visibility as the option's MUN; an unknown option and an unreadable
// one both answer 404. Custom fields (e.g. "roommate preference") change
// about as rarely as the documents list, so this reuses that TTL; only the
// resolved-'public' case may carry a shared Cache-Control, for the same
// reason as every other by-id module read on this mun (owner/staff sees an
// unpublished option's fields on the same URL a stranger 404s on).
const ACCOMMODATION_FIELDS_CACHE = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600'

accommodationRoutes.get('/accommodation/:optionId/fields', async (c) => {
  const optionId = c.req.param('optionId')
  const munId = await findMunIdForAccommodationOption(optionId)
  const access = munId ? await resolveMunReadAccess(munId, c.get('session')) : 'none'
  if (access === 'none') {
    throw new Error('Accommodation option not found')
  }
  const fields = await listAccommodationOptionFields(optionId)
  c.header('Cache-Control', access === 'public' ? ACCOMMODATION_FIELDS_CACHE : 'no-store')
  return c.json(fields)
})

accommodationRoutes.post(
  '/accommodation/:optionId/fields',
  requireAuth,
  zValidator('json', createFieldBodySchema),
  async (c) => {
    const field = await createAccommodationOptionField(
      { ...c.req.valid('json'), optionId: c.req.param('optionId') },
      c.get('session'),
    )
    return c.json(field, 201)
  },
)

accommodationRoutes.patch(
  '/accommodation-fields/:fieldId',
  requireAuth,
  zValidator('json', updateFieldBodySchema),
  async (c) => {
    const field = await updateAccommodationOptionField(
      c.req.param('fieldId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(field)
  },
)

accommodationRoutes.delete('/accommodation-fields/:fieldId', requireAuth, async (c) => {
  await deleteAccommodationOptionField(c.req.param('fieldId'), c.get('session'))
  return c.body(null, 204)
})
