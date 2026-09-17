import { Hono } from 'hono'
import { z } from 'zod'
import { getAdminMunDetail, getGoLiveQueueDetails, listAdminMuns } from '@/lib/actions/admin-muns'
import { munStatusEnum } from '@/lib/db/schema-enums'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

// Conferences console reads (lib/actions/admin-muns.ts). The actions on these
// pages use their existing endpoints: admin-review.ts (publish/unpublish/
// suspend/reinstate), go-live.ts (Gate 2 review, enqueue, publish),
// payment-settlement.ts (verification state), module-verification.ts
// (requirement toggle) and the MUN lifecycle endpoint.
const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const listQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    status: z.enum(munStatusEnum.enumValues).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const queueQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

export const adminMunsRoutes = new Hono<{ Variables: AppVariables }>()

adminMunsRoutes.get('/admin/muns', requireAuth, requireRole([...REVIEW_ROLES]), async (c) => {
  const params = listQuerySchema.parse(c.req.query())
  return c.json(await listAdminMuns(params, c.get('session')))
})

adminMunsRoutes.get('/admin/muns/:munId', requireAuth, requireRole([...REVIEW_ROLES]), async (c) => {
  const detail = await getAdminMunDetail(c.req.param('munId'), c.get('session'))
  // SLA state is computed on read; never let a browser cache serve a stale one.
  c.header('Cache-Control', 'no-store')
  return c.json(detail)
})

// The go-live queue with each submission's reviewer and payment-account state.
adminMunsRoutes.get('/admin/go-live-queue/details', requireAuth, requireRole([...REVIEW_ROLES]), async (c) => {
  const params = queueQuerySchema.parse(c.req.query())
  c.header('Cache-Control', 'no-store')
  return c.json(await getGoLiveQueueDetails(params, c.get('session')))
})
