#!/usr/bin/env node
// Runs a command with DATABASE_URL forced to the local Docker Postgres from
// docker-compose.yml, whatever `.env` or the shell says.
//
//   node scripts/with-local-db.mjs npx tsx lib/db/migrate.ts
//
// Why: lib/db/migrate.ts and lib/db/seed.ts load `.env`, which points at the
// production Neon database, and neither dotenv nor `node --env-file` override a
// DATABASE_URL already exported in the shell. `npm run db:migrate:local` /
// `db:seed:local` go through this wrapper so a local run can never reach Neon.
// LOCAL_DATABASE_URL may name another database, but only on this machine.
import { spawnSync } from 'node:child_process'

const DOCKER_DATABASE_URL = 'postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const databaseUrl = process.env.LOCAL_DATABASE_URL || DOCKER_DATABASE_URL
let host
try {
  host = new URL(databaseUrl).hostname
} catch {
  console.error('with-local-db: LOCAL_DATABASE_URL is not a valid URL.')
  process.exit(1)
}
if (!LOCAL_HOSTS.has(host)) {
  console.error(`with-local-db: refusing to run against "${host}"; LOCAL_DATABASE_URL must point at this machine.`)
  process.exit(1)
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node scripts/with-local-db.mjs <command> [...args]')
  process.exit(1)
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  // npx is a .cmd shim on Windows, which spawnSync can only start through a shell.
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: databaseUrl },
})
if (result.error) {
  console.error(`with-local-db: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
