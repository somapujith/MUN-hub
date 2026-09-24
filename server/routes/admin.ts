import { Hono } from 'hono'
import { z } from 'zod'
import { getAdminAnalytics } from '@/lib/actions/admin-analytics'
import { getAdminOverviewStats, listAdminActions, listAuditActors } from '@/lib/actions/admin-audit'
import { recordPiiRead } from '@/lib/actions/admin-pii-read'
import { getRegistrationsQueue } from '@/lib/actions/admin-review'
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

const registrationsQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

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

// Platform-wide, paginated registrations browse with optional `?q=` search —
// distinct from admin-search.ts's `/admin/search/registrations`, which
// requires a non-empty `q` and returns an unpaginated 50-row cap for the
// ops "look up one registration" search box. This is the admin console's
// Registrations table (browse-first, search narrows it).
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
      hasQuery: Boolean(params.q),
    })
    return c.json(result)
  },
)

// Staff management, the conferences console and the reporting suite live in
// their own files.
adminRoutes.route('/', adminStaffRoutes)
adminRoutes.route('/', adminMunsRoutes)
adminRoutes.route('/', adminReportingRoutes)
