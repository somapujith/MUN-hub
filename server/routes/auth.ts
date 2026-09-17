import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { changePassword, signIn, signOut, signUp } from '@/lib/actions/auth'
import { sendVerificationEmail } from '@/lib/actions/email-verification'
import { requestOrganizerLoginCode, verifyOrganizerLoginCode } from '@/lib/actions/organizer-otp'
import {
  beginMfaEnrollment,
  completeMfaChallenge,
  confirmMfaEnrollment,
  disableMfa,
  getMfaEnrollmentStatus,
  regenerateMfaRecoveryCodes,
} from '@/lib/actions/staff-mfa'
import { SESSION_COOKIE_NAME, SESSION_MAX_LIFETIME_MS } from '@/lib/auth/session'
import { notifyWelcome } from '@/lib/notifications/welcome-email'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { TURNSTILE_ACTIONS, TURNSTILE_TOKEN_MAX_LENGTH, turnstileRejection } from '../lib/turnstile'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'
import { resolveResetAppUrl } from './password-reset'

// The cookie lives as long as a session possibly can (the absolute cap);
// the server-side idle deadline in lib/auth/session.ts decides whether the
// session behind it is still valid.
const COOKIE_MAX_AGE_SECONDS = SESSION_MAX_LIFETIME_MS / 1000

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Whether the session cookie carries `Secure`. COOKIE_SECURE=true|false
 * decides outright (production sets true in server/wrangler.jsonc). Unset,
 * the cookie is Secure for every request except plain http to a loopback
 * host — local dev, the E2E suite and Hono's test helper — so a deployment
 * that forgot the variable still gets Secure cookies rather than depending
 * on NODE_ENV (which Workers doesn't expose to getRuntimeEnv).
 */
export function sessionCookieSecure(requestUrl: string): boolean {
  const configured = getRuntimeEnv('COOKIE_SECURE')?.trim().toLowerCase()
  if (configured === 'true') return true
  if (configured === 'false') return false

  const url = new URL(requestUrl)
  return !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
}

const turnstileTokenSchema = z.string().max(TURNSTILE_TOKEN_MAX_LENGTH).optional()

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
    turnstileToken: turnstileTokenSchema,
  })
  .strict()

const organizerCodeRequestBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
    turnstileToken: turnstileTokenSchema,
  })
  .strict()

