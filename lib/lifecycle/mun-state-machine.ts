import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, verificationLogs } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import type { Mun } from '@/lib/types'

// Same Drizzle transaction-callback param type as lib/audit/log.ts's `Tx` —
// kept as a local alias (not imported) so this module doesn't take on a
// dependency on the audit module just for a type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

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
 *
 * PUBLISHED -> VERIFIED is the admin "unpublish" path: a pure visibility
 * toggle back off the marketplace with no re-verification needed, since the
 * content hasn't changed. It is intentionally NOT allowed from
 * REGISTRATION_OPEN onward — once registrations exist, pulling the mun back
 * to VERIFIED would silently hide it while delegates still hold active
 * registrations; use SUSPENDED instead for that case.
 *
 * SUSPENDED is an admin-only pause, reachable from PUBLISHED onward
 * (PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED, CONFERENCE_ACTIVE) —
 * it hides the mun and blocks new registrations without discarding its
 * verified content. Reinstating goes through VERIFICATION (not straight back
 * to VERIFIED/PUBLISHED) so a suspended-and-reinstated mun is re-checked
 * before going live again, and can also be moved to CANCELLED if the
 * suspension turns out to be permanent.
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
  PUBLISHED: ['REGISTRATION_OPEN', 'VERIFICATION', 'VERIFIED', 'SUSPENDED', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'VERIFICATION', 'SUSPENDED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CONFERENCE_ACTIVE', 'SUSPENDED', 'CANCELLED'],
  CONFERENCE_ACTIVE: ['RESULTS_PENDING', 'SUSPENDED', 'CANCELLED'],
  RESULTS_PENDING: ['RESULTS_UNDER_REVIEW'],
  RESULTS_UNDER_REVIEW: ['COMPLETED', 'RESULTS_PENDING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: [],
  SUSPENDED: ['VERIFICATION', 'CANCELLED'],
}

/** Pure lookup — true iff `to` is a directly allowed next state from `from`. */
export function canTransition(from: MunStatus, to: MunStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Row-locks the mun, validates the transition, applies it, and writes the
 * `verificationLogs` audit row — all against the given `tx`. Extracted out of
 * `transitionMun` so callers that need the status change and their own extra
 * writes (e.g. an `admin_actions` row) to commit atomically can run this
 * against a transaction they already opened, instead of `transitionMun`
 * always opening its own and forcing a second, separate transaction.
 */
async function runTransition(
  tx: Tx,
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
): Promise<Mun> {
  // Row-lock the mun for the duration of this transaction so two concurrent
  // transitions against the same mun (e.g. two admins deciding the same
  // UNDER_REVIEW mun, or two suspend calls, at once) serialize instead of
  // both reading the same pre-update status and both passing canTransition.
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
}

/**
 * Validates and applies a MUN status transition, writing an audit row to
 * `verificationLogs` in the same DB transaction. Sets `publishedAt` when
 * transitioning to PUBLISHED.
 *
 * Throws `Error('Mun not found')` if `munId` doesn't exist, or
 * `Error('Invalid transition from X to Y')` if the transition isn't allowed.
 *
 * Pass `externalTx` when the caller already has an open transaction (e.g. it
 * also needs to insert an `admin_actions` audit row for the same action) and
 * wants this transition to be part of it rather than committing separately.
 * Without it, this opens and commits its own transaction as before.
 */
export async function transitionMun(
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
  externalTx?: Tx,
): Promise<Mun> {
  if (externalTx) {
    return runTransition(externalTx, munId, toStatus, actorId, notes, internalNotes)
  }
  return db.transaction((tx) => runTransition(tx, munId, toStatus, actorId, notes, internalNotes))
}
