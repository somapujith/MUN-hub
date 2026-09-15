import { Hono } from 'hono'
import { getMunProgress } from '@/lib/actions/go-live-dashboard'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

export const goLiveDashboardRoutes = new Hono<{ Variables: AppVariables }>()

goLiveDashboardRoutes.get('/muns/:munId/progress', requireAuth, async (c) => {
  const progress = await getMunProgress(c.req.param('munId'), c.get('session'))
  return c.json(progress)
})
