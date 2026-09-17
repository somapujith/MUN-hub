import { getRuntimeEnv } from '@/lib/runtime-env'

// -----------------------------------------------------------------------------
// Which browser origins the API trusts — shared by CORS (server/middleware/
// cors.ts) and CSRF (server/middleware/csrf.ts), so the two can never drift.
// -----------------------------------------------------------------------------
//
// Two tiers:
//
//  1. Trusted origins get credentialed CORS and pass the CSRF check: the
//     marketplace, student, organizer and admin hosts, exact match only. This
//     used to be a `*.munhub.in` pattern, which also handed the session cookie's
//     powers to every per-MUN slug host and to any subdomain that might ever
//     point somewhere we don't control.
//  2. Per-MUN slug hosts (`<slug>.munhub.in`, served by the same SPA build) get
//     NON-credentialed CORS on reads only. The browser never attaches cookies to
//     a request it could read the answer to, so a slug host sees exactly what an
//     anonymous visitor sees — the public MUN page is all it renders.
//
// Localhost is trusted only when ALLOW_LOCALHOST_ORIGINS=true (local dev, tests,
// E2E) — never by default, so a production deploy can't inherit it. Extra exact
// origins (e.g. a Vercel preview) go in CORS_ORIGINS.

/** Production web hosts that may call the API with the session cookie. */
export const TRUSTED_WEB_ORIGINS: readonly string[] = [
  'https://munhub.in',
  'https://www.munhub.in',
  'https://app.munhub.in',
  'https://publish.munhub.in',
  'https://organize.munhub.in',
  'https://admin.munhub.in',
]

const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/
const MUN_SLUG_HOST_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.munhub\.in$/

/** CORS_ORIGINS (or the legacy ALLOWED_ORIGINS), comma-separated, exact match. Read per call — see lib/runtime-env.ts. */
function configuredExtraOrigins(): string[] {
  const raw = getRuntimeEnv('CORS_ORIGINS') ?? getRuntimeEnv('ALLOWED_ORIGINS') ?? ''
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/** True for an origin that may make credentialed and state-changing requests. */
export function isTrustedOrigin(origin: string): boolean {
  if (TRUSTED_WEB_ORIGINS.includes(origin)) return true
  if (configuredExtraOrigins().includes(origin)) return true
  return getRuntimeEnv('ALLOW_LOCALHOST_ORIGINS') === 'true' && LOCALHOST_ORIGIN_PATTERN.test(origin)
}

/** True for a per-MUN slug host: anonymous (non-credentialed) reads only. */
export function isPublicReadOrigin(origin: string): boolean {
  return MUN_SLUG_HOST_ORIGIN_PATTERN.test(origin) && !isTrustedOrigin(origin)
}
