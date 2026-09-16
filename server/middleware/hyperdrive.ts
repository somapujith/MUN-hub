import { createMiddleware } from 'hono/factory'
import { setHyperdriveConnectionString } from '@/lib/db/hyperdrive-bridge'
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
 */
export const hyperdriveMiddleware = createMiddleware<{
  Variables: AppVariables
  Bindings: HyperdriveBindings
}>(async (c, next) => {
  const connectionString = c.env?.HYPERDRIVE?.connectionString
  if (connectionString) {
    setHyperdriveConnectionString(connectionString)
  }
  await next()
})
