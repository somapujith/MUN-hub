import { eq, notInArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munSubmissions, muns } from '@/lib/db/schema'
import type { MunStatus, SubmissionStatus } from '@/lib/db/schema-enums'
import { computeSlaState } from '@/lib/lifecycle/sla'
import { notifyPipelineEvent } from './pipeline-events'
import { resolveMunNotificationContext } from './resolve-recipients'

// Mirrors go-live.ts's private ACTIVE_SUBMISSION_PREDICATE exactly (not
// imported — that file's own comment explains why it stays a local raw-SQL
// constant rather than a shared export, so the two are kept "trivially
// comparable side by side" instead of coupling through an import).
const TERMINAL_STATUSES = ['PUBLISHED', 'REJECTED', 'WITHDRAWN'] as const

const DEGRADED_STATES = new Set(['DUE_SOON', 'OVERDUE'])

/**
 * SLA_DELAY says "our review is taking longer", so it only goes out while
 * MUN Hub actually holds the review: the mun is in VERIFICATION (the organizer
 * has confirmed) and the submission is still undecided. A submission row
 * exists, with its clock running, before that point (the mun is still in
 * ORGANIZER_CONFIRMATION, waiting on the organizer) and after it (APPROVED,
 * waiting to be published), and neither is a delay on MUN Hub's side.
 */
function isUnderMunHubReview(munStatus: MunStatus, submissionStatus: SubmissionStatus): boolean {
  return munStatus === 'VERIFICATION' && (submissionStatus === 'SUBMITTED' || submissionStatus === 'UNDER_REVIEW')
}

/**
 * SLA reminder job — intended to be called by a cron scheduler (the
 * DevOps lane's registry) every few minutes. PipelineEvent has a single
 * SLA_DELAY variant, not separate "approaching"/"breached" events, so this
 * reuses it for both the DUE_SOON and OVERDUE thresholds.
 *
 * Idempotent without a new migration: `mun_submissions.slaState` is already
 * a stored/cached column (set at creation, at CHANGES_REQUESTED, and at
 * publish — see go-live.ts), just never kept in sync with the passage of
 * time until now. This job recomputes each active submission's CURRENT
 * state via the same pure `computeSlaState` the rest of the codebase uses,
 * and only sends a notification when that computed state is DUE_SOON or
 * OVERDUE *and* differs from what's already stored — i.e. only on the
 * transition INTO a worse state, never on every run while it stays there,
 * and only while the review is MUN Hub's (`isUnderMunHubReview`).
 * The stored column is written on every run regardless (not just on a
 * notify), so it stays honest for anything that reads it directly instead
 * of recomputing. A submission that degrades DUE_SOON -> OVERDUE across two
 * separate runs correctly fires twice — once per real threshold crossing.
 *
 * Runs one row at a time rather than batching every write into a single
 * transaction — each row's notify-then-persist is independent, and a
 * mid-run failure on one submission should not roll back the ones already
 * processed before it.
 */
export async function runSlaNotifications(now: Date): Promise<{ sent: number }> {
  const rows = await db
    .select({
      id: munSubmissions.id,
      munId: munSubmissions.munId,
      status: munSubmissions.status,
      slaState: munSubmissions.slaState,
      slaDeadline: munSubmissions.slaDeadline,
      slaPausedAt: munSubmissions.slaPausedAt,
      slaPausedTotalMs: munSubmissions.slaPausedTotalMs,
      submittedAt: munSubmissions.submittedAt,
      munStatus: muns.status,
    })
    .from(munSubmissions)
    .innerJoin(muns, eq(munSubmissions.munId, muns.id))
    .where(notInArray(munSubmissions.status, [...TERMINAL_STATUSES]))

  let sent = 0

  for (const row of rows) {
    const computed = computeSlaState(
      {
        slaDeadline: row.slaDeadline,
        status: row.status,
        slaPausedAt: row.slaPausedAt,
        slaPausedTotalMs: row.slaPausedTotalMs,
        completedStatuses: [...TERMINAL_STATUSES],
      },
      now,
      row.submittedAt ?? undefined,
    )

    if (computed === row.slaState) continue

    if (DEGRADED_STATES.has(computed) && isUnderMunHubReview(row.munStatus, row.status)) {
      try {
        const context = await resolveMunNotificationContext(row.munId)
        await notifyPipelineEvent({ type: 'SLA_DELAY', munId: row.munId, organizerEmail: context.organizerEmail, munName: context.munName })
        sent += 1
      } catch (error) {
        console.error('[sla-job] notification failed', { munId: row.munId, error })
      }
    }

    await db.update(munSubmissions).set({ slaState: computed }).where(eq(munSubmissions.id, row.id))
  }

  return { sent }
}
