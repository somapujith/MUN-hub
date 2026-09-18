import { runScheduledLifecycleTransitions } from '@/lib/lifecycle/registration-lifecycle'
import { runOrganizerDigest } from '@/lib/notifications/organizer-digest-job'
import { runConferenceReminders } from '@/lib/notifications/reminder-job'
import { runSlaNotifications } from '@/lib/notifications/sla-job'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { purgeExpiredAuthArtifacts } from './purge-auth-artifacts'
import { purgeDeletedUserAnswers } from './purge-deleted-user-answers'
import { reconcileGuruPayOrdersJob } from './reconcile-gurupay-orders'
import { releaseExpiredHoldsJob } from './release-expired-holds'
import type { JobResult, ScheduledJob } from './types'

/**
 * Registration/conference lifecycle moves that are due by the clock (open at
 * `registrationOpensAt`, close at the deadline or start day, start on the
 * start day). Audit rows need a real `users.id`, so the job needs the
 * SYSTEM_ACTOR_USER_ID var (a dedicated staff account) on munhub-api. Until
 * it is set the job logs a warning and does nothing, rather than failing
 * every run.
 */
export const scheduledLifecycleTransitionsJob: ScheduledJob = {
  name: 'runScheduledLifecycleTransitions',
  async run({ now }): Promise<JobResult> {
    const actorId = getRuntimeEnv('SYSTEM_ACTOR_USER_ID')?.trim()
    if (!actorId) {
      console.warn({
        level: 'warn',
        event: 'scheduled_job.skipped',
        job: 'runScheduledLifecycleTransitions',
        reason: 'SYSTEM_ACTOR_USER_ID is not set',
      })
      return { notConfigured: true }
    }

    const result = await runScheduledLifecycleTransitions(now, actorId)
    if (result.skipped.length) {
      // Mun ids and the organizer-facing reason only; no PII.
      console.log({
        level: 'info',
        event: 'scheduled_lifecycle.skipped',
        skipped: result.skipped,
      })
    }
    if (result.failed.length) {
      console.error({
        level: 'error',
        event: 'scheduled_lifecycle.failed',
        failed: result.failed,
      })
    }
    const counts = {
      opened: result.opened.length,
      closed: result.closed.length,
      started: result.started.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
    }
    // Thrown after the whole batch has been processed, so the muns that could
    // be transitioned still were — but the run is reported as failed and
    // `onError` (error tracker / failed-cron signal) fires. An unexpected
    // exception here is systemic far more often than it is per-mun: a
    // SYSTEM_ACTOR_USER_ID that doesn't resolve to a user makes every audit
    // row's NOT NULL foreign key fail, silently stranding every auto-open,
    // auto-close and auto-start.
    if (result.failed.length) {
      throw new Error(
        `runScheduledLifecycleTransitions: ${result.failed.length} transition(s) failed — ${result.failed
          .map((entry) => `${entry.munId} (${entry.action}): ${entry.reason}`)
          .join('; ')}`,
      )
    }
    return counts
  },
}

/** Deletes expired sessions, old reset tokens and old organizer sign-in codes. */
export const purgeExpiredAuthArtifactsJob: ScheduledJob = {
  name: 'purgeExpiredAuthArtifacts',
  async run({ now }) {
    const result = await purgeExpiredAuthArtifacts(now)
    return { ...result }
  },
}

/**
 * Clears the registration answers a deleted delegate's account kept for a
 * conference that had not happened yet, once it is over — the rest of the
 * erasure the deletion screen promises.
 */
export const purgeDeletedUserAnswersJob: ScheduledJob = {
  name: 'purgeDeletedUserAnswers',
  async run({ now }) {
    return { ...(await purgeDeletedUserAnswers(now)) }
  },
}

/** SLA_DELAY emails when a go-live submission's review becomes due soon or overdue. */
export const slaNotificationsJob: ScheduledJob = {
  name: 'runSlaNotifications',
  async run({ now }) {
    return runSlaNotifications(now)
  },
}

// The next two send for fixed windows ("start - 24h falls in the last five
// minutes", "09:00-09:05 IST"), so they measure from the cron's scheduled
// time: windows measured from each run's start time would overlap or leave
// gaps whenever a run starts late.

/** Delegate reminders ~24h before their conference starts. */
export const conferenceRemindersJob: ScheduledJob = {
  name: 'runConferenceReminders',
  async run({ now, scheduledTime }) {
    return runConferenceReminders(scheduledTime ?? now)
  },
}

/** Daily organizer digest for REGISTRATION_OPEN muns (no-op outside 09:00-09:05 IST). */
export const organizerDigestJob: ScheduledJob = {
  name: 'runOrganizerDigest',
  async run({ now, scheduledTime }) {
    return runOrganizerDigest(scheduledTime ?? now)
  },
}

/**
 * Every job the API Worker's cron trigger (server/wrangler.jsonc
 * `triggers.crons`, every 5 minutes) runs, in this order. Expired seat holds
 * are released before the lifecycle job can close registration, and
 * housekeeping runs last.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  releaseExpiredHoldsJob,
  scheduledLifecycleTransitionsJob,
  reconcileGuruPayOrdersJob,
  slaNotificationsJob,
  conferenceRemindersJob,
  organizerDigestJob,
  purgeExpiredAuthArtifactsJob,
  purgeDeletedUserAnswersJob,
]

export interface JobRunReport {
  job: string
  ok: boolean
  durationMs: number
  result?: JobResult
  error?: string
}

export interface RunScheduledJobsOptions {
  jobs?: readonly ScheduledJob[]
  cron?: string
  /** The cron trigger's scheduled fire time, passed to every job (see JobContext). */
  scheduledTime?: Date
  /**
   * Called after a job throws, e.g. to forward the error to an error tracker.
   * If the hook itself fails, that's logged and the run carries on.
   */
  onError?: (error: unknown, job: string) => void | Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs each job once, one after another, and never throws: a failing job is
 * logged and reported, and the jobs after it still run. Log lines are plain
 * objects so Workers Logs indexes their fields (`event`, `job`, ...).
 *
 * Sequential on purpose: the jobs share one database client per invocation
 * (see server/src/scheduled.ts), and a fixed order keeps runs predictable.
 */
export async function runScheduledJobs(options: RunScheduledJobsOptions = {}): Promise<JobRunReport[]> {
  const { jobs = SCHEDULED_JOBS, cron, scheduledTime, onError } = options
  const reports: JobRunReport[] = []

  for (const job of jobs) {
    const startedAt = Date.now()
    try {
      const result = await job.run({ now: new Date(), cron, scheduledTime })
      const report: JobRunReport = { job: job.name, ok: true, durationMs: Date.now() - startedAt, result }
      console.log({ level: 'info', event: 'scheduled_job.succeeded', cron, ...report })
      reports.push(report)
    } catch (error) {
      const report: JobRunReport = {
        job: job.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error),
      }
      console.error({
        level: 'error',
        event: 'scheduled_job.failed',
        cron,
        ...report,
        stack: error instanceof Error ? error.stack : undefined,
      })
      reports.push(report)

      if (onError) {
        try {
          await onError(error, job.name)
        } catch (hookError) {
          console.error({
            level: 'error',
            event: 'scheduled_job.on_error_failed',
            job: job.name,
            error: errorMessage(hookError),
          })
        }
      }
    }
  }

  return reports
}