// `profile` is only sent for a brand-new organizer, after the first verify
// answered PROFILE_REQUIRED. Deliberately none of the delegate profile fields.
const organizerCodeVerifyBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
    code: z.string().trim().regex(/^\d{6}$/),
    profile: z
      .object({
        name: z.string().trim().min(1),
        phone: z.string().optional(),
        acceptedTermsOfService: z.boolean(),
        acceptedPrivacyPolicy: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()

const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .strict()

const mfaChallengeBodySchema = z
  .object({
    pendingToken: z.string().trim().min(1).max(256),
    code: z.string().trim().min(1).max(32),
  })
  .strict()

const mfaConfirmBodySchema = z.object({ code: z.string().trim().min(1).max(32) }).strict()
const mfaCodeBodySchema = z.object({ code: z.string().trim().min(1).max(32) }).strict()

export const authRoutes = new Hono<{ Variables: AppVariables }>()

function setSessionCookie(c: Context<{ Variables: AppVariables }>, token: string) {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: sessionCookieSecure(c.req.url),
    sameSite: 'Lax',
    path: '/',
    domain: cookieDomain(),
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
}

authRoutes.post('/session', async (c) => {
  const body = signInBodySchema.parse(await c.req.json())
  const result = await signIn(body.email, body.password)

  if (result.status === 'MFA_REQUIRED') {
    return c.json({ status: result.status, pendingToken: result.pendingToken })
  }

  setSessionCookie(c, result.token)

  return c.json({ status: result.status, userId: result.userId, role: result.role })
})

// Step 2 of staff sign-in when the account has confirmed TOTP enrollment
// (lib/actions/staff-mfa.ts). `pendingToken` is the one POST /session just
// returned; `code` is either a 6-digit TOTP or an XXXXX-XXXXX recovery code.
authRoutes.post('/session/mfa', async (c) => {
  const body = mfaChallengeBodySchema.parse(await c.req.json())
  const { userId, role, token } = await completeMfaChallenge(body.pendingToken, body.code)

  setSessionCookie(c, token)

  return c.json({ status: 'SIGNED_IN', userId, role })
})

// Staff TOTP enrollment (lib/actions/staff-mfa.ts). requireAuth only, not
// requireRole([...STAFF_ROLES]): a staff account with REQUIRE_STAFF_2FA
// enforced but not yet enrolled would otherwise never be able to reach the
// one flow that lets it enroll. The action itself still rejects a non-staff
// caller (MFA_ERRORS.staffOnly).
authRoutes.get('/mfa/status', requireAuth, async (c) => {
  return c.json(await getMfaEnrollmentStatus(c.get('session')!))
})

authRoutes.post('/mfa/setup', requireAuth, async (c) => {
  return c.json(await beginMfaEnrollment(c.get('session')!))
})

authRoutes.post('/mfa/confirm', requireAuth, async (c) => {
  const body = mfaConfirmBodySchema.parse(await c.req.json())
  return c.json(await confirmMfaEnrollment(body.code, c.get('session')!))
})

// Self-service — both require a fresh code (TOTP for regenerate; TOTP or
// recovery code for disable) to prove it's really the account holder, not
// just whoever currently has the session cookie.
authRoutes.post('/mfa/recovery-codes', requireAuth, async (c) => {
  const body = mfaCodeBodySchema.parse(await c.req.json())
  return c.json(await regenerateMfaRecoveryCodes(body.code, c.get('session')!))
})

authRoutes.post('/mfa/disable', requireAuth, async (c) => {
  const body = mfaCodeBodySchema.parse(await c.req.json())
  await disableMfa(body.code, c.get('session')!)
  return c.body(null, 204)
})

// Delegate self-signup. Behind Turnstile when TURNSTILE_SECRET_KEY is set
// (server/lib/turnstile.ts), plus a per-IP rate limit.
authRoutes.post('/users', async (c) => {
  const { turnstileToken, ...input } = signUpBodySchema.parse(await c.req.json())
  const rejection = await turnstileRejection(c, turnstileToken, TURNSTILE_ACTIONS.delegateSignup)
  if (rejection) return rejection

  const { userId, role, token } = await signUp(input)

  setSessionCookie(c, token)

  // The account already exists, so a failed email is logged and never fails
  // the signup. Awaited, not fire-and-forget: on Workers, work still pending
  // after the response is sent can be dropped. The verification link is built
  // like a reset link — never from an untrusted Origin in production.
  try {
    await sendVerificationEmail(userId, resolveResetAppUrl(c.req.header('Origin')))
  } catch (error) {
    console.error('[signup] verification email failed', error)
  }
  try {
    await notifyWelcome(userId)
  } catch (error) {
    console.error('[signup] welcome email failed', error)
  }

  return c.json({ userId, role }, 201)
})

// Passwordless organizer sign-in / sign-up (lib/actions/organizer-otp.ts).
// Step 1 emails a 6-digit code. The response is identical whether or not the
// address has an account, so it can't be used to discover registered emails.
// Behind Turnstile when TURNSTILE_SECRET_KEY is set: each request sends an email.
authRoutes.post('/organizers/code', async (c) => {
  const body = organizerCodeRequestBodySchema.parse(await c.req.json())
  const rejection = await turnstileRejection(c, body.turnstileToken, TURNSTILE_ACTIONS.organizerCode)
  if (rejection) return rejection

  await requestOrganizerLoginCode(body.email)

  return c.body(null, 204)
})

// Step 2 checks the code. This is the only way an ORGANIZER account comes into
// existence — a delegate account is never turned into an organizer one.
authRoutes.post('/organizers/session', async (c) => {
  const body = organizerCodeVerifyBodySchema.parse(await c.req.json())
  const result = await verifyOrganizerLoginCode(body)

  if (result.status === 'PROFILE_REQUIRED') {
    return c.json({ status: result.status })
  }

  setSessionCookie(c, result.token)

  return c.json(
    { status: result.status, userId: result.userId, role: result.role, isNewAccount: result.isNewAccount },
    result.isNewAccount ? 201 : 200,
  )
})

// Session-gated "change password while logged in" — see lib/actions/auth.ts's
// changePassword. Signs the user out of every other session; the one making
// the change (identified by its cookie) stays signed in. The signed-out reset
// flow in server/routes/password-reset.ts ends every session.
authRoutes.post('/session/password', requireAuth, async (c) => {
  const body = changePasswordBodySchema.parse(await c.req.json())
  const currentToken = getCookie(c, SESSION_COOKIE_NAME) ?? ''
  await changePassword(body.currentPassword, body.newPassword, c.get('session')!, currentToken)

  return c.body(null, 204)
})

authRoutes.delete('/session', async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME) ?? ''
  await signOut(token)

  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    domain: cookieDomain(),
    secure: sessionCookieSecure(c.req.url),
  })

  return c.body(null, 204)
})

// Explicit `?? null`: an unauthenticated request has no `session` var set, and
// `c.json(undefined)` serializes to an empty body the client can't distinguish
// from a network failure. `null` is an unambiguous "signed out".
authRoutes.get('/session', (c) => {
  const session = c.get('session')
  return c.json(session ?? null)
})
