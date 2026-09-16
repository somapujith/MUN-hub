import { createMiddleware } from 'hono/factory'
import type { AppVariables } from '../src/types'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
])

// Production origins: apex, www, the role subdomains, and any per-MUN wildcard
// host. Kept in sync with makeCorsOriginMatcher's MUNHUB_ORIGIN_PATTERN in
// server/src/app.ts — duplicated rather than imported to avoid an app.ts <->
// csrf.ts import cycle. Without this, every mutating request from the deployed
// SPA fails CSRF, because Origin (munhub.in) never equals the API host
// (api.munhub.in).
const MUNHUB_ORIGIN_PATTERN = /^https:\/\/([a-z0-9-]+\.)?munhub\.in$/

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true
  if (MUNHUB_ORIGIN_PATTERN.test(origin)) return true
  const extra = process.env.CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? ''
  return extra
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origin)
}

/** Origin/Referer allowlist for mutating /api/v1 routes (spec §4.4). Skipped in Vitest. */
export const csrfMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  if (process.env.VITEST === 'true') {
    await next()
    return
  }

  if (!MUTATING.has(c.req.method)) {
    await next()
    return
  }

  const origin = c.req.header('Origin') ?? c.req.header('Referer')?.replace(/\/[^/]*$/, '') ?? ''
  if (!origin || !isAllowedOrigin(origin)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'CSRF check failed' } }, 403)
  }

  await next()
})
