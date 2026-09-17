import { Hono } from 'hono'
import { z } from 'zod'
import {
  createFormField,
  deleteFormField,
  listFormFields,
  listFormFieldsForOrganizer,
  reorderFormFields,
  updateFormField,
} from '@/lib/actions/registration-form'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
import { formFieldTypeEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const createFieldBodySchema = z
  .object({
    fieldKey: z.string().min(1),
    fieldType: z.enum(formFieldTypeEnum.enumValues),
    label: z.string().min(1),
    helpText: z.string().nullable().optional(),
    required: z.boolean().optional(),
    choices: z.array(z.string()).nullable().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    conditionalOn: z.string().nullable().optional(),
    conditionalOperator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS']).nullable().optional(),
    conditionalValue: z.string().nullable().optional(),
  })
  .strict()

const updateFieldBodySchema = z
  .object({
    fieldKey: z.string().min(1).optional(),
    fieldType: z.enum(formFieldTypeEnum.enumValues).optional(),
    label: z.string().min(1).optional(),
    helpText: z.string().nullable().optional(),
    required: z.boolean().optional(),
    choices: z.array(z.string()).nullable().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    conditionalOn: z.string().nullable().optional(),
    conditionalOperator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS']).nullable().optional(),
    conditionalValue: z.string().nullable().optional(),
  })
  .strict()

const reorderFieldsBodySchema = z
  .object({
    order: z.array(
      z
        .object({
          id: z.string().uuid(),
          displayOrder: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()

export const registrationFormRoutes = new Hono<{ Variables: AppVariables }>()

// The owner (or an admin) gets the form builder's view, which materializes
// the default fields. Everyone else gets a read-only view that never writes —
// of a published MUN only (404 otherwise), except OPERATIONS reviewers.
registrationFormRoutes.get('/muns/:munId/form-fields', async (c) => {
  const munId = c.req.param('munId')
  const session = c.get('session')
  const access = await assertMunReadable(munId, session)
  const fields = access === 'owner' ? await listFormFieldsForOrganizer(munId, session) : await listFormFields(munId)
  return c.json(fields)
})

registrationFormRoutes.post(
  '/muns/:munId/form-fields',
  requireAuth,
  zValidator('json', createFieldBodySchema),
  async (c) => {
    const field = await createFormField(
      { ...c.req.valid('json'), munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(field, 201)
  },
)

registrationFormRoutes.patch(
  '/form-fields/:fieldId',
  requireAuth,
  zValidator('json', updateFieldBodySchema),
  async (c) => {
    const field = await updateFormField(c.req.param('fieldId'), c.req.valid('json'), c.get('session'))
    return c.json(field)
  },
)

registrationFormRoutes.delete('/form-fields/:fieldId', requireAuth, async (c) => {
  await deleteFormField(c.req.param('fieldId'), c.get('session'))
  return c.body(null, 204)
})

registrationFormRoutes.post(
  '/muns/:munId/form-fields/actions/reorder',
  requireAuth,
  zValidator('json', reorderFieldsBodySchema),
  async (c) => {
    const fields = await reorderFormFields(
      { munId: c.req.param('munId'), order: c.req.valid('json').order },
      c.get('session'),
    )
    return c.json(fields, 200)
  },
)
