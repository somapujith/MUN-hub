import { createMiddleware } from 'hono/factory'
import { runWithHyperdriveConnectionString } from '@/lib/db/hyperdrive-bridge'
import type { AppVariables } from '../src/types'

type HyperdriveBindings = {
  // Configured in server/wrangler.jsonc's "hyperdrive" block. Only present
  // when running under Wrangler/Cloudflare Workers — absent (and this
  // middleware a no-op) for local Node dev (server/src/index.ts), where
  // `c.env` is @hono/node-server's `{ incoming, outgoing }` object, and for
  // Hono's `app.request(...)` test helper (server/integration/*.test.ts),
  // which calls handlers with `c.env` entirely `undefined`.
  HYPERDRIVE?: { connectionString: string }
}

/**
 * Hands `lib/db/client.ts` the Hyperdrive connection string via
 * `lib/db/hyperdrive-bridge.ts`, since that module has no direct access to
 * Hono's `c.env`. Must run before any route handler that touches `db` —
 * registered first in `server/src/app.ts`.
 *
 * Runs the rest of the request (`next()`) *inside*
 * `runWithHyperdriveConnectionString`'s AsyncLocalStorage scope, not just
 * before it, so every downstream `lib/db/client.ts` call in this request's
 * async call graph resolves to a client scoped to THIS request — see
 * `lib/db/hyperdrive-bridge.ts`'s header comment for why that matters
 * (Workers ties I/O objects to the request that created them).
 */
export const hyperdriveMiddleware = createMiddleware<{
  Variables: AppVariables
  Bindings: HyperdriveBindings
}>(async (c, next) => {
  const connectionString = c.env?.HYPERDRIVE?.connectionString
  if (connectionString) {
    await runWithHyperdriveConnectionString(connectionString, () => next())
  } else {
    await next()
  }
})
