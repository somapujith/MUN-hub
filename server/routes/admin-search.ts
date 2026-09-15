import { Hono } from 'hono'
import { z } from 'zod'
import { listPaymentExceptions, searchRegistrations } from '@/lib/actions/admin-search'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const searchQuerySchema = z
  .object({
    q: z.string().min(1),
  })
  .strict()

export const adminSearchRoutes = new Hono<{ Variables: AppVariables }>()

adminSearchRoutes.get(
  '/admin/search/registrations',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const { q } = searchQuerySchema.parse(c.req.query())
    const results = await searchRegistrations(q, c.get('session'))
    return c.json(results)
  },
)

adminSearchRoutes.get(
  '/admin/payment-exceptions',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const results = await listPaymentExceptions(c.get('session'))
    return c.json(results)
  },
)
