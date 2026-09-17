import { createMiddleware } from 'hono/factory'
import { isTrustedOrigin } from '../lib/origins'
import type { AppVariables } from '../src/types'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The origin a request claims to come from: the Origin header, or failing
 * that the origin of the Referer URL (scheme + host + port only — a
 * string-trimmed Referer could smuggle a path or userinfo past the check).
 */
export function requestOrigin(originHeader: string | undefined, refererHeader: string | undefined): string | null {
  if (originHeader) return originHeader
  if (!refererHeader) return null
  try {
    return new URL(refererHeader).origin
  } catch {
    return null
  }
}

/**
 * True when a request may proceed past CSRF: every read, and any mutating
 * request whose origin is one of the trusted web hosts (server/lib/origins.ts).
 * Per-MUN slug hosts are deliberately not trusted for writes.
 */
export function passesCsrfCheck(method: string, originHeader: string | undefined, refererHeader: string | undefined): boolean {
  if (!MUTATING.has(method)) return true
  const origin = requestOrigin(originHeader, refererHeader)
  return origin !== null && isTrustedOrigin(origin)
}

/** Origin/Referer allowlist for mutating /api/v1 routes (spec §4.4). Skipped in Vitest. */
export const csrfMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  if (process.env.VITEST === 'true') {
    await next()
    return
  }

  if (!passesCsrfCheck(c.req.method, c.req.header('Origin'), c.req.header('Referer'))) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'CSRF check failed' } }, 403)
  }

  await next()
})
