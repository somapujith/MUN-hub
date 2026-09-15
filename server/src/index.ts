import { serve } from '@hono/node-server'
import { assertProductionAuthConfigured } from '../lib/boot-guard'
import { createApp } from './app'

assertProductionAuthConfigured()

const app = createApp()
const port = Number(process.env.PORT ?? 3001)

console.log(`MUN Hub API listening on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
