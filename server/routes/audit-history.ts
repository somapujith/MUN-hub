import { Hono } from 'hono'
import { getAuditHistory } from '@/lib/actions/audit-history'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export const auditHistoryRoutes = new Hono<{ Variables: AppVariables }>()

auditHistoryRoutes.get(
  '/admin/audit/:targetType/:targetId',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const entries = await getAuditHistory(
      c.req.param('targetType'),
      c.req.param('targetId'),
      c.get('session'),
    )
    return c.json(entries)
  },
)
