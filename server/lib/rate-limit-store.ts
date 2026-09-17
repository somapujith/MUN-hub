/**
 * Rate-limit counters.
 *
 * On Cloudflare Workers every limit is backed by a Workers Rate Limiting
 * binding (server/wrangler.jsonc "ratelimits"), whose counters are shared by
 * all isolates in a Cloudflare location. An in-memory counter would be
 * per-isolate — each new isolate starts from zero — and so is only a
 * fallback: local Node dev, tests, and a deployment where a binding is
 * missing or erroring.
 */

import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { getRuntimeEnv } from '@/lib/runtime-env'

/** The Workers Rate Limiting binding API (`env.<NAME>.limit({ key })`). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface LimiterSpec {
  /** Binding name in server/wrangler.jsonc "ratelimits"; also namespaces the in-memory fallback. */
  binding: string
  /** Requests allowed per period. Must match the binding's `simple.limit`. */
  limit: number
  /** Window length. Workers bindings only support 10 or 60 seconds. */
  periodSeconds: 10 | 60
  /** Keys are client IPs: the fallback scales the limit by RATE_LIMIT_IP_MULTIPLIER. */
  perIp: boolean
  /** Replaces `limit` in the fallback when it returns a number (env overrides). */
  fallbackLimitOverride?: () => number | undefined
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec: number
}

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
/** Above this many live keys, expired buckets are swept before adding another. */
const SWEEP_THRESHOLD = 10_000

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key)
  }
}

/** In-memory fixed-window counter (per process / per isolate). */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now >= existing.resetAt) {
    if (!existing && buckets.size >= SWEEP_THRESHOLD) sweepExpired(now)
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

function positiveInt(raw: string | undefined): number | undefined {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * The limit the in-memory fallback enforces for `spec`. IP-keyed limits are
 * multiplied by RATE_LIMIT_IP_MULTIPLIER (default 1) — for local suites
 * where every request comes from one address. Neither override reaches the
 * Workers bindings, whose limits live in server/wrangler.jsonc.
 */
export function fallbackLimit(spec: LimiterSpec): number {
  const override = spec.fallbackLimitOverride?.()
  if (override !== undefined) return override
  const multiplier = spec.perIp ? (positiveInt(getRuntimeEnv('RATE_LIMIT_IP_MULTIPLIER')) ?? 1) : 1
  return spec.limit * multiplier
}

function asBinding(value: unknown): RateLimitBinding | undefined {
  if (value && typeof value === 'object' && typeof (value as RateLimitBinding).limit === 'function') {
    return value as RateLimitBinding
  }
  return undefined
}

/**
 * Counts one request against `spec` for `key`: through the Workers binding
 * named `spec.binding` when `env` carries one, otherwise (or if the binding
 * call fails) through the in-memory fallback.
 */
export async function consumeRateLimit(env: unknown, spec: LimiterSpec, key: string): Promise<RateLimitResult> {
  const binding = asBinding((env as Record<string, unknown> | undefined)?.[spec.binding])
  if (binding) {
    try {
      const { success } = await binding.limit({ key })
      return { allowed: success, retryAfterSec: success ? 0 : spec.periodSeconds }
    } catch (error) {
      console.error('[rate-limit] binding call failed; using the in-memory fallback', { binding: spec.binding, error })
    }
  }
  return checkRateLimit(`${spec.binding}:${key}`, fallbackLimit(spec), spec.periodSeconds * 1000)
}

/** Parses a positive integer env override (e.g. RATE_LIMIT_GLOBAL_PER_MINUTE); undefined when unset or invalid. */
export function positiveIntEnv(name: string): number | undefined {
  return positiveInt(getRuntimeEnv(name))
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
