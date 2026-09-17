import { Hono } from 'hono'
import { z } from 'zod'
import {
  completeStudentProfile,
  getProfileFormDefaults,
  getStudentProfile,
  isProfileComplete,
} from '@/lib/actions/student-profile'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const completeProfileBodySchema = z
  .object({
    phone: z.string().min(1),
    institution: z.string().min(1),
    dateOfBirth: z.string().min(1),
    gradeOrYear: z.string().min(1),
    residentialAddress: z.string().min(1),
    requiresTransportation: z.boolean(),
    emergencyContactName: z.string().min(1),
    emergencyContactPhone: z.string().min(1),
    emergencyContactRelation: z.string().min(1),
    munExperience: z.string().optional(),
    referralCode: z.string().optional(),
  })
  .strict()

export const studentProfileRoutes = new Hono<{ Variables: AppVariables }>()

studentProfileRoutes.get('/profile', requireAuth, async (c) => {
  const profile = await getStudentProfile(c.get('session')!)
  return c.json(profile)
})

studentProfileRoutes.get('/profile/complete', requireAuth, async (c) => {
  const complete = await isProfileComplete(c.get('session')!.userId)
  return c.json({ complete })
})

// The profile mapped onto the per-mun registration form's own `fieldKey`s
// (grade_class, emergency_contact_phone, …), so the registration funnel can
// pre-fill matching questions. Served rather than mapped client-side so the
// key mapping has exactly one definition — lib/actions/student-profile.ts's
// getProfileFormDefaults — instead of a copy in the SPA that silently drifts
// when a field key changes. Returns {} when no profile exists yet.
studentProfileRoutes.get('/profile/form-defaults', requireAuth, async (c) => {
  const defaults = await getProfileFormDefaults(c.get('session')!)
  return c.json(defaults)
})

studentProfileRoutes.put(
  '/profile',
  requireAuth,
  zValidator('json', completeProfileBodySchema),
  async (c) => {
    const profile = await completeStudentProfile(c.req.valid('json'), c.get('session')!)
    return c.json(profile)
  },
)
