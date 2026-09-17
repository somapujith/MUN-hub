import { Hono } from 'hono'
import { z } from 'zod'
import { submitFinalConfirmation } from '@/lib/lifecycle/organizer-confirmation'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

// Gate 3 needs an explicit attestation from the organizer.
const confirmationBodySchema = z.object({ attested: z.boolean() }).strict()

export const organizerConfirmationRoutes = new Hono<{ Variables: AppVariables }>()

organizerConfirmationRoutes.post(
  '/muns/:munId/actions/submit-final-confirmation',
  requireAuth,
  zValidator('json', confirmationBodySchema),
  async (c) => {
    const mun = await submitFinalConfirmation(c.req.param('munId'), c.get('session'), c.req.valid('json'))
    return c.json(mun, 200)
  },
)
