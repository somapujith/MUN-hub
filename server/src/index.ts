import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config } from 'dotenv'
// Local Node dev only (this file, not worker.ts — Cloudflare Workers get
// their vars via c.env/getRuntimeEnv, never touches this entrypoint or
// process.env at all). Every other script in this repo (lib/db/migrate.ts,
// lib/db/seed.ts, ...) loads .env explicitly the same way; this one didn't,
// which meant `npm run dev` silently ran with no DATABASE_URL/CORS_ORIGINS/
// etc. unless the shell happened to already have them exported — found while
// verifying a UI fix: /health (no DB) returned 200, but /muns (DB-backed)
// 500'd, and cross-origin requests from the web dev server failed CORS
// because CORS_ORIGINS was unset. Resolved relative to this file (not
// `process.cwd()`) since `npm --prefix server run dev` and `cd server &&
// npm run dev` leave the cwd at `server/`, not the repo root where `.env`
// actually lives.
const REPO_ROOT_ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')
config({ path: REPO_ROOT_ENV })
import { serve } from '@hono/node-server'
import { assertProductionAuthConfigured } from '../lib/boot-guard'
import { createApp } from './app'

assertProductionAuthConfigured()

const app = createApp()
const port = Number(process.env.PORT ?? 3001)

console.log(`MUN Hub API listening on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
