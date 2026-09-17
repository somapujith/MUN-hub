import { Hono } from 'hono'
import { z } from 'zod'
import {
  getConversionFunnel,
  getGeographyBreakdown,
  getOrganizerLeaderboard,
  getPlatformFeeSummary,
  getRegistrationTrend,
  getRevenueTrend,
  getSignupTrend,
  getTopConferences,
  REPORTING_RANGE_DAYS,
} from '@/lib/actions/admin-reporting'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

// The admin console's "Analytics" section (distinct from /admin/analytics's
// all-time overview totals, admin.ts) — date-ranged trends, a conversion
// funnel, leaderboards, geography and platform fees. Staff-only, same roles
// as the rest of /admin.
const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const rangeQuerySchema = z
  .object({
    days: z.coerce.number().int().refine((value): value is (typeof REPORTING_RANGE_DAYS)[number] =>
      (REPORTING_RANGE_DAYS as readonly number[]).includes(value),
    ),
  })
  .strict()

const trendsQuerySchema = rangeQuerySchema.extend({
  granularity: z.enum(['day', 'week']),
})

export const adminReportingRoutes = new Hono<{ Variables: AppVariables }>()

// Registration, revenue (gross + net-of-fee) and signup (organizer +
// delegate) trends, all sharing the same range/granularity — one request for
// the whole trends section of the page.
adminReportingRoutes.get(
  '/admin/reporting/trends',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = trendsQuerySchema.parse(c.req.query())
    const session = c.get('session')
    const [registrations, revenue, signups] = await Promise.all([
      getRegistrationTrend(params, session),
      getRevenueTrend(params, session),
      getSignupTrend(params, session),
    ])
    return c.json({ registrations, revenue, signups })
  },
)

adminReportingRoutes.get(
  '/admin/reporting/funnel',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = rangeQuerySchema.parse(c.req.query())
    return c.json(await getConversionFunnel(params, c.get('session')))
  },
)

adminReportingRoutes.get(
  '/admin/reporting/top-conferences',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = rangeQuerySchema.parse(c.req.query())
    return c.json(await getTopConferences(params, c.get('session')))
  },
)

adminReportingRoutes.get(
  '/admin/reporting/organizers',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = rangeQuerySchema.parse(c.req.query())
    return c.json(await getOrganizerLeaderboard(params, c.get('session')))
  },
)

adminReportingRoutes.get(
  '/admin/reporting/geography',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = rangeQuerySchema.parse(c.req.query())
    return c.json(await getGeographyBreakdown(params, c.get('session')))
  },
)

adminReportingRoutes.get(
  '/admin/reporting/fees',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = rangeQuerySchema.parse(c.req.query())
    return c.json(await getPlatformFeeSummary(params, c.get('session')))
  },
)
