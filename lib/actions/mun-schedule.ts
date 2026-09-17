import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, munScheduleItems } from '@/lib/db/schema'
import type { ScheduleItemKind } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { triggerReverificationIfNeeded } from '@/lib/lifecycle/reverification'

// -----------------------------------------------------------------------------
// mun-schedule — SCHEDULE module (PRD Section 21)
// -----------------------------------------------------------------------------
//
// Validation rules: endsAt must be strictly after startsAt, and committeeId
// (if set) must belong to the same mun — same IDOR check as executive-board.
//
// SCHEDULE is a high-impact module (Task 12) — every mutation here calls
// `assertModuleNotLocked` right after the ownership check.

export interface ScheduleItem {
  id: string
  munId: string
  committeeId: string | null
  title: string
  kind: ScheduleItemKind
  startsAt: Date
  endsAt: Date
  location: string | null
  displayOrder: number
  createdAt: Date
}

function validateTimes(startsAt: Date, endsAt: Date): void {
  if (!(endsAt.getTime() > startsAt.getTime())) {
    throw new Error('endsAt must be after startsAt')
  }
}

/**
 * Verifies `committeeId` (if provided) belongs to `munId`. Same reasoning as
 * `assertCommitteeBelongsToMun` in executive-board.ts — a committee id from
 * another mun must be rejected, not silently accepted.
 */
async function assertCommitteeBelongsToMun(committeeId: string | null | undefined, munId: string): Promise<void> {
  if (!committeeId) return
  const [committee] = await db
    .select({ munId: committees.munId })
    .from(committees)
    .where(eq(committees.id, committeeId))
    .limit(1)
  if (!committee) throw new Error('Committee not found')
  if (committee.munId !== munId) throw new Error('Forbidden')
}

export interface CreateScheduleItemInput {
  munId: string
  committeeId?: string | null
  title: string
  kind: ScheduleItemKind
  startsAt: Date
  endsAt: Date
  location?: string | null
  displayOrder?: number
}

export async function createScheduleItem(input: CreateScheduleItemInput, session: Session | null): Promise<ScheduleItem> {
  await assertOwnsOrAdmin(input.munId, session)
  await assertModuleNotLocked(input.munId, 'SCHEDULE', session)
  validateTimes(input.startsAt, input.endsAt)
  await assertCommitteeBelongsToMun(input.committeeId, input.munId)

  const [created] = await db
    .insert(munScheduleItems)
    .values({
      munId: input.munId,
      committeeId: input.committeeId ?? null,
      title: input.title,
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: input.location ?? null,
      displayOrder: input.displayOrder ?? 0,
    })
    .returning()

  await onModuleDataChanged(input.munId, 'SCHEDULE', session!.userId)

  return created
}

export interface UpdateScheduleItemInput {
  committeeId?: string | null
  title?: string
  kind?: ScheduleItemKind
  startsAt?: Date
  endsAt?: Date
  location?: string | null
  displayOrder?: number
}

export async function updateScheduleItem(
  id: string,
  input: UpdateScheduleItemInput,
  session: Session | null,
): Promise<ScheduleItem> {
  const [existing] = await db.select().from(munScheduleItems).where(eq(munScheduleItems.id, id)).limit(1)
  if (!existing) throw new Error('Schedule item not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'SCHEDULE', session)

  const effectiveStartsAt = input.startsAt ?? existing.startsAt
  const effectiveEndsAt = input.endsAt ?? existing.endsAt
  validateTimes(effectiveStartsAt, effectiveEndsAt)

  if (input.committeeId !== undefined) {
    await assertCommitteeBelongsToMun(input.committeeId, existing.munId)
  }

  const [updated] = await db
    .update(munScheduleItems)
    .set(input)
    .where(eq(munScheduleItems.id, id))
    .returning()
  if (!updated) throw new Error('Schedule item not found')

  // Real before/after snapshots — `onModuleDataChanged` cannot diff for us.
  await triggerReverificationIfNeeded('SCHEDULE', existing, updated, existing.munId, session!.userId)
  await onModuleDataChanged(existing.munId, 'SCHEDULE', session!.userId)

  return updated
}

export async function deleteScheduleItem(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munScheduleItems.munId })
    .from(munScheduleItems)
    .where(eq(munScheduleItems.id, id))
    .limit(1)
  if (!existing) throw new Error('Schedule item not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'SCHEDULE', session)

  await db.delete(munScheduleItems).where(eq(munScheduleItems.id, id))

  await onModuleDataChanged(existing.munId, 'SCHEDULE', session!.userId)
}

/** Public read, no auth — the mun detail page renders the published schedule. */
export async function listScheduleItems(munId: string): Promise<ScheduleItem[]> {
  return db
    .select()
    .from(munScheduleItems)
    .where(eq(munScheduleItems.munId, munId))
    .orderBy(asc(munScheduleItems.startsAt))
}
