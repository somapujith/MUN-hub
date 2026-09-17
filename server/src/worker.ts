import { createApp } from './app'
import { handleScheduled, type ScheduledEnv, type ScheduledEventInfo } from './scheduled'

// Cloudflare Workers entrypoint for the Hono API (api.munhub.in).
// server/src/index.ts remains the Node entrypoint for local dev.
//
// DB connectivity: createApp() wires in hyperdriveMiddleware
// (../middleware/hyperdrive.ts) as its first middleware, which reads the
// `HYPERDRIVE` binding (configured in wrangler.jsonc) from `c.env` on each
// request and hands the connection string to lib/db/client.ts via
// lib/db/hyperdrive-bridge.ts. That indirection exists because plain modules
// like lib/db/client.ts have no direct access to Hono's `c.env`.
//
// `scheduled` runs the background jobs in lib/jobs/registry.ts on the cron
// schedule in wrangler.jsonc (`triggers.crons`), with the same env and
// Hyperdrive setup as a request — see ./scheduled.ts.
const app = createApp()

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledEventInfo, env: ScheduledEnv): Promise<void> {
    await handleScheduled(controller, env)
  },
}
