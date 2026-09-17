import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import { bodyLimitMiddleware } from '../middleware/body-limit'
import { corsMiddleware } from '../middleware/cors'
import { csrfMiddleware } from '../middleware/csrf'
import { errorHandler } from '../middleware/error'
import { hyperdriveMiddleware } from '../middleware/hyperdrive'
import { rateLimitMiddleware } from '../middleware/rate-limit'
import { runtimeEnvMiddleware } from '../middleware/runtime-env'
import { securityHeadersMiddleware } from '../middleware/security-headers'
import { sessionMiddleware } from '../middleware/session'
import { storageMiddleware } from '../middleware/storage'
import { waitUntilMiddleware } from '../middleware/wait-until'
import { filesRoutes } from '../routes/files'
import { apiV1 } from '../routes/index'
import { munLifecycleRoutes } from '../routes/mun-lifecycle'
import { apiHostRobotsTxt } from '../routes/sitemap'
import { webhooks } from '../routes/webhooks'
import type { AppVariables } from './types'

/**
 * Base Hono app with the full middleware stack (spec Section 8.2):
 * runtime-env bridge → hyperdrive-bridge (both Workers-only, see below) →
 * storage bindings → waitUntil bridge → request-id → security headers → logger → CORS →
 * body limit → session → [webhooks outside CSRF] → CSRF → rate-limit →
 * /api/v1/files + /api/v1 routes → JSON 404 / error handler
 */
export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>()

  // Must run before anything that might read a bridged var/secret (CORS's
  // origin checks below, session cookie domain, payment key/webhook secret)
  // or touch `db` — see lib/runtime-env.ts / lib/db/hyperdrive-bridge.ts.
  app.use('*', runtimeEnvMiddleware)
  app.use('*', hyperdriveMiddleware)
  // Upload storage bindings + request origin for lib/storage, scoped to the
  // request — see lib/storage/bindings.ts.
  app.use('*', storageMiddleware)
  // The request's waitUntil for lib/ post-response work (lib/runtime-background.ts).
  app.use('*', waitUntilMiddleware)
  app.use('*', requestId())
  // Ahead of everything that can answer (CORS preflights, 413s, errors) so
  // every response carries the headers.
  app.use('*', securityHeadersMiddleware)
  app.use('*', logger())
  // Trusted web hosts get credentialed CORS; per-MUN slug hosts get anonymous
  // reads only (server/lib/origins.ts). The origin checks read CORS_ORIGINS /
  // ALLOW_LOCALHOST_ORIGINS per request, never at createApp() time.
  app.use('*', corsMiddleware)
  // Before anything reads a body (rate-limit reads sign-in emails, validators
  // parse JSON).
  app.use('*', bodyLimitMiddleware)
  app.use('*', sessionMiddleware)

  // The API host's own robots.txt: keeps crawlers off the JSON and points them
  // at the sitemap. The web hosts serve web/public/robots.txt.
  app.get('/robots.txt', apiHostRobotsTxt)

  // Webhooks: outside CSRF and outside /api/v1 (spec Section 4.4)
  app.route('/webhooks', webhooks)

  // CSRF + rate-limit scoped to /api/v1 only
  app.use('/api/v1/*', csrfMiddleware)
  app.use('/api/v1/*', rateLimitMiddleware)
  // Public uploaded files (logos, covers, PDFs) — server/routes/files.ts
  app.route('/api/v1/files', filesRoutes)
  app.route('/api/v1', apiV1)
  app.route('/api/v1', munLifecycleRoutes)

  // Hono's default 404 is a plain-text body; keep every API answer JSON.
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))
  app.onError(errorHandler)

  return app
}

export { apiV1, webhooks }
