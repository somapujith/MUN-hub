import { Hono } from 'hono'
import { z } from 'zod'
import { getAdminOverviewStats, listAdminActions } from '@/lib/actions/admin-audit'
import { getRegistrationsQueue } from '@/lib/actions/admin-review'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

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
    const result = await getRegistrationsQueue(params, c.get('session'))
    return c.json(result)
  },
)
