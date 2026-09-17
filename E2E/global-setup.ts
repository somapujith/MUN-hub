import { mkdirSync } from 'node:fs'
import { API_URL, assertLocalDatabase } from './env'
import { AUTH_DIR } from './paths'

/**
 * Runs after the API/web servers are up (Playwright starts webServers
 * first). Migration + seeding already happened in the API's start command —
 * see playwright.config.ts. This re-asserts the database guard (cheap, and
 * catches an E2E_DATABASE_URL override made after config load) and confirms
 * the seeded marketplace is actually reachable, so a broken seed fails once
 * here with a clear message instead of as dozens of unrelated test failures.
 */
export default async function globalSetup(): Promise<void> {
  assertLocalDatabase()
  mkdirSync(AUTH_DIR, { recursive: true })

  const response = await fetch(`${API_URL}/muns`)
  if (!response.ok) {
    throw new Error(`E2E setup: GET ${API_URL}/muns returned ${response.status} — is the seed applied?`)
  }
  const body = (await response.json()) as { results?: unknown[] }
  if (!body.results?.length) {
    throw new Error('E2E setup: the marketplace is empty — `npm run db:seed` did not populate any MUNs.')
  }
}
