import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { achievements, muns, registrations, users, verificationLogs } from '@/lib/db/schema'
import type { MunStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { ORGANIZER_OPS_ERRORS } from '@/lib/actions/organizer-ops-errors'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'

// -----------------------------------------------------------------------------
// results — awards over the `achievements` table, and results publishing
// -----------------------------------------------------------------------------
//
// RESULTS/AWARDS is deliberately not one of the 15 tracked modules in
// `lib/lifecycle/module-registry.ts`: it belongs to the post-conference
// lifecycle, not the pre-publish content-verification pipeline, so none of
// `assertModuleNotLocked`/`onModuleDataChanged` applies here.
//
// Awards are entered by hand (no rankings import) and may only name a
// delegate who holds a seat and wasn't a no-show (CONFIRMED or ATTENDED).
//
// Publishing follows the MUN state machine:
//   CONFERENCE_ACTIVE -> RESULTS_PENDING -> RESULTS_UNDER_REVIEW   (organizer submits)
//   RESULTS_UNDER_REVIEW -> COMPLETED                               (staff approve)
//   RESULTS_UNDER_REVIEW -> RESULTS_PENDING                         (staff return, with a note)
// Awards are frozen from submission onward (`RESULTS_LOCKED_STATUSES`);
// returning the results unfreezes them. Approval marks the MUN's awards
// verified. Each hop writes its own `verification_logs` row via
// `transitionMun`, which is also where the organizer reads a return note.

const AWARD_ELIGIBLE_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'ATTENDED']
const STAFF_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

/** MUN statuses in which awards can no longer be added or removed. */
export const RESULTS_LOCKED_STATUSES: readonly MunStatus[] = [
  'RESULTS_UNDER_REVIEW',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
]

/** MUN statuses from which the organizer can submit results for review. */
const RESULTS_SUBMITTABLE_STATUSES: readonly MunStatus[] = ['CONFERENCE_ACTIVE', 'RESULTS_PENDING']

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

export interface AchievementListRow extends AchievementRow {
  delegateName: string
  delegateEmail: string
}

export interface CreateAchievementInput {
  munId: string
  registrationId: string
  committee?: string | null
  portfolio?: string | null
  award: string
}

async function assertAwardsEditable(munId: string): Promise<void> {
  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  if (RESULTS_LOCKED_STATUSES.includes(mun.status)) throw new Error(ORGANIZER_OPS_ERRORS.resultsLocked)
}

/**
 * Organizer-facing award roster for a mun, newest first, with each winner's
 * name and email (the organizer already sees both on the roster).
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise (shared `assertOwnsOrAdmin`).
 */
export async function listMunAchievements(munId: string, session: Session | null): Promise<AchievementListRow[]> {
  await assertOwnsOrAdmin(munId, session)
  const rows = await db
    .select({ achievement: achievements, delegateName: users.name, delegateEmail: users.email })
    .from(achievements)
    .innerJoin(users, eq(users.id, achievements.userId))
    .where(eq(achievements.munId, munId))
    .orderBy(desc(achievements.createdAt), desc(achievements.id))
  return rows.map(({ achievement, delegateName, delegateEmail }) => ({ ...achievement, delegateName, delegateEmail }))
}

/**
 * Records a manually-entered award for a delegate. `registrationId` must
 * belong to `munId` — checked explicitly (an IDOR guard, same pattern as
 * `executive-board.ts`'s `assertCommitteeBelongsToMun`) rather than trusted
 * from the caller, since a cross-mun registration id would otherwise let an
 * organizer of mun A record an "award" against a delegate of mun B.
 * `userId` is derived from the registration row, never from client input.
 *
 * The registration must be CONFIRMED or ATTENDED (row-locked while the award
 * is written, so a concurrent no-show mark can't slip in between), and the
 * results must not be locked. Committee/portfolio default to the delegate's
 * own assignment when not given, so the award reads correctly later even if
 * the assignment changes.
 */
export async function createAchievement(
  input: CreateAchievementInput,
  session: Session | null,
): Promise<AchievementRow> {
  await assertOwnsOrAdmin(input.munId, session)
  const award = input.award.trim()
  if (!award) throw new Error('Award name is required')
  await assertAwardsEditable(input.munId)

  return db.transaction(async (tx) => {
    const [registration] = await tx
      .select({
        munId: registrations.munId,
        userId: registrations.userId,
        status: registrations.status,
      })
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .for('share')
      .limit(1)
    if (!registration) throw new Error('Registration not found')
    if (registration.munId !== input.munId) throw new Error('Forbidden')
    if (!AWARD_ELIGIBLE_STATUSES.includes(registration.status)) {
      throw new Error(ORGANIZER_OPS_ERRORS.awardNeedsConfirmedDelegate)
    }

    const assignment = await tx.query.registrations.findFirst({
      where: eq(registrations.id, input.registrationId),
      columns: { id: true },
      with: { committee: { columns: { name: true } }, portfolio: { columns: { name: true } } },
    })

    const [created] = await tx
      .insert(achievements)
      .values({
        userId: registration.userId,
        munId: input.munId,
        registrationId: input.registrationId,
        committee: input.committee?.trim() || assignment?.committee?.name || null,
        portfolio: input.portfolio?.trim() || assignment?.portfolio?.name || null,
        award,
      })
      .returning()

    return created
  })
}

/** Deletes an award entry. Owning organizer or admin only, and only while results are editable. */
export async function deleteAchievement(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: achievements.munId })
    .from(achievements)
    .where(eq(achievements.id, id))
    .limit(1)
  if (!existing) throw new Error('Achievement not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertAwardsEditable(existing.munId)

  await db.delete(achievements).where(eq(achievements.id, id))
}

