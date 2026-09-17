import { Hono } from 'hono'
import { z } from 'zod'
import { setDelegateAttendance } from '@/lib/actions/check-in'
import {
  exportDelegateRoster,
  getDelegateDetail,
  getDelegateList,
  getMunOverview,
  getOrganizerWorkspaceOverview,
  ROSTER_SEARCH_MAX_LENGTH,
  type DelegateFilters,
} from '@/lib/actions/organizer-dashboard'
import { paymentStatusEnum, registrationStatusEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

/** `status=CONFIRMED,ATTENDED` — a comma-separated list of registration statuses. */
const statusListSchema = z
  .string()
  .transform((raw) =>
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(registrationStatusEnum.enumValues)).max(registrationStatusEnum.enumValues.length))

const rosterFilterShape = {
  committeeId: z.string().uuid().optional(),
  registrationProductId: z.string().uuid().optional(),
  paymentStatus: z.enum(paymentStatusEnum.enumValues).optional(),
  status: statusListSchema.optional(),
  search: z.string().max(ROSTER_SEARCH_MAX_LENGTH).optional(),
}

const delegateFiltersQuerySchema = z
  .object({
    ...rosterFilterShape,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const rosterExportQuerySchema = z.object(rosterFilterShape).strict()

const attendanceBodySchema = z.object({ status: z.enum(['ATTENDED', 'NO_SHOW']) }).strict()

function toDelegateFilters<T extends { status?: DelegateFilters['statuses'] }>(query: T) {
  const { status, ...rest } = query
  return { ...rest, statuses: status }
}

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
  const filters = toDelegateFilters(delegateFiltersQuerySchema.parse(c.req.query()))
  const result = await getDelegateList(c.req.param('munId'), filters, c.get('session'))
  return c.json(result)
})

// Registered before `/delegates/:registrationId` so "export" is never read as an id.
organizerDashboardRoutes.get('/organizer/muns/:munId/delegates/export', requireAuth, async (c) => {
  const filters = toDelegateFilters(rosterExportQuerySchema.parse(c.req.query()))
  const result = await exportDelegateRoster(c.req.param('munId'), filters, c.get('session'))
  // BOM so Excel opens the UTF-8 file with names intact.
  return c.body(`﻿${result.csv}`, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Cache-Control': 'no-store',
  })
})

organizerDashboardRoutes.get('/organizer/muns/:munId/delegates/:registrationId', requireAuth, async (c) => {
  const detail = await getDelegateDetail(c.req.param('munId'), c.req.param('registrationId'), c.get('session'))
  c.header('Cache-Control', 'no-store')
  return c.json(detail)
})

organizerDashboardRoutes.put(
  '/organizer/muns/:munId/delegates/:registrationId/attendance',
  requireAuth,
  zValidator('json', attendanceBodySchema),
  async (c) => {
    const result = await setDelegateAttendance(
      c.req.param('munId'),
      c.req.param('registrationId'),
      c.req.valid('json').status,
      c.get('session'),
    )
    return c.json(result)
  },
)
