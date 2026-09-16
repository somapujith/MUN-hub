import { createApp } from './app'

// Cloudflare Workers entrypoint for the Hono API (api.munhub.in).
// server/src/index.ts remains the Node entrypoint for local dev.
export default createApp()
