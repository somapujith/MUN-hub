import { Hono } from 'hono'
import { zValidator } from '../lib/zod-validator'
import { z } from 'zod'
import {
  claimSubmission,
  enqueueForGoLive,
  getGoLiveQueue,
  publishFromQueue,
  reviewSubmission,
  submitMunForReview,
  withdrawSubmission,
} from '@/lib/lifecycle/go-live'
import type { AppVariables } from '../src/types'

const reviewBodySchema = z
  .object({
    decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
    notes: z.string().optional(),
    reason: z.string().optional(),
    issues: z
      .array(
        z.object({
          severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']),
          reason: z.string(),
        }),
      )
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.decision === 'REJECTED' && (!data.reason || data.reason.trim().length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'reason is required when decision is REJECTED',
        path: ['reason'],
      })
    }
  })

const queueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const goLiveRoutes = new Hono<{ Variables: AppVariables }>()
  .post('/muns/:munId/actions/submit-for-review', async (c) => {
    const munId = c.req.param('munId')
    const session = c.get('session')

    // Validation failure is HTTP 200 with {passed:false, blockers} — NOT 4xx.
    const result = await submitMunForReview(munId, session)
    return c.json(result, 200)
  })
  // "Make changes first": step back from Gate 3 to edit before confirming.
  .post('/muns/:munId/actions/withdraw-submission', async (c) => {
    await withdrawSubmission(c.req.param('munId'), c.get('session'))
    return c.body(null, 204)
  })
  .post('/muns/:munId/submission/actions/review', zValidator('json', reviewBodySchema), async (c) => {
    const munId = c.req.param('munId')
    const body = c.req.valid('json')
    const session = c.get('session')

    const submission = await reviewSubmission(munId, body.decision, body, session)
    return c.json(submission, 200)
  })
  .post('/muns/:munId/submission/actions/enqueue', async (c) => {
    const munId = c.req.param('munId')
    const session = c.get('session')

    const submission = await enqueueForGoLive(munId, session)
    return c.json(submission, 200)
  })
  // Claims a submission for review — mirrors
  // POST /admin/support/tickets/:ticketId/assign's shape (server/routes/support.ts).
  .post('/admin/go-live-queue/:submissionId/claim', async (c) => {
    const submissionId = c.req.param('submissionId')
    const session = c.get('session')

    const submission = await claimSubmission(submissionId, session)
    return c.json(submission, 200)
  })
  .get('/admin/go-live-queue', zValidator('query', queueQuerySchema), async (c) => {
    const query = c.req.valid('query')
    const session = c.get('session')

    const result = await getGoLiveQueue(query, session)
    c.header('Cache-Control', 'no-store')
    return c.json(result, 200)
  })
  .post('/muns/:munId/actions/publish', async (c) => {
    const munId = c.req.param('munId')
    const session = c.get('session')
    const idempotencyKey = c.req.header('Idempotency-Key')

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return c.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Idempotency-Key header is required' } },
        400,
      )
    }

    const result = await publishFromQueue(munId, session, idempotencyKey)
    return c.json(result, 200)
  })
