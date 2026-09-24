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
//
// Only the resolved-'public' case (a published mun, read-only view, no
// materialization) may carry a shared Cache-Control: it's the only branch
// that is both response-shape-identical for every caller AND side-effect-
// free. 'owner' calls listFormFieldsForOrganizer, which writes rows on first
// call — never cacheable. 'staff' reaches the same listFormFields(munId) call
// as 'public', but only because assertMunReadable let it read an unpublished
// mun on this exact URL — caching that would risk a shared cache later
// serving a stranger the staff reviewer's view of an unpublished mun's form.
// TTL matches the mun detail page (muns.ts's MUN_DETAIL_CACHE) — organizers
// tend to settle the form early, about the same churn as the rest of the
// detail content.
const FORM_FIELDS_CACHE = 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'

registrationFormRoutes.get('/muns/:munId/form-fields', async (c) => {
  const munId = c.req.param('munId')
  const session = c.get('session')
  const access = await assertMunReadable(munId, session)
  const fields = access === 'owner' ? await listFormFieldsForOrganizer(munId, session) : await listFormFields(munId)
  c.header('Cache-Control', access === 'public' ? FORM_FIELDS_CACHE : 'no-store')
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
