import { Hono } from 'hono'
import { getPastRegistrations, getUpcomingRegistrations } from '@/lib/actions/student-dashboard'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

export const studentDashboardRoutes = new Hono<{ Variables: AppVariables }>()

studentDashboardRoutes.get('/me/registrations/upcoming', requireAuth, async (c) => {
  const results = await getUpcomingRegistrations(c.get('session'))
  return c.json(results)
})

studentDashboardRoutes.get('/me/registrations/past', requireAuth, async (c) => {
  const results = await getPastRegistrations(c.get('session'))
  return c.json(results)
})
