import { Hono } from 'hono'
import { z } from 'zod'
import {
  createAccommodationOption,
  createAccommodationOptionField,
  deleteAccommodationOption,
  deleteAccommodationOptionField,
  listAccommodationOptionFields,
  listAccommodationOptions,
  updateAccommodationOption,
  updateAccommodationOptionField,
} from '@/lib/actions/accommodation'
import { accommodationFieldTypeEnum } from '@/lib/db/schema-enums'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

async function resolveIncludeInactive(
  munId: string,
  raw: string | undefined,
  session: AppVariables['session'],
): Promise<boolean> {
  if (raw !== 'true') return false
  try {
    await assertOwnsOrAdmin(munId, session)
    return true
  } catch {
    return false
  }
}

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

export const accommodationRoutes = new Hono<{ Variables: AppVariables }>()

accommodationRoutes.get('/muns/:munId/accommodation', async (c) => {
  const munId = c.req.param('munId')
  const includeInactive = await resolveIncludeInactive(
    munId,
    c.req.query('includeInactive'),
    c.get('session'),
  )
  const options = await listAccommodationOptions(munId, { includeInactive })
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

accommodationRoutes.get('/accommodation/:optionId/fields', async (c) => {
  const fields = await listAccommodationOptionFields(c.req.param('optionId'))
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
