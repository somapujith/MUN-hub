import { Hono } from 'hono'
import { z } from 'zod'
import {
  acceptOrganizerAgreement,
  getOrganizerOnboarding,
  saveOrganizerDetailsStep,
  saveOrganizerMunStep,
  saveOrganizerPaymentStep,
  saveOrganizerProfileStep,
  updateOrganizerOrganization,
} from '@/lib/actions/organizer-onboarding'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

// Field formats are validated in lib/actions/organizer-onboarding.ts so the
// messages reach the form; these schemas only pin the shape.
const profileBodySchema = z
  .object({ firstName: z.string(), lastName: z.string(), contactPhone: z.string(), organization: z.string().optional() })
  .strict()
const munBodySchema = z.object({ munName: z.string(), munCity: z.string(), munStartDate: z.string() }).strict()
const detailsBodySchema = z
  .object({
    expectedDelegateCount: z.number(),
    munDescription: z.string(),
    previousEditions: z.string().optional(),
    websiteUrl: z.string().optional(),
  })
  .strict()
const paymentBodySchema = z
  .object({
    accountHolderName: z.string(),
    bankName: z.string(),
    bankAccountNumber: z.string(),
    ifscCode: z.string(),
    upiId: z.string().optional(),
    upiPhone: z.string().optional(),
  })
  .strict()
const agreementBodySchema = z.object({ accepted: z.boolean() }).strict()

const organizerOnly = [requireAuth, requireRole(['ORGANIZER'])] as const

/**
 * Organizer onboarding wizard (profile → MUN → delegates & details → payout
 * UPI → agreement, which submits the organizer application).
 */
export const organizerOnboardingRoutes = new Hono<{ Variables: AppVariables }>()

organizerOnboardingRoutes.get('/organizer/onboarding', ...organizerOnly, async (c) => {
  return c.json(await getOrganizerOnboarding(c.get('session')!))
})

// The host name delegates see; editable after onboarding too.
organizerOnboardingRoutes.put(
  '/organizer/organization',
  ...organizerOnly,
  zValidator('json', z.object({ organization: z.string() }).strict()),
  async (c) => c.json(await updateOrganizerOrganization(c.req.valid('json').organization, c.get('session')!)),
)

organizerOnboardingRoutes.put(
  '/organizer/onboarding/profile',
  ...organizerOnly,
  zValidator('json', profileBodySchema),
  async (c) => c.json(await saveOrganizerProfileStep(c.req.valid('json'), c.get('session')!)),
)

organizerOnboardingRoutes.put(
  '/organizer/onboarding/mun',
  ...organizerOnly,
  zValidator('json', munBodySchema),
  async (c) => c.json(await saveOrganizerMunStep(c.req.valid('json'), c.get('session')!)),
)

organizerOnboardingRoutes.put(
  '/organizer/onboarding/details',
  ...organizerOnly,
  zValidator('json', detailsBodySchema),
  async (c) => c.json(await saveOrganizerDetailsStep(c.req.valid('json'), c.get('session')!)),
)

organizerOnboardingRoutes.put(
  '/organizer/onboarding/payment',
  ...organizerOnly,
  zValidator('json', paymentBodySchema),
  async (c) => c.json(await saveOrganizerPaymentStep(c.req.valid('json'), c.get('session')!)),
)

organizerOnboardingRoutes.post(
  '/organizer/onboarding/agreement',
  ...organizerOnly,
  zValidator('json', agreementBodySchema),
  async (c) => c.json(await acceptOrganizerAgreement(c.req.valid('json'), c.get('session')!)),
)
