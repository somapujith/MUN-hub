import { Hono } from 'hono'
import { z } from 'zod'
import {
  createScheduleItem,
  deleteScheduleItem,
  listScheduleItems,
  updateScheduleItem,
} from '@/lib/actions/mun-schedule'
import { scheduleItemKindEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const optionalDate = z.coerce.date().optional()
const createScheduleBodySchema = z
  .object({
    committeeId: z.string().uuid().nullable().optional(),
    title: z.string().min(1),
    kind: z.enum(scheduleItemKindEnum.enumValues),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    location: z.string().nullable().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

const updateScheduleBodySchema = z
  .object({
    committeeId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).optional(),
    kind: z.enum(scheduleItemKindEnum.enumValues).optional(),
    startsAt: optionalDate,
    endsAt: optionalDate,
    location: z.string().nullable().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

export const munScheduleRoutes = new Hono<{ Variables: AppVariables }>()

munScheduleRoutes.get('/muns/:munId/schedule', async (c) => {
  const items = await listScheduleItems(c.req.param('munId'))
  return c.json(items)
})

munScheduleRoutes.post(
  '/muns/:munId/schedule',
  requireAuth,
  zValidator('json', createScheduleBodySchema),
  async (c) => {
    const item = await createScheduleItem(
      { ...c.req.valid('json'), munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(item, 201)
  },
)

munScheduleRoutes.patch(
  '/schedule/:itemId',
  requireAuth,
  zValidator('json', updateScheduleBodySchema),
  async (c) => {
    const item = await updateScheduleItem(c.req.param('itemId'), c.req.valid('json'), c.get('session'))
    return c.json(item)
  },
)

munScheduleRoutes.delete('/schedule/:itemId', requireAuth, async (c) => {
  await deleteScheduleItem(c.req.param('itemId'), c.get('session'))
  return c.body(null, 204)
})
