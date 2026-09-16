import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requestPasswordReset, resetPassword } from '@/lib/actions/password-reset'
import type { AppVariables } from '../src/types'

const requestResetBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
  })
  .strict()

const confirmResetBodySchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .strict()

/**
 * Resolves the origin to build the reset link against. Prefers the `Origin`
 * header (present on the browser fetch() calls this API is actually served
 * from) and falls back to `Host` + `X-Forwarded-Proto`, mirroring the
 * next/headers-based resolution `app/forgot-password/actions.ts` used before
 * this route existed — kept framework-agnostic (lib/actions/password-reset.ts
 * takes a plain `appUrl` string, never imports next/headers or Hono types).
 */
function resolveAppUrl(c: Context<{ Variables: AppVariables }>): string {
  const origin = c.req.header('Origin')
  if (origin) return origin

  const host = c.req.header('Host')
  const protocol = c.req.header('X-Forwarded-Proto') ?? 'https'
  return host ? `${protocol}://${host}` : 'http://localhost:3000'
}

export const passwordResetRoutes = new Hono<{ Variables: AppVariables }>()

// Signed-out "forgot password" flow — deliberately unauthenticated (there is
// no session yet). Always resolves 204 regardless of whether `email` matches
// an account; lib/actions/password-reset.ts#requestPasswordReset never
// reveals whether an account exists for a given address.
passwordResetRoutes.post('/password-reset/request', async (c) => {
  const body = requestResetBodySchema.parse(await c.req.json())
  await requestPasswordReset(body.email, resolveAppUrl(c))

  return c.body(null, 204)
})

// Consumes the emailed token. Also unauthenticated — the token itself is the
// credential. On success this invalidates every existing session for the
// account (lib/actions/password-reset.ts#resetPassword), unlike
// server/routes/auth.ts's session-gated POST /session/password.
passwordResetRoutes.post('/password-reset/confirm', async (c) => {
  const body = confirmResetBodySchema.parse(await c.req.json())
  await resetPassword(body.token, body.newPassword)

  return c.body(null, 204)
})
