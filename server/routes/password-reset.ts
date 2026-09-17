import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requestPasswordReset, resetPassword } from '@/lib/actions/password-reset'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { isProductionRuntime } from '@/lib/runtime-platform'
import { runAfterResponse } from '../lib/after-response'
import type { AppVariables } from '../src/types'

const requestResetBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
  })
  .strict()

const confirmResetBodySchema = z
  .object({
    token: z.string().min(1).max(256),
    newPassword: z.string().min(8),
  })
  .strict()

const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/
const DEV_FALLBACK_APP_URL = 'http://localhost:5173'

/**
 * The origin reset links point at. A reset link carries a live credential,
 * so it is never built from a request header an attacker controls (an
 * `Origin`/`Host` of their choosing would send the victim's token to their
 * site):
 *
 * - Production (Workers, or NODE_ENV=production): always APP_URL. Missing
 *   APP_URL is a misconfiguration and fails the request.
 * - Local development: a loopback `Origin` (the Vite dev server on whatever
 *   port) is used as-is, so links open the SPA being developed; otherwise
 *   APP_URL, otherwise the default Vite dev URL.
 */
export function resolveResetAppUrl(origin: string | undefined): string {
  const configured = getRuntimeEnv('APP_URL')?.trim().replace(/\/+$/, '')

  if (isProductionRuntime()) {
    if (!configured) throw new Error('APP_URL must be set to build password-reset links')
    return configured
  }

  if (origin && LOOPBACK_ORIGIN.test(origin)) return origin
  return configured || DEV_FALLBACK_APP_URL
}

function resolveAppUrl(c: Context<{ Variables: AppVariables }>): string {
  return resolveResetAppUrl(c.req.header('Origin'))
}

export const passwordResetRoutes = new Hono<{ Variables: AppVariables }>()

// Signed-out "forgot password" flow — deliberately unauthenticated (there is
// no session yet). Always resolves 204 regardless of whether `email` matches
// an account; lib/actions/password-reset.ts#requestPasswordReset never
// reveals whether an account exists for a given address. The work runs after
// the response (runAfterResponse) so response time doesn't reveal it either:
// a registered address costs a token write plus a mail-provider round-trip,
// an unknown one costs one indexed lookup.
passwordResetRoutes.post('/password-reset/request', async (c) => {
  const body = requestResetBodySchema.parse(await c.req.json())
  await runAfterResponse(c, requestPasswordReset(body.email, resolveAppUrl(c)), 'password-reset')

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
