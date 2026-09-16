import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { achievements, registrations } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'

// -----------------------------------------------------------------------------
// results — minimal scaffolding over the `achievements` table
// -----------------------------------------------------------------------------
//
// Per CLAUDE.md, `achievements` was added to the schema "scaffolded per PRD —
// no logic/UI in MVP" and RESULTS/AWARDS is deliberately not one of the 15
// tracked modules in `lib/lifecycle/module-registry.ts` (it belongs to the
// post-conference RESULTS_PENDING/RESULTS_UNDER_REVIEW/COMPLETED lifecycle
// stages, not the pre-publish content-verification pipeline). This file is
// intentionally a small, direct CRUD surface — list + manual add + delete —
// and does NOT wire `assertModuleNotLocked`/`onModuleDataChanged` (no
// verification/lock semantics exist for this module) or a review/verification
// workflow for individual awards. A larger results/awards system (rankings
// import, per-award verification, public results publication flow) is out of
// scope here; see PRD Section 28 MVP scope and the design docs' Phase 2+ list.

export interface AchievementRow {
  id: string
  userId: string
  munId: string
  registrationId: string
  committee: string | null
  portfolio: string | null
  award: string | null
  verificationStatus: string
  createdAt: Date
}

export interface CreateAchievementInput {
  munId: string
  registrationId: string
  committee?: string | null
  portfolio?: string | null
  award: string
}

/**
 * Organizer-facing award roster for a mun, newest first.
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise (shared `assertOwnsOrAdmin`).
 */
export async function listMunAchievements(munId: string, session: Session | null): Promise<AchievementRow[]> {
  await assertOwnsOrAdmin(munId, session)
  return db.select().from(achievements).where(eq(achievements.munId, munId)).orderBy(desc(achievements.createdAt))
}

/**
 * Records a manually-entered award for a delegate. `registrationId` must
 * belong to `munId` — checked explicitly (an IDOR guard, same pattern as
 * `executive-board.ts`'s `assertCommitteeBelongsToMun`) rather than trusted
 * from the caller, since a cross-mun registration id would otherwise let an
 * organizer of mun A record an "award" against a delegate of mun B.
 * `userId` is derived from the registration row, never from client input.
 */
export async function createAchievement(
  input: CreateAchievementInput,
  session: Session | null,
): Promise<AchievementRow> {
  await assertOwnsOrAdmin(input.munId, session)

  const [registration] = await db
    .select({ munId: registrations.munId, userId: registrations.userId })
    .from(registrations)
    .where(eq(registrations.id, input.registrationId))
    .limit(1)
  if (!registration) throw new Error('Registration not found')
  if (registration.munId !== input.munId) throw new Error('Forbidden')

  const [created] = await db
    .insert(achievements)
    .values({
      userId: registration.userId,
      munId: input.munId,
      registrationId: input.registrationId,
      committee: input.committee ?? null,
      portfolio: input.portfolio ?? null,
      award: input.award,
    })
    .returning()

  return created
}

/** Deletes an award entry. Owning organizer or admin only. */
export async function deleteAchievement(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: achievements.munId })
    .from(achievements)
    .where(eq(achievements.id, id))
    .limit(1)
  if (!existing) throw new Error('Achievement not found')
  await assertOwnsOrAdmin(existing.munId, session)

  await db.delete(achievements).where(eq(achievements.id, id))
}
