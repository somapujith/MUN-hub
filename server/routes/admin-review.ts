import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  bulkApproveMunApplications,
  cancelRegistrationAsAdmin,
  getModuleReviewQueue,
  getMunForReview,
  getReviewQueue,
  publishMun,
  reinstateMun,
  resendRegistrationConfirmation,
  reviewMunApplication,
  setRegistrationDuplicateFlag,
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

const bulkApproveApplicationsBodySchema = z
  .object({
    munIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict()

const cancelRegistrationBodySchema = z
  .object({
    reason: z.string().min(1),
  })
  .strict()

const flagRegistrationDuplicateBodySchema = z
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

// Bulk approve-only (Gate 1). A literal 3-segment path — never collides with
// the `/admin/muns/:munId/...` 4-segment param routes above/below it.
adminReviewRoutes.post(
  '/admin/muns/bulk-approve',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  zValidator('json', bulkApproveApplicationsBodySchema),
  async (c) => {
    const { munIds } = c.req.valid('json')
    const results = await bulkApproveMunApplications(munIds, c.get('session'))
    return c.json({ results })
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

// Per-registration admin actions — the admin Registrations page. Distinct
// from the conference-level `POST /muns/:munId/lifecycle/cancel`
// (server/routes/mun-lifecycle.ts), which cancels every in-flight hold on an
// entire mun at once.

adminReviewRoutes.post(
  '/admin/registrations/:registrationId/cancel',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  zValidator('json', cancelRegistrationBodySchema),
  async (c) => {
    const { reason } = c.req.valid('json')
    const result = await cancelRegistrationAsAdmin(c.req.param('registrationId'), reason, c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/registrations/:registrationId/flag-duplicate',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  zValidator('json', flagRegistrationDuplicateBodySchema),
  async (c) => {
    const { reason } = c.req.valid('json')
    const result = await setRegistrationDuplicateFlag(c.req.param('registrationId'), true, reason, c.get('session'))
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/registrations/:registrationId/unflag-duplicate',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  async (c) => {
    const result = await setRegistrationDuplicateFlag(
      c.req.param('registrationId'),
      false,
      undefined,
      c.get('session'),
    )
    return c.json(result)
  },
)

adminReviewRoutes.post(
  '/admin/registrations/:registrationId/resend-confirmation',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  async (c) => {
    const result = await resendRegistrationConfirmation(c.req.param('registrationId'), c.get('session'))
    return c.json(result)
  },
)
