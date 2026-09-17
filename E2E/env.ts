/**
 * Single source of truth for where the E2E suite runs.
 *
 * The suite spawns its OWN API + web servers on dedicated ports (never the
 * usual 3001/5174 dev ports) with DATABASE_URL forced to local Docker
 * Postgres. That isolation is deliberate: CLAUDE.md records a past incident
 * where a test run wrote hundreds of junk MUNs/users into the shared live
 * Neon database. Reusing an already-running dev server would make it
 * impossible to know which database the tests are writing to, so this suite
 * never does.
 */

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3101)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5175)

export const API_ORIGIN = `http://localhost:${API_PORT}`
export const API_URL = `${API_ORIGIN}/api/v1`
export const WEB_URL = `http://localhost:${WEB_PORT}`

/** Local docker-compose Postgres (docker-compose.yml). Override only with another LOCAL database. */
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Throws unless DATABASE_URL points at a local database. Called before any
 * server is spawned or any seed/migration runs — there is no flag to bypass
 * it, by design.
 */
export function assertLocalDatabase(url: string = DATABASE_URL): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`E2E refused to start: DATABASE_URL is not a valid URL.`)
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `E2E refused to start: DATABASE_URL points at "${host}", not a local database. ` +
        'The E2E suite creates users, registrations and payments — it must never run against ' +
        'a shared or production database (see CLAUDE.md "Test/dev DB isolation").',
    )
  }
}
