import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { submitOrganizerApplication } from '@/lib/actions/organizer-application'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const submitApplicationBodySchema = z
  .object({
    conferenceName: z.string().min(1),
    expectedDate: z.union([z.string().datetime(), z.coerce.date()]),
    location: z.string().min(1),
    expectedDelegateCount: z.number().int().positive(),
    description: z.string().min(1),
    previousEditions: z.string().optional(),
    websiteUrl: z.string().url().optional(),
  })
  .strict()

export const organizerApplicationRoutes = new Hono<{ Variables: AppVariables }>()

// Any authenticated user (STUDENT included) can apply — becoming an organizer
// IS what this endpoint does; requiring ORGANIZER role first would make it
// unreachable by the exact users it's for. Matches the pre-migration Next.js
// behavior (app/organizer/apply/actions.ts, since deleted), which only ever
// checked for a session, never a role.
organizerApplicationRoutes.post(
  '/organizer/applications',
  requireAuth,
  zValidator('json', submitApplicationBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const session = c.get('session')
    const expectedDate = body.expectedDate instanceof Date ? body.expectedDate : new Date(body.expectedDate)

    const application = await submitOrganizerApplication({
      organizerId: session!.userId,
      conferenceName: body.conferenceName,
      expectedDate,
      location: body.location,
      expectedDelegateCount: body.expectedDelegateCount,
      description: body.description,
      previousEditions: body.previousEditions,
      websiteUrl: body.websiteUrl,
    })

    return c.json(application, 201)
  },
)
