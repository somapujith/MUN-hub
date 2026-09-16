import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import { csrfMiddleware } from '../middleware/csrf'
import { errorHandler } from '../middleware/error'
import { rateLimitMiddleware } from '../middleware/rate-limit'
import { sessionMiddleware } from '../middleware/session'
import { apiV1 } from '../routes/index'
import { webhooks } from '../routes/webhooks'
import type { AppVariables } from './types'

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3000'
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
  const explicitOrigins = new Set(parseCorsOrigins())

  return (origin: string): string | undefined => {
    if (explicitOrigins.has(origin) || MUNHUB_ORIGIN_PATTERN.test(origin)) return origin
    return undefined
  }
}

/**
 * Base Hono app with the full middleware stack (spec Section 8.2):
 * request-id → logger → CORS → session → [webhooks outside CSRF] →
 * CSRF → rate-limit → /api/v1 routes → error handler
 */
export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>()

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
  app.route('/api/v1', apiV1)

  app.onError(errorHandler)

  return app
}

export { apiV1, webhooks }
