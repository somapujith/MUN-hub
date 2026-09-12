import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const globalForDb = globalThis as unknown as {
  queryClient?: ReturnType<typeof postgres>
}

const queryClient = globalForDb.queryClient ?? postgres(process.env.DATABASE_URL!)

if (process.env.NODE_ENV !== 'production') {
  globalForDb.queryClient = queryClient
}

export const db = drizzle(queryClient, { schema })
