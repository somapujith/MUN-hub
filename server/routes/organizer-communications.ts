import { Hono } from 'hono'
import { z } from 'zod'
import {
  listMunCommunications,
  MESSAGEABLE_STATUSES,
  previewCommunicationAudience,
  sendMunCommunication,
} from '@/lib/actions/organizer-communications'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const audienceShape = {
  registrationProductId: z.string().uuid().optional(),
  committeeId: z.string().uuid().optional(),
}

/** GET query form: `status=CONFIRMED,ATTENDED`. */
const audienceQuerySchema = z
  .object({
    ...audienceShape,
    status: z
      .string()
      .transform((raw) =>
        raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(MESSAGEABLE_STATUSES)).max(MESSAGEABLE_STATUSES.length))
      .optional(),
  })
  .strict()

const sendBodySchema = z
  .object({
    // Generous transport bounds only — lib/actions/organizer-communications.ts
    // validates the real limits and returns the user-facing message.
    subject: z.string().max(1_000),
    body: z.string().max(20_000),
    audience: z
      .object({
        ...audienceShape,
        statuses: z.array(z.enum(MESSAGEABLE_STATUSES)).max(MESSAGEABLE_STATUSES.length).optional(),
      })
      .strict(),
  })
  .strict()

export const organizerCommunicationsRoutes = new Hono<{ Variables: AppVariables }>()

organizerCommunicationsRoutes.get('/organizer/muns/:munId/communications', requireAuth, async (c) => {
  const history = await listMunCommunications(c.req.param('munId'), c.get('session'))
  return c.json(history)
})

organizerCommunicationsRoutes.get('/organizer/muns/:munId/communications/audience', requireAuth, async (c) => {
  const { status, ...rest } = audienceQuerySchema.parse(c.req.query())
  const preview = await previewCommunicationAudience(c.req.param('munId'), { ...rest, statuses: status }, c.get('session'))
  return c.json(preview)
})

organizerCommunicationsRoutes.post(
  '/organizer/muns/:munId/communications',
  requireAuth,
  zValidator('json', sendBodySchema),
  async (c) => {
    const result = await sendMunCommunication(c.req.param('munId'), c.req.valid('json'), c.get('session'))
    return c.json(result, 201)
  },
)
