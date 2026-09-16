import { Hono } from 'hono'
import { getMunAnalytics } from '@/lib/actions/mun-analytics'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

/** Read-only registration/revenue rollup for the organizer analytics section — see lib/actions/mun-analytics.ts. */
export const munAnalyticsRoutes = new Hono<{ Variables: AppVariables }>()

munAnalyticsRoutes.get('/organizer/muns/:munId/analytics', requireAuth, async (c) => {
  const analytics = await getMunAnalytics(c.req.param('munId'), c.get('session'))
  return c.json(analytics)
})
