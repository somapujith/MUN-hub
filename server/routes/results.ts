import { Hono } from 'hono'
import { z } from 'zod'
import { createAchievement, deleteAchievement, listMunAchievements } from '@/lib/actions/results'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const createAchievementBodySchema = z
  .object({
    registrationId: z.string().uuid(),
    committee: z.string().min(1).nullable().optional(),
    portfolio: z.string().min(1).nullable().optional(),
    award: z.string().min(1),
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
