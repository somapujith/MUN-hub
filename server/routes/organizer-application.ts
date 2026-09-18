import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  listMyOrganizerApplications,
  resubmitOrganizerApplication,
  submitOrganizerApplication,
} from '@/lib/actions/organizer-application'
import { ONBOARDING_ERRORS, isOrganizerOnboardingComplete } from '@/lib/actions/organizer-onboarding'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

// Shared by both a brand-new application (POST) and a Gate-1 resubmission
// (POST .../resubmit) — same answers, same shape.
const applicationFieldsSchema = z.object({
  conferenceName: z.string().min(1),
  expectedDate: z.union([z.string().datetime(), z.coerce.date()]),
  location: z.string().min(1),
  expectedDelegateCount: z.number().int().positive(),
  description: z.string().min(1),
  previousEditions: z.string().optional(),
  websiteUrl: z.string().url().optional(),
})

const submitApplicationBodySchema = applicationFieldsSchema.strict()
const resubmitApplicationBodySchema = applicationFieldsSchema.strict()

export const organizerApplicationRoutes = new Hono<{ Variables: AppVariables }>()

// The signed-in organizer's own applications (one per MUN), with Gate-1 reviewer notes.
organizerApplicationRoutes.get('/organizer/applications', requireAuth, requireRole(['ORGANIZER']), async (c) => {
  return c.json(await listMyOrganizerApplications(c.get('session')))
})

// ORGANIZER only. Organizer accounts are created separately
// (POST /auth/organizers); a delegate account can't apply to host, and nothing
// promotes one into an organizer.
organizerApplicationRoutes.post(
  '/organizer/applications',
  requireAuth,
  requireRole(['ORGANIZER']),
  zValidator('json', submitApplicationBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const session = c.get('session')
    // Hosting needs the organizer's profile, PAN, GST answer, payout UPI and
    // signed agreement on file first (lib/actions/organizer-onboarding.ts).
    if (!(await isOrganizerOnboardingComplete(session!.userId))) {
      throw new Error(ONBOARDING_ERRORS.incomplete)
    }
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

// Gate-1 loop: resubmits an EXISTING mun's application after MUN Hub
// requested changes (CHANGES_REQUESTED -> SUBMITTED). ORGANIZER only, and
// only the owning organizer — resubmitOrganizerApplication itself checks
// ownership and the current state (docs/review-to-claude.md item #1).
organizerApplicationRoutes.post(
  '/organizer/applications/:munId/resubmit',
  requireAuth,
  requireRole(['ORGANIZER']),
  zValidator('json', resubmitApplicationBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const session = c.get('session')
    const expectedDate = body.expectedDate instanceof Date ? body.expectedDate : new Date(body.expectedDate)

    const application = await resubmitOrganizerApplication(
      {
        munId: c.req.param('munId'),
        conferenceName: body.conferenceName,
        expectedDate,
        location: body.location,
        expectedDelegateCount: body.expectedDelegateCount,
        description: body.description,
        previousEditions: body.previousEditions,
        websiteUrl: body.websiteUrl,
      },
      session,
    )

    return c.json(application)
  },
)
