/**
 * Database helpers for the conference-operations fixture MUN (FIXTURE_MUNS.ops),
 * used only by specs/organizer/conference-ops.spec.ts. Kept apart from
 * fixture-db.ts so the spec owns its fixture end to end. Local database only
 * (withFixtureDb asserts it).
 */
import { and, eq } from 'drizzle-orm'
import * as schema from '../../lib/db/schema'
import { deleteMunBySlug, ensureCommittee, ensureProduct, organizerId, upsertMun, withFixtureDb } from './fixture-db'
import { OPS } from './fixture-muns'

const HOUR = 60 * 60 * 1000

export type MunStatus = NonNullable<(typeof schema.muns.$inferInsert)['status']>

/**
 * Deletes and recreates the ops MUN (new id every time), owned by the seeded
 * organizer: REGISTRATION_OPEN, registration closing in an hour and the
 * conference starting in two, so delegates can still register and door
 * check-in (open from 24 h before the start) already works. Deleting the MUN
 * also removes its message audit rows, which resets the hourly send quota.
 */
export async function recreateOpsMun(): Promise<string> {
  return withFixtureDb(async (db) => {
    const ownerId = await organizerId(db)
    return db.transaction(async (tx) => {
      await deleteMunBySlug(tx, OPS.slug)
      const munId = await upsertMun(tx, ownerId, OPS, 'REGISTRATION_OPEN')
      const now = Date.now()
      await tx
        .update(schema.muns)
        .set({
          startDate: new Date(now + 2 * HOUR),
          endDate: new Date(now + 50 * HOUR),
          registrationOpensAt: new Date(now - 24 * HOUR),
          registrationDeadline: new Date(now + HOUR),
          addressLine1: '7 Check-in Road',
          addressState: 'Telangana',
        })
        .where(eq(schema.muns.id, munId))
      for (const c of OPS.committees) await ensureCommittee(tx, munId, c)
      for (const p of OPS.products) await ensureProduct(tx, munId, p)
      return munId
    })
  })
}

/** Moves the ops MUN to `status` directly (the lifecycle transitions themselves are covered elsewhere). */
export async function setOpsMunStatus(status: MunStatus): Promise<void> {
  await withFixtureDb(async (db) => {
    await db.update(schema.muns).set({ status, updatedAt: new Date() }).where(eq(schema.muns.slug, OPS.slug))
  })
}

/** Removes every award on the ops MUN. */
export async function clearOpsAwards(munId: string): Promise<void> {
  await withFixtureDb(async (db) => {
    await db.delete(schema.achievements).where(eq(schema.achievements.munId, munId))
  })
}

/** The delegate-message audit rows (`COMMUNICATION_SENT`) recorded for a MUN, newest last. */
export async function communicationAuditRows(munId: string): Promise<Array<{ notes: string | null; internalNotes: string | null }>> {
  return withFixtureDb((db) =>
    db
      .select({ notes: schema.verificationLogs.notes, internalNotes: schema.verificationLogs.internalNotes })
      .from(schema.verificationLogs)
      .where(and(eq(schema.verificationLogs.munId, munId), eq(schema.verificationLogs.action, 'COMMUNICATION_SENT')))
      .orderBy(schema.verificationLogs.createdAt),
  )
}

/** Suspends or reinstates an account (suspended accounts receive no delegate messages). */
export async function setUserSuspended(userId: string, suspended: boolean): Promise<void> {
  await withFixtureDb(async (db) => {
    await db
      .update(schema.users)
      .set(
        suspended
          ? { suspended: true, suspendedReason: 'E2E ops spec', suspendedAt: new Date() }
          : { suspended: false, suspendedReason: null, suspendedAt: null },
      )
      .where(eq(schema.users.id, userId))
  })
}
