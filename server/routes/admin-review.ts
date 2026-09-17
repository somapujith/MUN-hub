import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  getModuleReviewQueue,
  getMunForReview,
  getReviewQueue,
  publishMun,
  reinstateMun,
  reviewMunApplication,
  suspendMun,
  unpublishMun,
} from '@/lib/actions/admin-review'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const
const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

const reviewQueueQuerySchema = z
  .object({
    status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).optional(),
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const moduleReviewQueueQuerySchema = z
  .object({
    status: z.enum(['NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUESTED', 'REJECTED']).optional(),
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const reviewApplicationBodySchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
    notes: z.string().optional(),
    internalNotes: z.string().optional(),
  })
  .strict()
  // Admin PRD §8: a rejection or change request must carry a reason for the
  // organizer. lib/actions/admin-review.ts enforces the same rule.
  .refine((body) => body.decision === 'APPROVED' || (body.notes?.trim().length ?? 0) > 0, {
    message: 'A reason is required to reject or request changes',
    path: ['notes'],
  })

const suspendMunBodySchema = z
  .object({
    reason: z.string().min(1),
  })
  .strict()

export const adminReviewRoutes = new Hono<{ Variables: AppVariables }>()

adminReviewRoutes.get(
  '/admin/review-queue',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  async (c) => {
    const query = reviewQueueQuerySchema.parse(c.req.query())
    const result = await getReviewQueue(
      { status: query.status, search: query.q, limit: query.limit, offset: query.offset },
      c.get('session'),
    )
    return c.json(result)
  },
)

adminReviewRoutes.get(
  '/admin/muns/:munId/review',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  async (c) => {
    const result = await getMunForReview(c.req.param('munId'), c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/muns/:munId/review-application',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  zValidator('json', reviewApplicationBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const session = c.get('session')
    const result = await reviewMunApplication(
      c.req.param('munId'),
      body.decision,
      body.notes,
      body.internalNotes,
      session,
    )
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/muns/:munId/publish',
  requireAuth,
  requireRole([...PUBLISH_ROLES]),
  async (c) => {
    const result = await publishMun(c.req.param('munId'), c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/muns/:munId/unpublish',
  requireAuth,
  requireRole([...PUBLISH_ROLES]),
  async (c) => {
    const result = await unpublishMun(c.req.param('munId'), c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/muns/:munId/suspend',
  requireAuth,
  requireRole([...PUBLISH_ROLES]),
  zValidator('json', suspendMunBodySchema),
  async (c) => {
    const { reason } = c.req.valid('json')
    const result = await suspendMun(c.req.param('munId'), reason, c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/muns/:munId/reinstate',
  requireAuth,
  requireRole([...PUBLISH_ROLES]),
  async (c) => {
    const result = await reinstateMun(c.req.param('munId'), c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.get(
  '/admin/module-review-queue',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  async (c) => {
    const query = moduleReviewQueueQuerySchema.parse(c.req.query())
    const result = await getModuleReviewQueue(
      { status: query.status, search: query.q, limit: query.limit, offset: query.offset },
      c.get('session'),
    )
    return c.json(result)
  },
)
