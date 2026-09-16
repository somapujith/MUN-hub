import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getCachedHyperdriveDb, getHyperdriveConnectionString, setCachedHyperdriveDb } from './hyperdrive-bridge'
import * as schema from './schema'

const globalForDb = globalThis as unknown as {
  queryClient?: ReturnType<typeof postgres>
}

function buildDb(connectionString: string) {
  // prepare: false — required for Cloudflare Hyperdrive: it pools/multiplexes
  // connections across multiple downstream Postgres connections, which
  // breaks postgres.js's default server-side prepared statements (a query
  // prepared on one pooled connection doesn't exist on another). Harmless
  // to also disable for the direct local/Node connection path.
  return drizzle(postgres(connectionString, { prepare: false }), { schema })
}

type Db = ReturnType<typeof buildDb>

let cachedNodeDb: Db | undefined

function getDb(): Db {
  const hyperdriveConnectionString = getHyperdriveConnectionString()

  // Cloudflare Workers path: never reuse a client across requests. Workers
  // ties I/O objects (a postgres.js/Hyperdrive socket included) to the
  // specific request that created them — reusing a module-level-cached
  // client from a previous request throws "Cannot perform I/O on behalf of
  // a different request", intermittently, depending on isolate reuse. Build
  // (or reuse, within THIS request only) via the AsyncLocalStorage-scoped
  // cache in hyperdrive-bridge.ts — see that file's header comment.
  if (hyperdriveConnectionString) {
    const cached = getCachedHyperdriveDb<Db>()
    if (cached) return cached
    const fresh = buildDb(hyperdriveConnectionString)
    setCachedHyperdriveDb(fresh)
    return fresh
  }

  // Local Node dev/tests: a real long-lived process, so a single client
  // cached for the process lifetime is correct and desired — same
  // behavior as before Hyperdrive existed.
  if (!cachedNodeDb) {
    const queryClient = globalForDb.queryClient ?? postgres(process.env.DATABASE_URL!, { prepare: false })
    if (process.env.NODE_ENV !== 'production') {
      globalForDb.queryClient = queryClient
    }
    cachedNodeDb = drizzle(queryClient, { schema })
  }
  return cachedNodeDb
}

// `db` defers actually resolving a connection string / creating the
// Postgres client until the first real query (first property access)
// instead of at module-import time. Under Cloudflare Workers this module is
// evaluated once at cold start, before any request (and therefore before
// any `env`/Hyperdrive binding) exists, so eager creation here would always
// read a nonexistent `process.env.DATABASE_URL` and never pick up
// Hyperdrive. Local Node dev/tests are unaffected: `getDb()` still runs
// exactly the same synchronous, cached-on-globalThis logic the previous
// top-level code did, just on first use rather than on import.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<PropertyKey, unknown>
    const value = instance[prop as PropertyKey]
    if (typeof value !== 'function') return value

    // Own properties (e.g. `$client` — the raw postgres-js client drizzle
    // attaches directly to the instance, itself a callable tagged-template
    // function with extra methods like `.end()`/`.begin()` hanging off it)
    // are returned untouched: they don't need `this` to be the drizzle
    // instance, and `.bind()` would silently drop those extra methods.
    // Only inherited prototype methods (select/insert/update/transaction/…,
    // which do need `this === instance` rather than this Proxy) get bound.
    if (Object.prototype.hasOwnProperty.call(instance, prop)) return value
    return value.bind(instance)
  },
})