// ---------------------------------------------------------------------------
// Results publishing
// ---------------------------------------------------------------------------

export interface ResultsState {
  munStatus: MunStatus
  awardCount: number
  /** Awards can be added/removed. */
  editable: boolean
  /** The organizer can submit results for review right now (ignores the award-count rule, which the action enforces). */
  canSubmit: boolean
  /** When the results were last submitted for review, if they have been. */
  submittedAt: Date | null
  /** The staff note from the most recent return, while the results are back with the organizer. */
  returnNote: string | null
}

/**
 * Where this MUN's results stand. Owning organizer or admin
 * (`assertOwnsOrAdmin`) — same audience as the award list.
 */
export async function getResultsState(munId: string, session: Session | null): Promise<ResultsState> {
  await assertOwnsOrAdmin(munId, session)
  return loadResultsState(munId)
}

async function loadResultsState(munId: string): Promise<ResultsState> {
  const [[mun], awardCount, logs] = await Promise.all([
    db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1),
    db.$count(achievements, eq(achievements.munId, munId)),
    db
      .select({ action: verificationLogs.action, notes: verificationLogs.notes, createdAt: verificationLogs.createdAt })
      .from(verificationLogs)
      .where(
        and(
          eq(verificationLogs.munId, munId),
          inArray(verificationLogs.action, ['RESULTS_UNDER_REVIEW', 'RESULTS_PENDING']),
        ),
      )
      .orderBy(desc(verificationLogs.createdAt))
      .limit(10),
  ])
  if (!mun) throw new Error('Mun not found')

  const lastSubmission = logs.find((log) => log.action === 'RESULTS_UNDER_REVIEW')
  const lastReturn = logs.find((log) => log.action === 'RESULTS_PENDING' && log.notes)
  const returnedAfterSubmission =
    mun.status === 'RESULTS_PENDING' &&
    lastSubmission !== undefined &&
    lastReturn !== undefined &&
    lastReturn.createdAt > lastSubmission.createdAt

  return {
    munStatus: mun.status,
    awardCount,
    editable: !RESULTS_LOCKED_STATUSES.includes(mun.status),
    canSubmit: RESULTS_SUBMITTABLE_STATUSES.includes(mun.status),
    submittedAt: lastSubmission?.createdAt ?? null,
    returnNote: returnedAfterSubmission ? (lastReturn?.notes ?? null) : null,
  }
}

/**
 * Submits the MUN's results for MUNHub review: CONFERENCE_ACTIVE moves
 * through RESULTS_PENDING to RESULTS_UNDER_REVIEW in one transaction (two
 * audited hops); RESULTS_PENDING (e.g. after a return) moves straight on.
 * Requires at least one award. Owning organizer or admin.
 */
export async function submitResultsForReview(munId: string, session: Session | null): Promise<ResultsState> {
  if (!session) throw new Error('Forbidden')
  await assertOwnsOrAdmin(munId, session)
  const actorId = session.userId

  await db.transaction(async (tx) => {
    const [mun] = await tx.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).for('update').limit(1)
    if (!mun) throw new Error('Mun not found')
    if (!RESULTS_SUBMITTABLE_STATUSES.includes(mun.status)) {
      throw new Error(`Cannot submit results while the MUN is ${mun.status}`)
    }
    const awardCount = await tx.$count(achievements, eq(achievements.munId, munId))
    if (awardCount === 0) throw new Error(ORGANIZER_OPS_ERRORS.resultsNeedAward)

    if (mun.status === 'CONFERENCE_ACTIVE') {
      await transitionMun(munId, 'RESULTS_PENDING', actorId, 'Conference ended — results being prepared', undefined, tx)
    }
    await transitionMun(
      munId,
      'RESULTS_UNDER_REVIEW',
      actorId,
      `Results submitted for review (${awardCount} award${awardCount === 1 ? '' : 's'})`,
      undefined,
      tx,
    )
  })

  return loadResultsState(munId)
}

export type ResultsReviewDecision = 'APPROVE' | 'RETURN'

/**
 * MUNHub staff decision on submitted results (OPERATIONS/ADMIN/SUPER_ADMIN).
 * APPROVE completes the MUN and marks its awards verified; RETURN sends the
 * results back to the organizer with a required note.
 */
export async function reviewResults(
  munId: string,
  decision: ResultsReviewDecision,
  note: string | undefined,
  session: Session | null,
): Promise<ResultsState> {
  requireRole(session, [...STAFF_ROLES])
  const trimmedNote = note?.trim() || undefined
  if (decision === 'RETURN' && !trimmedNote) throw new Error(ORGANIZER_OPS_ERRORS.returnNoteRequired)

  await db.transaction(async (tx) => {
    const [mun] = await tx.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).for('update').limit(1)
    if (!mun) throw new Error('Mun not found')
    if (mun.status !== 'RESULTS_UNDER_REVIEW') throw new Error(ORGANIZER_OPS_ERRORS.resultsNotUnderReview)

    if (decision === 'APPROVE') {
      await transitionMun(munId, 'COMPLETED', session.userId, trimmedNote ?? 'Results approved', undefined, tx)
      await tx.update(achievements).set({ verificationStatus: 'verified' }).where(eq(achievements.munId, munId))
    } else {
      await transitionMun(munId, 'RESULTS_PENDING', session.userId, trimmedNote, undefined, tx)
    }
  })

  return loadResultsState(munId)
}
