import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { isPublicReadOrigin, isTrustedOrigin } from '../lib/origins'
import type { AppVariables } from '../src/types'

// Two CORS policies, picked per request by origin tier (server/lib/origins.ts).
// Hono's cors() takes a single static `credentials` flag, so each tier gets its
// own instance rather than one instance trying to vary it.

const credentialedCors = cors({
  origin: (origin) => (isTrustedOrigin(origin) ? origin : null),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
})

// No Access-Control-Allow-Credentials: a slug host's fetch must use
// `credentials: 'omit'` to read the response at all, so it can only ever see
// anonymous data.
const publicReadCors = cors({
  origin: (origin) => (isPublicReadOrigin(origin) ? origin : null),
  credentials: false,
  allowMethods: ['GET', 'HEAD'],
  allowHeaders: ['Content-Type'],
})

const READ_METHODS = new Set(['GET', 'HEAD'])

function isReadRequest(c: Context): boolean {
  if (READ_METHODS.has(c.req.method)) return true
  // A GET that carries a non-simple header (e.g. Content-Type: application/json) is preflighted first.
  return (
    c.req.method === 'OPTIONS' &&
    READ_METHODS.has((c.req.header('Access-Control-Request-Method') ?? '').toUpperCase())
  )
}

export const corsMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const origin = c.req.header('Origin')

  if (origin && isTrustedOrigin(origin)) {
    return credentialedCors(c, next)
  }
  if (origin && isPublicReadOrigin(origin) && isReadRequest(c)) {
    return publicReadCors(c, next)
  }

  // Unknown origin, a slug host attempting a write, or no Origin at all
  // (same-origin, curl, server-to-server): no CORS headers. The response
  // still depends on Origin, so caches must key on it.
  await next()
  c.header('Vary', 'Origin', { append: true })
})
