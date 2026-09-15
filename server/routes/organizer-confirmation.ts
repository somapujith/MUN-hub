import { Hono } from 'hono'
import { submitFinalConfirmation } from '@/lib/lifecycle/organizer-confirmation'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

export const organizerConfirmationRoutes = new Hono<{ Variables: AppVariables }>()

organizerConfirmationRoutes.post(
  '/muns/:munId/actions/submit-final-confirmation',
  requireAuth,
  async (c) => {
    const mun = await submitFinalConfirmation(c.req.param('munId'), c.get('session'))
    return c.json(mun, 200)
  },
)
