import { Hono } from 'hono'
import { z } from 'zod'
import { recordPiiRead } from '@/lib/actions/admin-pii-read'
import {
  createAchievement,
  deleteAchievement,
  getResultsForReview,
  getResultsState,
  listMunAchievements,
  reviewResults,
  submitResultsForReview,
} from '@/lib/actions/results'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const createAchievementBodySchema = z
  .object({
    registrationId: z.string().uuid(),
    committee: z.string().min(1).max(120).nullable().optional(),
    portfolio: z.string().min(1).max(120).nullable().optional(),
    award: z.string().min(1).max(120),
  })
  .strict()

const reviewResultsBodySchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    note: z.string().max(2_000).optional(),
  })
  .strict()

export const resultsRoutes = new Hono<{ Variables: AppVariables }>()

resultsRoutes.get('/organizer/muns/:munId/achievements', requireAuth, async (c) => {
  const rows = await listMunAchievements(c.req.param('munId'), c.get('session'))
  return c.json(rows)
})

resultsRoutes.post(
  '/organizer/muns/:munId/achievements',
  requireAuth,
  zValidator('json', createAchievementBodySchema),
  async (c) => {
    const created = await createAchievement(
      { ...c.req.valid('json'), munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(created, 201)
  },
)

resultsRoutes.delete('/achievements/:id', requireAuth, async (c) => {
  await deleteAchievement(c.req.param('id'), c.get('session'))
  return c.body(null, 204)
})

/** Where the MUN's results stand (editable, submitted, returned). */
resultsRoutes.get('/organizer/muns/:munId/results', requireAuth, async (c) => {
  const state = await getResultsState(c.req.param('munId'), c.get('session'))
  return c.json(state)
})

/** Organizer submits results for MUNHub review. */
resultsRoutes.post('/organizer/muns/:munId/results/submit', requireAuth, async (c) => {
  const state = await submitResultsForReview(c.req.param('munId'), c.get('session'))
  return c.json(state)
})

/** MUNHub staff read a MUN's results for review: state plus every award (role checked in lib). */
resultsRoutes.get('/admin/muns/:munId/results', requireAuth, async (c) => {
  const session = c.get('session')!
  const review = await getResultsForReview(c.req.param('munId'), session)
  // Awards carry the winners' names and emails.
  await recordPiiRead({
    actorId: session.userId,
    route: 'GET /admin/muns/:munId/results',
    targetType: 'achievement',
    targetIds: review.awards.map((award) => award.id),
    hasQuery: false,
  })
  c.header('Cache-Control', 'no-store')
  return c.json(review)
})

/** MUNHub staff approve or return submitted results (role checked in lib). */
resultsRoutes.post(
  '/admin/muns/:munId/results/review',
  requireAuth,
  zValidator('json', reviewResultsBodySchema),
  async (c) => {
    const { decision, note } = c.req.valid('json')
    const state = await reviewResults(c.req.param('munId'), decision, note, c.get('session'))
    return c.json(state)
  },
)
