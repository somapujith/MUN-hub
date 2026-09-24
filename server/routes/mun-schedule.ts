import { Hono } from 'hono'
import { z } from 'zod'
import {
  createScheduleItem,
  deleteScheduleItem,
  listScheduleItems,
  updateScheduleItem,
} from '@/lib/actions/mun-schedule'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
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

// Published MUNs for anyone; unpublished ones for the owner and staff only
// (404 otherwise) — same session-dependent-URL hazard as the other by-id
// module reads, so only the resolved-'public' case may carry a shared
// Cache-Control; owner/staff gets no-store. TTL matches the mun detail page
// (muns.ts's MUN_DETAIL_CACHE) — session times/rooms can shift as the
// conference date nears, about as often as the rest of the detail content.
const MUN_SCHEDULE_CACHE = 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'

munScheduleRoutes.get('/muns/:munId/schedule', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const items = await listScheduleItems(munId)
  c.header('Cache-Control', access === 'public' ? MUN_SCHEDULE_CACHE : 'no-store')
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
