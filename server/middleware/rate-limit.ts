import type { MiddlewareHandler } from 'hono'
import { checkRateLimit, getClientIp } from '../lib/rate-limit-store'
import type { AppVariables } from '../src/types'

const WINDOW_MS = 60_000

type LimitRule = {
  match: (path: string, method: string) => boolean
  limit: number
  key: (ctx: { path: string; method: string; ip: string; sessionUserId: string | null; email?: string }) => string
}

const RULES: LimitRule[] = [
  {
    match: (path, method) => method === 'POST' && path === '/auth/session',
    limit: 5,
    key: ({ ip, email }) => `auth-session:ip:${ip}${email ? `:email:${email}` : ''}`,
  },
  {
    match: (path, method) => method === 'POST' && path === '/registrations',
    limit: 10,
    key: ({ sessionUserId }) => `registrations:session:${sessionUserId ?? 'anon'}`,
  },
  {
    match: (path, method) => method === 'GET' && path === '/products/availability',
    limit: 60,
    key: ({ ip }) => `products-availability:ip:${ip}`,
  },
  {
    match: (path, method) => method === 'GET' && path === '/muns',
    limit: 120,
    key: ({ ip }) => `muns-list:ip:${ip}`,
  },
]

/**
 * Rate limits per spec Section 4.6. Limits are per-instance (no Redis yet).
 * Webhook routes are mounted outside this middleware.
 */
export const rateLimitMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const path = c.req.path.replace(/^\/api\/v1/, '') || '/'
  const method = c.req.method
  const ip = getClientIp(c)
  const sessionUserId = c.get('session')?.userId ?? null

  let email: string | undefined
  if (method === 'POST' && path === '/auth/session') {
    try {
      const clone = c.req.raw.clone()
      const body = (await clone.json()) as { email?: string }
      email = body.email?.toLowerCase()
    } catch {
      // body parse failure handled by route validation
    }
  }

  for (const rule of RULES) {
    if (rule.match(path, method)) {
      const key = rule.key({ path, method, ip, sessionUserId, email })
      const result = checkRateLimit(key, rule.limit, WINDOW_MS)
      if (!result.allowed) {
        c.header('Retry-After', String(result.retryAfterSec))
        return c.json(
          { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
          429,
        )
      }
      await next()
      return
    }
  }

  const globalKey = `global:ip:${ip}`
  const global = checkRateLimit(globalKey, 300, WINDOW_MS)
  if (!global.allowed) {
    c.header('Retry-After', String(global.retryAfterSec))
    return c.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
      429,
    )
  }

  await next()
}
