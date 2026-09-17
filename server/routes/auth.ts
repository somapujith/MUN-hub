import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { changePassword, signIn, signOut, signUp } from '@/lib/actions/auth'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

// Unset locally (host-only cookie, today's behavior). In production, set to
// ".munhub.in" so the session cookie is sent to app./organize./admin. too.
// getRuntimeEnv (not a module-level `process.env` read) because Workers never
// populate custom vars into `process.env` at all — see lib/runtime-env.ts.
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §5
function cookieDomain(): string | undefined {
  return getRuntimeEnv('COOKIE_DOMAIN') || undefined
}

const signInBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
    password: z.string().min(1),
  })
  .strict()

// Mirrors lib/actions/auth.ts's SignUpInput — required fields match
// completeStudentProfile's requirements plus gender + consent (PRD §9-16);
// everything else is optional, same as profile editing later.
const signUpBodySchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().min(1).email(),
    password: z.string().min(8),
    gender: z.string().trim().min(1),
    phone: z.string().trim().min(1),
    institution: z.string().trim().min(1),
    dateOfBirth: z.string().trim().min(1),
    gradeOrYear: z.string().trim().min(1),
    residentialAddress: z.string().trim().min(1),
    requiresTransportation: z.boolean().optional(),
    emergencyContactName: z.string().trim().min(1),
    emergencyContactPhone: z.string().trim().min(1),
    emergencyContactRelation: z.string().trim().min(1),
    acceptedTermsOfService: z.boolean(),
    acceptedPrivacyPolicy: z.boolean(),
    acceptedGuardianAcknowledgement: z.boolean().optional(),
    munExperience: z.string().optional(),
    referralCode: z.string().optional(),
    preferredName: z.string().optional(),
    nationality: z.string().optional(),
    addressCity: z.string().optional(),
    addressState: z.string().optional(),
    addressCountry: z.string().optional(),
    postalCode: z.string().optional(),
    alternateMobile: z.string().optional(),
    courseOrProgram: z.string().optional(),
    graduationYear: z.number().int().optional(),
    department: z.string().optional(),
    studentId: z.string().optional(),
    academicEmail: z.string().optional(),
    alternateEmergencyContactName: z.string().optional(),
    alternateEmergencyContactNumber: z.string().optional(),
    alternateEmergencyContactRelation: z.string().optional(),
    hasPriorMunExperience: z.boolean().optional(),
    munsAttendedCount: z.number().int().optional(),
    previousAchievements: z.string().optional(),
    bio: z.string().optional(),
    areasOfInterest: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    isPublicProfileVisible: z.boolean().optional(),
  })
  .strict()

const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .strict()

export const authRoutes = new Hono<{ Variables: AppVariables }>()

function setSessionCookie(c: Context<{ Variables: AppVariables }>, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    domain: cookieDomain(),
    maxAge: COOKIE_MAX_AGE_SECONDS,
    expires: expiresAt,
  })
}

authRoutes.post('/session', async (c) => {
  const body = signInBodySchema.parse(await c.req.json())
  const { userId, role, token, expiresAt } = await signIn(body.email, body.password)

  setSessionCookie(c, token, expiresAt)

  return c.json({ userId, role })
})

authRoutes.post('/users', async (c) => {
  const body = signUpBodySchema.parse(await c.req.json())
  const { userId, role, token, expiresAt } = await signUp(body)

  setSessionCookie(c, token, expiresAt)

  return c.json({ userId, role }, 201)
})

// Session-gated "change password while logged in" — see lib/actions/auth.ts's
// changePassword for how this differs from the signed-out reset flow in
// server/routes/password-reset.ts (which invalidates other sessions; this
// does not).
authRoutes.post('/session/password', requireAuth, async (c) => {
  const body = changePasswordBodySchema.parse(await c.req.json())
  await changePassword(body.currentPassword, body.newPassword, c.get('session')!)

  return c.body(null, 204)
})

authRoutes.delete('/session', async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME) ?? ''
  await signOut(token)

  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', domain: cookieDomain() })

  return c.body(null, 204)
})

// Explicit `?? null`: an unauthenticated request has no `session` var set, and
// `c.json(undefined)` serializes to an empty body the client can't distinguish
// from a network failure. `null` is an unambiguous "signed out".
authRoutes.get('/session', (c) => {
  const session = c.get('session')
  return c.json(session ?? null)
})
