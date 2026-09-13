import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, verificationLogs } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import type { Mun } from '@/lib/types'

/**
 * Allowed forward transitions per MUNHub_Organizer_Modules_Verification_Confirmation_PRD.md
 * Section 2, extending the original MVP lifecycle (docs/superpowers/plans/2026-09-13-mun-hub-mvp-backend.md
 * Task 9) with the verification/confirmation trust layer's gates.
 *
 * DRAFT -> SUBMITTED -> UNDER_REVIEW -> {APPROVED, REJECTED, CHANGES_REQUESTED}
 * CHANGES_REQUESTED -> SUBMITTED (organizer resubmits)
 * APPROVED -> ONBOARDING -> CONTENT_SUBMITTED -> ORGANIZER_CONFIRMATION -> VERIFICATION -> {VERIFIED, CHANGES_REQUESTED}
 * VERIFIED -> PUBLISHED -> REGISTRATION_OPEN -> REGISTRATION_CLOSED -> CONFERENCE_ACTIVE
 * CONFERENCE_ACTIVE -> RESULTS_PENDING -> RESULTS_UNDER_REVIEW -> COMPLETED -> ARCHIVED
 *
 * VERIFIED/PUBLISHED/REGISTRATION_OPEN can transition back to VERIFICATION —
 * this is the re-verification trigger path (see lib/lifecycle/reverification.ts).
 * Most non-terminal states can transition to CANCELLED. REJECTED, ARCHIVED,
 * and CANCELLED are terminal (no outgoing transitions).
 */
const ALLOWED_TRANSITIONS: Record<MunStatus, MunStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  APPROVED: ['ONBOARDING', 'CANCELLED'],
  REJECTED: [],
  CHANGES_REQUESTED: ['SUBMITTED', 'CANCELLED'],
  ONBOARDING: ['CONTENT_SUBMITTED', 'CANCELLED'],
  CONTENT_SUBMITTED: ['ORGANIZER_CONFIRMATION', 'CANCELLED'],
  ORGANIZER_CONFIRMATION: ['VERIFICATION', 'CANCELLED'],
  VERIFICATION: ['VERIFIED', 'CHANGES_REQUESTED', 'CANCELLED'],
  VERIFIED: ['PUBLISHED', 'VERIFICATION', 'CANCELLED'],
  PUBLISHED: ['REGISTRATION_OPEN', 'VERIFICATION', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'VERIFICATION', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CONFERENCE_ACTIVE', 'CANCELLED'],
  CONFERENCE_ACTIVE: ['RESULTS_PENDING', 'CANCELLED'],
  RESULTS_PENDING: ['RESULTS_UNDER_REVIEW'],
  RESULTS_UNDER_REVIEW: ['COMPLETED', 'RESULTS_PENDING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: [],
}

/** Pure lookup — true iff `to` is a directly allowed next state from `from`. */
export function canTransition(from: MunStatus, to: MunStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Validates and applies a MUN status transition, writing an audit row to
 * `verificationLogs` in the same DB transaction. Sets `publishedAt` when
 * transitioning to PUBLISHED.
 *
 * Throws `Error('Mun not found')` if `munId` doesn't exist, or
 * `Error('Invalid transition from X to Y')` if the transition isn't allowed.
 */
export async function transitionMun(
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
): Promise<Mun> {
  return db.transaction(async (tx) => {
    // Row-lock the mun for the duration of this transaction so two concurrent
    // transitionMun calls against the same mun (e.g. two admins deciding the
    // same UNDER_REVIEW mun at once) serialize instead of both reading the
    // same pre-update status and both passing canTransition.
    const [mun] = await tx.select().from(muns).where(eq(muns.id, munId)).for('update').limit(1)
    if (!mun) {
      throw new Error('Mun not found')
    }

    if (!canTransition(mun.status, toStatus)) {
      throw new Error(`Invalid transition from ${mun.status} to ${toStatus}`)
    }

    const [updated] = await tx
      .update(muns)
      .set({
        status: toStatus,
        updatedAt: new Date(),
        ...(toStatus === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
      })
      .where(eq(muns.id, munId))
      .returning()

    await tx.insert(verificationLogs).values({
      munId,
      reviewerId: actorId,
      action: toStatus,
      notes,
      internalNotes,
    })

    return updated
  })
}
