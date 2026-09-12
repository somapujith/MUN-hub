import { eq } from 'drizzle-orm'
import { db } from './client'
import { muns } from './schema'

export type MunRow = typeof muns.$inferSelect

/**
 * Resolves a MUN by id or throws. Every tenant-scoped query/action should
 * call this first so a bad/absent munId fails fast with a clear error
 * instead of silently returning empty results.
 */
export async function assertMunExists(munId: string): Promise<MunRow> {
  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)

  if (!mun) {
    throw new Error('Mun not found')
  }

  return mun
}
