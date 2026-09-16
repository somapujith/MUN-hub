import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Bridges a Cloudflare Workers Hyperdrive binding's connection string (and a
 * per-request-scoped drizzle client built from it) into `lib/db/client.ts`.
 *
 * Why this exists: `lib/db/client.ts` is framework-agnostic (imported by
 * both the Next.js app and the Hono API) and has no direct access to Hono's
 * `c.env` binding context — Workers only hands you `env` inside a request
 * handler, not at module-import time. `server/middleware/hyperdrive.ts`
 * reads `c.env.HYPERDRIVE.connectionString` and runs the rest of the request
 * inside `runWithHyperdriveConnectionString` here.
 *
 * Why AsyncLocalStorage specifically, not a plain module-level variable
 * (what this file used before 2026-09-17): Cloudflare Workers ties I/O
 * objects — including a postgres.js socket opened through a Hyperdrive
 * binding — to the specific request that created them. A Worker isolate is
 * commonly reused across many different requests, and even a single isolate
 * can interleave multiple *concurrent* requests. A plain module-level cache
 * of the drizzle/postgres client (the original design, correct for a
 * long-lived Node process) gets reused across requests in that scenario,
 * which throws "Cannot perform I/O on behalf of a different request" —
 * intermittently, depending on isolate reuse/interleaving, which is exactly
 * what made this bug so easy to miss (worked fine locally and in every
 * test, failed ~50% of the time in production). AsyncLocalStorage scopes a
 * store to exactly the current request's async call graph, so two requests
 * — sequential-but-isolate-reused, or genuinely concurrent — never see or
 * reuse each other's client.
 *
 * Local Node dev/tests (`server/src/index.ts`, Vitest) never call
 * `runWithHyperdriveConnectionString`, so `getHyperdriveConnectionString`
 * stays `undefined` there and `lib/db/client.ts` falls through to its
 * process-lifetime-cached `process.env.DATABASE_URL` client, unchanged from
 * before Hyperdrive existed.
 */

interface HyperdriveRequestContext {
  connectionString: string
  db?: unknown // the drizzle instance for this request — lib/db/client.ts owns the concrete type
}

const hyperdriveContext = new AsyncLocalStorage<HyperdriveRequestContext>()

export function runWithHyperdriveConnectionString<T>(connectionString: string, fn: () => T): T {
  return hyperdriveContext.run({ connectionString }, fn)
}

export function getHyperdriveConnectionString(): string | undefined {
  return hyperdriveContext.getStore()?.connectionString
}

export function getCachedHyperdriveDb<T>(): T | undefined {
  return hyperdriveContext.getStore()?.db as T | undefined
}

export function setCachedHyperdriveDb(db: unknown): void {
  const store = hyperdriveContext.getStore()
  if (store) store.db = db
}
