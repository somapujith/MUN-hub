/** In-memory sliding-window counter — per-instance until Redis (spec Section 11.9). */

import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { getRuntimeEnv } from '@/lib/runtime-env'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSec: 0 }
  }

  if (existing.count >= limit) {
    const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000)
    return { allowed: false, retryAfterSec }
  }

  existing.count += 1
  return { allowed: true, retryAfterSec: 0 }
}

/**
 * The client address rate limits are keyed on. Never trusts a header the
 * client itself can set:
 *
 * 1. Cloudflare Workers (the incoming Request carries a `cf` object):
 *    `CF-Connecting-IP`, which Cloudflare's edge always overwrites.
 * 2. `TRUST_PROXY_HEADERS=true` (Node behind a trusted reverse proxy): the
 *    LAST `X-Forwarded-For` entry — the one the proxy itself appended.
 *    Earlier entries are whatever the client sent.
 * 3. Node (`@hono/node-server`): the TCP socket's remote address.
 * 4. Otherwise (e.g. Hono's `app.request()` test helper, no socket): 'unknown'.
 *
 * Spoofable `X-Forwarded-For`/`X-Real-IP` values are ignored unless (2) is
 * explicitly configured.
 */
export function getClientIp(c: Context): string {
  const raw = c.req.raw as Request & { cf?: unknown }
  if (raw.cf && typeof raw.cf === 'object') {
    return c.req.header('cf-connecting-ip')?.trim() || 'unknown'
  }

  if (getRuntimeEnv('TRUST_PROXY_HEADERS') === 'true') {
    const hops = c.req.header('x-forwarded-for')?.split(',').map((hop) => hop.trim()).filter(Boolean)
    const proxied = hops?.at(-1)
    if (proxied) return proxied
  }

  return socketAddress(c) ?? 'unknown'
}

function socketAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: unknown; server?: { incoming?: unknown } } | undefined
  if (!env || !(env.incoming ?? env.server?.incoming)) return undefined
  try {
    return getConnInfo(c).remote.address || undefined
  } catch {
    return undefined
  }
}
