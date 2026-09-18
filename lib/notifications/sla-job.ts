import { eq, notInArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munSubmissions } from '@/lib/db/schema'
import { computeSlaState } from '@/lib/lifecycle/sla'

// Mirrors go-live.ts's private ACTIVE_SUBMISSION_PREDICATE exactly (not
// imported — that file's own comment explains why it stays a local raw-SQL
// constant rather than a shared export, so the two are kept "trivially
// comparable side by side" instead of coupling through an import).
const TERMINAL_STATUSES = ['PUBLISHED', 'REJECTED', 'WITHDRAWN'] as const

/**
 * SLA state refresh job — intended to be called by a cron scheduler (the
 * DevOps lane's registry) every few minutes.
 *
 * `mun_submissions.slaState` is a stored/cached column (set at creation, at
 * CHANGES_REQUESTED, and at publish — see go-live.ts), but never kept in
 * sync with the passage of time until now. This job recomputes each active
 * submission's CURRENT state via the same pure `computeSlaState` the rest of
 * the codebase uses and persists it, so anything that reads the column
 * directly (e.g. an admin-facing SLA indicator) stays accurate without
 * needing to recompute it itself.
 *
 * This job used to also send a "review is taking longer" (SLA_DELAY) email
 * once a submission crossed into DUE_SOON/OVERDUE while under MUN Hub's
 * review. That notification has been removed outright (decision: only a
 * review-decision email and a published email go out) — this job is now
 * state-persistence only and sends nothing.
 *
 * Runs one row at a time rather than batching every write into a single
 * transaction — each row's persist is independent, and a mid-run failure on
 * one submission should not roll back the ones already processed before it.
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
    })
    .from(munSubmissions)
    .where(notInArray(munSubmissions.status, [...TERMINAL_STATUSES]))

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

    await db.update(munSubmissions).set({ slaState: computed }).where(eq(munSubmissions.id, row.id))
  }

  // No notification is sent by this job (the "review is taking longer" email
  // was removed outright). `sent` is kept in the return shape — rather than
  // changing it to e.g. `{ updated: number }` — purely for backward
  // compatibility with the ScheduledJob/JobResult contract call sites expect
  // (lib/jobs/registry.ts); it always reports 0.
  return { sent: 0 }
}
