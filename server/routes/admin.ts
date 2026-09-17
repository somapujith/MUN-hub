import { Hono } from 'hono'
import { z } from 'zod'
import { getAdminAnalytics } from '@/lib/actions/admin-analytics'
import { getAdminOverviewStats, listAdminActions } from '@/lib/actions/admin-audit'
import { recordPiiRead } from '@/lib/actions/admin-pii-read'
import { getRegistrationsQueue } from '@/lib/actions/admin-review'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'
import { adminMunsRoutes } from './admin-muns'
import { adminStaffRoutes } from './admin-staff'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
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
    const params = paginationQuerySchema.parse(c.req.query())
    const result = await listAdminActions(params, c.get('session'))
    return c.json(result)
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
    recordPiiRead({
      actorId: session.userId,
      route: 'GET /admin/registrations',
      targetType: 'registration',
      targetIds: result.results.map((row) => row.id),
      hasQuery: Boolean(params.q),
    })
    return c.json(result)
  },
)

// Staff management and the conferences console live in their own files.
adminRoutes.route('/', adminStaffRoutes)
adminRoutes.route('/', adminMunsRoutes)
