import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getOrganizerBankDetails, listOrganizers, reinstateOrganizer, suspendOrganizer } from '@/lib/actions/organizer-admin'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    search: z.string().min(1).optional(),
  })
  .strict()

const suspendOrganizerBodySchema = z
  .object({
    reason: z.string().min(1),
  })
  .strict()

export const organizerAdminRoutes = new Hono<{ Variables: AppVariables }>()

organizerAdminRoutes.get(
  '/admin/organizers',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const params = paginationQuerySchema.parse(c.req.query())
    const result = await listOrganizers(params, c.get('session'))
    return c.json(result)
  },
)

organizerAdminRoutes.post(
  '/admin/organizers/:userId/suspend',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  zValidator('json', suspendOrganizerBodySchema),
  async (c) => {
    const { reason } = c.req.valid('json')
    await suspendOrganizer(c.req.param('userId'), reason, c.get('session'))
    return c.body(null, 204)
  },
)

organizerAdminRoutes.post(
  '/admin/organizers/:userId/reinstate',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    await reinstateOrganizer(c.req.param('userId'), c.get('session'))
    return c.body(null, 204)
  },
)

// Decrypts and returns the organizer's full bank payout details — see
// lib/actions/organizer-admin.ts#getOrganizerBankDetails's doc comment
// before adding another caller. no-store: this must never sit in a browser
// or intermediate cache even for a moment.
organizerAdminRoutes.get(
  '/admin/organizers/:userId/bank-details',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const result = await getOrganizerBankDetails(c.req.param('userId'), c.get('session'))
    c.header('Cache-Control', 'no-store')
    return c.json(result)
  },
)
