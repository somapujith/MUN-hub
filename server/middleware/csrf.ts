import { createMiddleware } from 'hono/factory'
import type { AppVariables } from '../src/types'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
])

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
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'CSRF check failed' } }, 403)
  }

  await next()
})
