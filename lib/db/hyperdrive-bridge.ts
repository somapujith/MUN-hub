/**
 * Bridges a Cloudflare Workers Hyperdrive binding's connection string into
 * `lib/db/client.ts`.
 *
 * Why this exists: `lib/db/client.ts` is framework-agnostic (imported by
 * both the Next.js app and the Hono API) and has no direct access to Hono's
 * `c.env` binding context — Workers only hands you `env` inside a request
 * handler, not at module-import time. `server/middleware/hyperdrive.ts`
 * reads `c.env.HYPERDRIVE.connectionString` on each request (Cloudflare
 * Workers only — see the `hyperdrive` block in `server/wrangler.jsonc`) and
 * calls `setHyperdriveConnectionString` here; `lib/db/client.ts` builds its
 * Postgres client lazily (on first query, not at import time) specifically
 * so that middleware gets a chance to run first.
 *
 * Local Node dev/tests (`server/src/index.ts`, Next.js, Vitest) never call
 * `setHyperdriveConnectionString`, so `getHyperdriveConnectionString` stays
 * `undefined` there and `lib/db/client.ts` falls through to
 * `process.env.DATABASE_URL` exactly as before this change.
 */

declare global {
  // eslint-disable-next-line no-var -- must be `var` to attach to globalThis across module reloads
  var __hyperdriveConnectionString: string | undefined
}

export function setHyperdriveConnectionString(connectionString: string): void {
  globalThis.__hyperdriveConnectionString = connectionString
}

export function getHyperdriveConnectionString(): string | undefined {
  return globalThis.__hyperdriveConnectionString
}
