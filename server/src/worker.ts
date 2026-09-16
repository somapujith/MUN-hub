import { createApp } from './app'

// Cloudflare Workers entrypoint for the Hono API (api.munhub.in).
// server/src/index.ts remains the Node entrypoint for local dev.
//
// DB connectivity: createApp() wires in hyperdriveMiddleware
// (../middleware/hyperdrive.ts) as its first middleware, which reads the
// `HYPERDRIVE` binding (configured in wrangler.jsonc, see its TODO there)
// from `c.env` on each request and hands the connection string to
// lib/db/client.ts via lib/db/hyperdrive-bridge.ts. That indirection exists
// because plain modules like lib/db/client.ts have no direct access to
// Hono's `c.env`.
export default createApp()
