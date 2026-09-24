import { createMiddleware } from 'hono/factory'
import { runInBackground } from '@/lib/runtime-background'
import type { AppVariables } from '../src/types'

const SHARED_CACHEABLE = /(^|[\s,])public\b/
const HAS_S_MAXAGE = /(^|[\s,])s-maxage=\d/

/**
 * Cloudflare's `caches.default` (the Workers Cache API), typed locally
 * instead of as a global ambient declaration — `@cloudflare/workers-types`
 * declares its own conflicting `CacheStorage` (this codebase avoids that
 * package for the same reason web/src/server/cf-runtime.d.ts does), and a
 * hand-rolled global `interface CacheStorage` would itself collide with the
 * standard DOM one (no `.default` member) wherever a tsconfig with the "dom"
 * lib transitively typechecks this file — root's tsconfig.json does, via
 * server/integration/*.test.ts importing createApp. Reading through
 * `globalThis` sidesteps both.
 */
interface WorkersCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

function getWorkersCache(): WorkersCache | undefined {
  // Double cast: root's tsconfig.json (dom lib) already types `globalThis.caches`
  // as the standard, `.default`-less CacheStorage, which doesn't overlap with
  // the Workers-specific shape below closely enough for TS to allow directly.
  return (globalThis as unknown as { caches?: { default: WorkersCache } }).caches?.default
}

/**
 * Cloudflare's edge does not cache a Worker's own generated responses just
 * because they carry a `Cache-Control` header — that only happens for a
 * response explicitly stored through the Cache API (or a Cache Rule, which
 * this zone doesn't configure). Every public, non-personalized GET this API
 * marks `Cache-Control: public, ..., s-maxage=N` (marketplace listing, mun
 * detail, facets, FAQs, ...) was otherwise still hitting the Worker — and
 * sessionMiddleware's DB lookup, and Neon — on every single request from
 * every visitor worldwide. This is what actually makes that `s-maxage` do
 * something.
 *
 * Registered right after corsMiddleware/securityHeadersMiddleware in
 * server/src/app.ts: both of those set their headers on `c.res` on their way
 * back out of the middleware onion regardless of whether this middleware
 * served a cache hit or ran the full chain, so a cache hit is never missing
 * (or serving a stale) CORS/CSP header — see their own source for the
 * after-`next()` header writes this relies on. A hit also short-circuits
 * before body-limit/session/CSRF/rate-limit/the route handler ever run, so a
 * signed-in visitor's session-lookup query is skipped too, for a route that
 * never reads the session anyway.
 *
 * No-op outside Cloudflare Workers: the `caches` global doesn't exist in
 * local Node dev (server/src/index.ts) or Hono's `app.request()` test
 * helper — same guard style as hyperdrive-bridge.ts/wait-until.ts. Verify
 * with `npm run cf:preview` (Miniflare implements Cache API) before trusting
 * this in production; plain `npm run dev` never exercises this path at all.
 */
export const edgeCacheMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const cache = getWorkersCache()
  if (!cache || c.req.method !== 'GET') {
    await next()
    return
  }

  const cacheKey = c.req.raw

  const cached = await cache.match(cacheKey)
  if (cached) {
    c.res = cached
    return
  }

  await next()

  const res = c.res
  const cacheControl = res.headers.get('Cache-Control') ?? ''
  const isSharedCacheable =
    res.status === 200 &&
    SHARED_CACHEABLE.test(cacheControl) &&
    HAS_S_MAXAGE.test(cacheControl) &&
    !res.headers.has('Set-Cookie')

  if (isSharedCacheable) {
    // Store without making the caller wait for the write to land.
    runInBackground('edge-cache-put', () => cache.put(cacheKey, res.clone()))
  }
})
