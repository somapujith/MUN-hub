import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { resendVerificationEmail, verifyEmail } from '@/lib/actions/email-verification'
import { runAfterResponse } from '../lib/after-response'
import type { AppVariables } from '../src/types'
import { resolveResetAppUrl } from './password-reset'

const verifyBodySchema = z.object({ token: z.string().min(1) }).strict()
const resendBodySchema = z.object({ email: z.string().trim().min(1).email() }).strict()

/**
 * Verification links carry a live token, so they're built exactly like
 * password-reset links: APP_URL in production, a loopback Origin only in local
 * development — never an arbitrary request Origin/Host.
 */
function resolveAppUrl(c: Context<{ Variables: AppVariables }>): string {
  return resolveResetAppUrl(c.req.header('Origin'))
}

export const emailVerificationRoutes = new Hono<{ Variables: AppVariables }>()

// Unauthenticated — the token itself is the credential, same as
// password-reset's confirm route. No session is guaranteed to exist yet
// (e.g. a user verifying from a different browser/device than they signed
// up on).
emailVerificationRoutes.post('/verify-email', async (c) => {
  const body = verifyBodySchema.parse(await c.req.json())
  await verifyEmail(body.token)

  return c.body(null, 204)
})

// Also unauthenticated (the "enter your email" resend form) and always
// resolves 204 regardless of whether `email` matches an account —
// lib/actions/email-verification.ts#resendVerificationEmail never reveals
// whether an account exists for a given address. The lookup, token write and
// mail-provider call all happen after the response (runAfterResponse) so
// response time doesn't reveal it either. Abuse limits: per-IP and per-email
// in server/middleware/rate-limit.ts, per-account cooldown + hourly cap in
// the action itself.
emailVerificationRoutes.post('/verify-email/resend', async (c) => {
  const body = resendBodySchema.parse(await c.req.json())
  await runAfterResponse(c, resendVerificationEmail(body.email, resolveAppUrl(c)), 'email-verification')

  return c.body(null, 204)
})
