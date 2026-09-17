import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { resendVerificationEmail, verifyEmail } from '@/lib/actions/email-verification'
import type { AppVariables } from '../src/types'

const verifyBodySchema = z.object({ token: z.string().min(1) }).strict()
const resendBodySchema = z.object({ email: z.string().trim().min(1).email() }).strict()

/**
 * Same Origin/Host resolution as server/routes/password-reset.ts's
 * resolveAppUrl — duplicated rather than imported/shared since these are two
 * small, independent routers and neither depends on the other existing.
 */
function resolveAppUrl(c: Context<{ Variables: AppVariables }>): string {
  const origin = c.req.header('Origin')
  if (origin) return origin

  const host = c.req.header('Host')
  const protocol = c.req.header('X-Forwarded-Proto') ?? 'https'
  return host ? `${protocol}://${host}` : 'http://localhost:3000'
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
// whether an account exists for a given address.
emailVerificationRoutes.post('/verify-email/resend', async (c) => {
  const body = resendBodySchema.parse(await c.req.json())
  await resendVerificationEmail(body.email, resolveAppUrl(c))

  return c.body(null, 204)
})
