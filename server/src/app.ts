import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import { csrfMiddleware } from '../middleware/csrf'
import { errorHandler } from '../middleware/error'
import { hyperdriveMiddleware } from '../middleware/hyperdrive'
import { rateLimitMiddleware } from '../middleware/rate-limit'
import { runtimeEnvMiddleware } from '../middleware/runtime-env'
import { sessionMiddleware } from '../middleware/session'
import { storageMiddleware } from '../middleware/storage'
import { filesRoutes } from '../routes/files'
import { apiV1 } from '../routes/index'
import { munLifecycleRoutes } from '../routes/mun-lifecycle'
import { webhooks } from '../routes/webhooks'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { AppVariables } from './types'

function parseCorsOrigins(): string[] {
  // getRuntimeEnv (not process.env directly) so this reflects the current
  // request's Workers `c.env` — see lib/runtime-env.ts. Must be read fresh
  // per call, not cached at createApp()-time, since createApp() runs once at
  // Workers cold start, before runtimeEnvMiddleware has bridged anything.
  const raw = getRuntimeEnv('CORS_ORIGINS') ?? getRuntimeEnv('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://localhost:3000'
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

// Any subdomain of munhub.in (apex, www, app, organize, admin, or a per-MUN
// slug on the wildcard host) — covers the role-subdomain + wildcard-subdomain
// architecture. docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §6
const MUNHUB_ORIGIN_PATTERN = /^https:\/\/([a-z0-9-]+\.)?munhub\.in$/

export function makeCorsOriginMatcher() {
  return (origin: string): string | undefined => {
    if (new Set(parseCorsOrigins()).has(origin) || MUNHUB_ORIGIN_PATTERN.test(origin)) return origin
    return undefined
  }
}

/**
 * Base Hono app with the full middleware stack (spec Section 8.2):
 * runtime-env bridge → hyperdrive-bridge (both Workers-only, see below) →
 * storage bindings → request-id → logger → CORS → session →
 * [webhooks outside CSRF] → CSRF → rate-limit → /api/v1/files + /api/v1
 * routes → error handler
 */
export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>()

  // Must run before anything that might read a bridged var/secret (CORS's
  // origin matcher below, session cookie domain, payment key/webhook secret)
  // or touch `db` — see lib/runtime-env.ts / lib/db/hyperdrive-bridge.ts.
  app.use('*', runtimeEnvMiddleware)
  app.use('*', hyperdriveMiddleware)
  // Upload storage bindings + request origin for lib/storage, scoped to the
  // request — see lib/storage/bindings.ts.
  app.use('*', storageMiddleware)
  app.use('*', requestId())
  app.use('*', logger())
  app.use(
    '*',
    cors({
      origin: makeCorsOriginMatcher(),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    }),
  )
  app.use('*', sessionMiddleware)

  // Webhooks: outside CSRF and outside /api/v1 (spec Section 4.4)
  app.route('/webhooks', webhooks)

  // CSRF + rate-limit scoped to /api/v1 only
  app.use('/api/v1/*', csrfMiddleware)
  app.use('/api/v1/*', rateLimitMiddleware)
  // Public uploaded files (logos, covers, PDFs) — server/routes/files.ts
  app.route('/api/v1/files', filesRoutes)
  app.route('/api/v1', apiV1)
  app.route('/api/v1', munLifecycleRoutes)

  app.onError(errorHandler)

  return app
}

export { apiV1, webhooks }
