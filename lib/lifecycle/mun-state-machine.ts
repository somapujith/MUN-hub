import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, verificationLogs } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'
import type { Mun } from '@/lib/types'

// Same Drizzle transaction-callback param type as lib/audit/log.ts's `Tx` —
// kept as a local alias (not imported) so this module doesn't take on a
// dependency on the audit module just for a type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Allowed forward transitions per docs/prd/MUNHub_Organizer_Modules_Verification_Confirmation_PRD.md
 * Section 2, extended by docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
 * Section 1.6 with the organizer onboarding / go-live pipeline states.
 *
 * ============================================================================
 * GATE-1 vs GATE-2 — READ THIS BEFORE TOUCHING SUBMITTED/UNDER_REVIEW/
 * APPROVED/CHANGES_REQUESTED. These four enum values are reused by two
 * completely different review gates that happen to share vocabulary. They
 * are NOT the same concept and must never be treated as such:
 *
 *   GATE 1 — organizer-application approval ("is this organization allowed
 *   to run a MUN on our platform"). Table: `organizerApplications`. Action:
 *   `reviewMunApplication` (admin-review.ts). Path:
 *     DRAFT -> SUBMITTED -> UNDER_REVIEW -> {APPROVED, REJECTED, CHANGES_REQUESTED}
 *     CHANGES_REQUESTED -> SUBMITTED (organizer resubmits)
 *     APPROVED -> ONBOARDING (Gate 1 exit)
 *
 *   GATE 2 — MUN-content review ("is this MUN's content correct enough to
 *   publish"). The PRD's own vocabulary for this gate is also
 *   SUBMITTED/UNDER_REVIEW/CHANGES_REQUESTED/APPROVED, but per spec Section
 *   1.2 that vocabulary is deliberately NOT reused as enum values here — it
 *   is implemented on the *existing, differently-named* content-gate values
 *   instead, so the two gates can never collide in a `mun.status` check:
 *     CONTENT_SUBMITTED  (PRD's content "SUBMITTED")
 *     AUTOMATED_VALIDATION (new — no PRD-name collision)
 *     ORGANIZER_CONFIRMATION (PRD's Gate-3 confirmation; PRD §4 has no state for it)
 *     VERIFICATION       (PRD's content "UNDER_REVIEW")
 *     VERIFIED           (PRD's content "APPROVED")
 *     ACTION_REQUIRED + module-level CHANGES_REQUESTED (PRD's content "CHANGES_REQUESTED" — see spec §1.5)
 *
 *   See PRD_STATE_ALIASES below — display layers may render the PRD's Gate-2
 *   word (e.g. "Under Review") for a Gate-2 status while the DB stores the
 *   real enum value (e.g. VERIFICATION). This is a labeling concern only;
 *   `mun.status === 'UNDER_REVIEW'` ALWAYS means Gate 1, full stop, and
 *   `getReviewQueue`'s `inArray(muns.status, ['SUBMITTED','UNDER_REVIEW'])`
 *   filter must keep meaning "organizer applications", never "content
 *   submissions". If you find yourself wanting to reuse a Gate-1 name for a
 *   Gate-2 concept, stop — that is the exact trap this design avoids.
 * ============================================================================
 *
 * DRAFT -> SUBMITTED -> UNDER_REVIEW -> {APPROVED, REJECTED, CHANGES_REQUESTED}   [Gate 1]
 * CHANGES_REQUESTED -> SUBMITTED (organizer resubmits)                            [Gate 1]
 * APPROVED -> ONBOARDING                                                          [Gate 1 exit]
 *
 * ONBOARDING <-> {ACTION_REQUIRED, READY_FOR_SUBMISSION} (materialized progress states,
 *   spec Section 1.5 — flip based on the module-completion engine, mutually reachable)
 * READY_FOR_SUBMISSION / ONBOARDING -> CONTENT_SUBMITTED -> AUTOMATED_VALIDATION
 *   -> ORGANIZER_CONFIRMATION -> VERIFICATION -> {VERIFIED, CHANGES_REQUESTED, REJECTED}
 * VERIFIED -> {PUBLISHED, GO_LIVE_QUEUE} -> PUBLISHING -> PUBLISHED
 *   -> REGISTRATION_OPEN -> REGISTRATION_CLOSED -> CONFERENCE_ACTIVE
 * CONFERENCE_ACTIVE -> RESULTS_PENDING -> RESULTS_UNDER_REVIEW -> COMPLETED -> ARCHIVED
 * CONFERENCE_ACTIVE -> COMPLETED (conference ended without the results flow)
 *
 * CONFERENCE_ACTIVE -> COMPLETED is the "no results to review" exit: results
 * publishing is optional in the MVP (awards are plain `achievements` rows that
 * don't depend on mun status), so a conference that never enters
 * RESULTS_PENDING must still be completable instead of being stranded in
 * CONFERENCE_ACTIVE forever. Once a mun has entered the results flow it can
 * only complete through RESULTS_UNDER_REVIEW -> COMPLETED (the results-review
 * decision). See lib/lifecycle/registration-lifecycle.ts for who may trigger
 * each registration/conference transition and when.
 *
 * VERIFIED/PUBLISHED/REGISTRATION_OPEN/REGISTRATION_CLOSED/UNPUBLISHED/
 * SUSPENDED can transition back to VERIFICATION. Organizer edits no longer
 * trigger this automatically (see lib/lifecycle/reverification.ts) — the
 * edges remain for deliberate admin actions such as reinstating a suspended
 * MUN. Most non-terminal states can transition to CANCELLED. REJECTED, ARCHIVED, and CANCELLED are terminal (no outgoing
 * transitions).
 *
 * VERIFIED -> PUBLISHED is retained alongside the recommended
 * VERIFIED -> GO_LIVE_QUEUE -> PUBLISHING -> PUBLISHED queue path — it is the
 * admin escape hatch / backward-compatible direct publish. Both paths require
 * VERIFIED, which is the gate that actually matters (spec Section 1.6).
 *
 * PUBLISHING -> GO_LIVE_QUEUE is the publish-failure fallback: a publish that
 * fails partway must not strand the mun in PUBLISHING forever (spec Section
 * 1.6 / 5.3).
 *
 * PUBLISHED -> UNPUBLISHED is the admin "unpublish" path — a deliberate pull
 * from the marketplace, distinct from VERIFIED (content verified, not yet
 * live). UNPUBLISHED -> GO_LIVE_QUEUE is the re-publish path;
 * UNPUBLISHED -> VERIFICATION is the re-review path. It is intentionally NOT
 * reachable from REGISTRATION_OPEN onward — once registrations exist, pulling
 * the mun back would silently hide it while delegates still hold active
 * registrations; use SUSPENDED instead for that case.
 *
 * SUSPENDED is an admin-only pause, reachable from PUBLISHED onward
 * (PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED, CONFERENCE_ACTIVE) —
 * it hides the mun and blocks new registrations without discarding its
 * verified content. Reinstating goes through VERIFICATION (not straight back
 * to VERIFIED/PUBLISHED) so a suspended-and-reinstated mun is re-checked
 * before going live again, and can also be moved to CANCELLED if the
 * suspension turns out to be permanent.
 *
 * NOTE: `PUBLISHED` is the enum value MunHub has always used and stays that
 * way — see spec Section 1.3. `LIVE` is a *display label only*
 * (PRD_STATE_ALIASES / lib/mun-status.ts), never a distinct enum value. Do
 * not rename PUBLISHED to LIVE in munStatusEnum.
 */
const ALLOWED_TRANSITIONS: Record<MunStatus, MunStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'CANCELLED'], // Gate 1
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'], // Gate 1
  APPROVED: ['ONBOARDING', 'CANCELLED'], // Gate 1 exit
  REJECTED: [],
  CHANGES_REQUESTED: ['SUBMITTED', 'CANCELLED'], // Gate 1 loop

  ONBOARDING: ['ACTION_REQUIRED', 'READY_FOR_SUBMISSION', 'CONTENT_SUBMITTED', 'CANCELLED'],
  ACTION_REQUIRED: ['ONBOARDING', 'READY_FOR_SUBMISSION', 'CANCELLED'],
  READY_FOR_SUBMISSION: ['CONTENT_SUBMITTED', 'ACTION_REQUIRED', 'ONBOARDING', 'CANCELLED'],
  CONTENT_SUBMITTED: ['AUTOMATED_VALIDATION', 'ORGANIZER_CONFIRMATION', 'ACTION_REQUIRED', 'CANCELLED'],
  AUTOMATED_VALIDATION: ['ORGANIZER_CONFIRMATION', 'ACTION_REQUIRED', 'CANCELLED'],
  // READY_FOR_SUBMISSION: the organizer steps back from Gate 3 to fix something
  // they spotted in the summary (go-live.ts#withdrawSubmission).
  ORGANIZER_CONFIRMATION: ['VERIFICATION', 'READY_FOR_SUBMISSION', 'CANCELLED'],
  VERIFICATION: ['VERIFIED', 'CHANGES_REQUESTED', 'ACTION_REQUIRED', 'REJECTED', 'CANCELLED'],
  VERIFIED: ['GO_LIVE_QUEUE', 'PUBLISHED', 'VERIFICATION', 'CANCELLED'],
  GO_LIVE_QUEUE: ['PUBLISHING', 'VERIFICATION', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'GO_LIVE_QUEUE', 'CANCELLED'],
  PUBLISHED: ['REGISTRATION_OPEN', 'VERIFICATION', 'VERIFIED', 'UNPUBLISHED', 'SUSPENDED', 'CANCELLED'],
  UNPUBLISHED: ['GO_LIVE_QUEUE', 'VERIFICATION', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'VERIFICATION', 'SUSPENDED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CONFERENCE_ACTIVE', 'VERIFICATION', 'SUSPENDED', 'CANCELLED'],
  CONFERENCE_ACTIVE: ['RESULTS_PENDING', 'COMPLETED', 'SUSPENDED', 'CANCELLED'],
  RESULTS_PENDING: ['RESULTS_UNDER_REVIEW'],
  RESULTS_UNDER_REVIEW: ['COMPLETED', 'RESULTS_PENDING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: [],
  SUSPENDED: ['VERIFICATION', 'CANCELLED'],
}

/**
 * Maps a subset of internal MunStatus enum values to the PRD's Gate-2
 * vocabulary, per spec Section 1.2. Display layers (organizer-facing
 * timeline UI, PRD §30) should render the PRD word via this map; the DB
 * always stores the real enum value on the left. Not every MunStatus has an
 * alias — only the four where the PRD's Gate-2 wording differs from the
 * implemented enum value.
 */
export const PRD_STATE_ALIASES: Partial<Record<MunStatus, string>> = {
  CONTENT_SUBMITTED: 'SUBMITTED',
  VERIFICATION: 'UNDER_REVIEW',
  VERIFIED: 'APPROVED',
  PUBLISHED: 'LIVE',
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
    // The column default (now()) is the *transaction* start time, so several
    // transitions in one transaction (e.g. reviewMunApplication's
    // SUBMITTED -> UNDER_REVIEW -> APPROVED -> ONBOARDING) would all share a
    // timestamp and sort arbitrarily. clock_timestamp() keeps them in order.
    createdAt: sql`clock_timestamp()`,
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
