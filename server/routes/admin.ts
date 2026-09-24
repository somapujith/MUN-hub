import { Hono } from 'hono'
import { z } from 'zod'
import { getAdminAnalytics } from '@/lib/actions/admin-analytics'
import { getAdminOverviewStats, listAdminActions, listAuditActors } from '@/lib/actions/admin-audit'
import { recordPiiRead } from '@/lib/actions/admin-pii-read'
import { exportRegistrationsCsv, getRegistrationsQueue } from '@/lib/actions/admin-review'
import { registrationStatusEnum } from '@/lib/db/schema-enums'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'
import { adminMunsRoutes } from './admin-muns'
import { adminReportingRoutes } from './admin-reporting'
import { adminStaffRoutes } from './admin-staff'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    // `?includeDataAccess=true` adds PII_READ rows to the feed.
    includeDataAccess: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    actorId: z.string().uuid().optional(),
    actionType: z.string().trim().min(1).max(200).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()

const registrationsFilterShape = {
  q: z.string().trim().min(1).optional(),
  status: z.enum(registrationStatusEnum.enumValues).optional(),
  munId: z.string().uuid().optional(),
}

const registrationsQuerySchema = z
  .object({
    ...registrationsFilterShape,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const registrationsExportQuerySchema = z.object(registrationsFilterShape).strict()

export const adminRoutes = new Hono<{ Variables: AppVariables }>()

adminRoutes.get(
  '/admin/overview',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const stats = await getAdminOverviewStats(c.get('session'))
    return c.json(stats)
  },
)

// Platform totals for the overview cards (GMV, platform fees, registrations
// by status, live MUNs, new organizers).
adminRoutes.get(
  '/admin/analytics',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    return c.json(await getAdminAnalytics(c.get('session')))
  },
)

adminRoutes.get(
  '/admin/audit',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = auditQuerySchema.parse(c.req.query())
    const result = await listAdminActions(params, c.get('session'))
    return c.json(result)
  },
)

// Options for the audit page's actor filter — see listAuditActors' own doc
// comment for why this is a fixed list of real ids, not a free-text search.
adminRoutes.get(
  '/admin/audit/actors',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const actors = await listAuditActors(c.get('session'))
    return c.json(actors)
  },
)

// Platform-wide, paginated registrations browse with optional `?q=`/`?status=`/
// `?munId=` filters — distinct from admin-search.ts's
// `/admin/search/registrations`, which requires a non-empty `q` and returns
// an unpaginated 50-row cap for the ops "look up one registration" search
// box. This is the admin console's Registrations table (browse-first,
// filters narrow it).
adminRoutes.get(
  '/admin/registrations',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = registrationsQuerySchema.parse(c.req.query())
    const session = c.get('session')!
    const result = await getRegistrationsQueue(params, session)
    // Rows carry delegate names and emails.
    await recordPiiRead({
      actorId: session.userId,
      route: 'GET /admin/registrations',
      targetType: 'registration',
      targetIds: result.results.map((row) => row.id),
      hasQuery: Boolean(params.q || params.status || params.munId),
    })
    return c.json(result)
  },
)

// Same filters as the list above, as a CSV download — registered as its own
// path (not a `?format=csv` on the list route) so response streaming/headers
// stay simple and the two are cacheable/rate-limited independently if that's
// ever needed.
adminRoutes.get(
  '/admin/registrations/export',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = registrationsExportQuerySchema.parse(c.req.query())
    const session = c.get('session')!
    const result = await exportRegistrationsCsv(params, session)
    // Rows carry delegate names and emails, same as the list route above.
    await recordPiiRead({
      actorId: session.userId,
      route: 'GET /admin/registrations/export',
      targetType: 'registration',
      targetIds: result.registrationIds,
      hasQuery: Boolean(params.q || params.status || params.munId),
    })
    // BOM so Excel opens the UTF-8 file with names intact (matches
    // organizer-dashboard.ts's roster export route).
    return c.body(`﻿${result.csv}`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    })
  },
)

// Staff management, the conferences console and the reporting suite live in
// their own files.
adminRoutes.route('/', adminStaffRoutes)
adminRoutes.route('/', adminMunsRoutes)
adminRoutes.route('/', adminReportingRoutes)
