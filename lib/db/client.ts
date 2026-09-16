import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getHyperdriveConnectionString } from './hyperdrive-bridge'
import * as schema from './schema'

const globalForDb = globalThis as unknown as {
  queryClient?: ReturnType<typeof postgres>
}

/**
 * Prefers a Workers-injected Hyperdrive connection string (see
 * `./hyperdrive-bridge`) and falls back to `DATABASE_URL` for local Node
 * dev/tests, which never set it — same value/behavior as before this
 * function existed.
 */
function resolveConnectionString(): string {
  return getHyperdriveConnectionString() ?? process.env.DATABASE_URL!
}

function createDb() {
  // prepare: false — required for Cloudflare Hyperdrive: it pools/multiplexes
  // connections across multiple downstream Postgres connections, which
  // breaks postgres.js's default server-side prepared statements (a query
  // prepared on one pooled connection doesn't exist on another). Without
  // this, queries intermittently fail in production depending on which
  // pooled connection Hyperdrive happens to hand back — harmless to also
  // disable for the direct local/Node connection path.
  const queryClient = globalForDb.queryClient ?? postgres(resolveConnectionString(), { prepare: false })

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.queryClient = queryClient
  }

  return drizzle(queryClient, { schema })
}

type Db = ReturnType<typeof createDb>

let cachedDb: Db | undefined

function getDb(): Db {
  if (!cachedDb) cachedDb = createDb()
  return cachedDb
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
