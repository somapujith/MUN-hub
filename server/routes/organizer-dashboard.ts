import { Hono } from 'hono'
import { z } from 'zod'
import { getDelegateList, getMunOverview, getOrganizerWorkspaceOverview } from '@/lib/actions/organizer-dashboard'
import { paymentStatusEnum } from '@/lib/db/schema-enums'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const delegateFiltersQuerySchema = z
  .object({
    committeeId: z.string().uuid().optional(),
    paymentStatus: z.enum(paymentStatusEnum.enumValues).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

export const organizerDashboardRoutes = new Hono<{ Variables: AppVariables }>()

/**
 * Organizer-wide workspace data (every owned mun + totals across them).
 * Backs both the Overview and My MUNs pages — the same payload serves
 * both so the client can share one cached query between the two routes.
 */
organizerDashboardRoutes.get('/organizer/workspace/overview', requireAuth, async (c) => {
  const overview = await getOrganizerWorkspaceOverview(c.get('session'))
  return c.json(overview)
})

organizerDashboardRoutes.get('/organizer/muns/:munId/overview', requireAuth, async (c) => {
  const overview = await getMunOverview(c.req.param('munId'), c.get('session'))
  return c.json(overview)
})

organizerDashboardRoutes.get('/organizer/muns/:munId/delegates', requireAuth, async (c) => {
  const filters = delegateFiltersQuerySchema.parse(c.req.query())
  const result = await getDelegateList(c.req.param('munId'), filters, c.get('session'))
  return c.json(result)
})
