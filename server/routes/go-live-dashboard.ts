import { Hono } from 'hono'
import { getConfirmationPreview, getMunProgress, getMunReviewFeedback } from '@/lib/actions/go-live-dashboard'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

export const goLiveDashboardRoutes = new Hono<{ Variables: AppVariables }>()

goLiveDashboardRoutes.get('/muns/:munId/progress', requireAuth, async (c) => {
  const progress = await getMunProgress(c.req.param('munId'), c.get('session'))
  return c.json(progress)
})

// Reviewer feedback for the organizer (Gate 1 + Gate 2), never internal notes.
goLiveDashboardRoutes.get('/muns/:munId/review-feedback', requireAuth, async (c) => {
  return c.json(await getMunReviewFeedback(c.req.param('munId'), c.get('session')))
})

// Gate 3: what the organizer is about to confirm, and the attestation text.
goLiveDashboardRoutes.get('/muns/:munId/confirmation-preview', requireAuth, async (c) => {
  return c.json(await getConfirmationPreview(c.req.param('munId'), c.get('session')))
})
