import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// !! WARNING -- THIS CONNECTS TO LIVE NEON BY DEFAULT !!
// `.env` in this repo holds the team's shared live Neon DATABASE_URL. Running
// this script with no override therefore migrates the real database that the
// dev server and anyone browsing it read from. For ANY non-production run,
// override the connection explicitly, e.g.:
//   DATABASE_URL=postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub npx tsx lib/db/migrate.ts
// (Tests are already safe: vitest.setup.ts pins them to .env.test regardless.)
// The hardcoded `.env` path below is repo-wide tooling convention -- do not
// change it unilaterally; override DATABASE_URL instead.
config({ path: '.env' })

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  const migrationClient = postgres(databaseUrl, { max: 1 })
  const db = drizzle(migrationClient)

  console.log('Running migrations from ./drizzle ...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations complete.')

  await migrationClient.end()
}

main().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
