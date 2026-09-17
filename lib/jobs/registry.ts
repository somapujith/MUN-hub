import { releaseExpiredHoldsJob } from './release-expired-holds'
import type { JobResult, ScheduledJob } from './types'

/**
 * Every job the API Worker's cron trigger (server/wrangler.jsonc
 * `triggers.crons`) runs, in this order.
 *
 * To register when their lanes merge (2026-09-17 autonomous run):
 * - purgeExpiredAuthArtifacts: lib/jobs/purge-auth-artifacts.ts (privacy lane)
 * - runScheduledLifecycleTransitions: lib/lifecycle/registration-lifecycle.ts
 *   (lifecycle lane). Needs the SYSTEM_ACTOR_USER_ID var set on munhub-api,
 *   since audit rows require a real user id.
 * - the notifications lane's SLA job (SLA_DELAY emails)
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [releaseExpiredHoldsJob]

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
  const { jobs = SCHEDULED_JOBS, cron, onError } = options
  const reports: JobRunReport[] = []

  for (const job of jobs) {
    const startedAt = Date.now()
    try {
      const result = await job.run({ now: new Date(), cron })
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
