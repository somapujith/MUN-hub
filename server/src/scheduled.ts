import { runWithHyperdriveConnectionString } from '@/lib/db/hyperdrive-bridge'
import { type JobRunReport, runScheduledJobs } from '@/lib/jobs/registry'
import type { ScheduledJob } from '@/lib/jobs/types'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { reportError } from '../lib/report-error'

/** The parts of a Workers `ScheduledController` this handler reads. */
export interface ScheduledEventInfo {
  cron: string
  scheduledTime: number
}

/**
 * The Worker's bindings: plain vars and secrets (strings) plus the
 * `HYPERDRIVE` binding from server/wrangler.jsonc.
 */
export type ScheduledEnv = Record<string, unknown> & {
  HYPERDRIVE?: { connectionString: string }
}

/**
 * The cron-trigger counterpart of the fetch path's first two middlewares
 * (server/middleware/runtime-env.ts and server/middleware/hyperdrive.ts). A
 * scheduled invocation is its own Workers I/O context, just like a request,
 * so it gets the same setup:
 *
 * 1. `setRuntimeEnv(env)`, so `getRuntimeEnv()` sees the Worker's vars and
 *    secrets (Workers never copies them into `process.env`).
 * 2. Every job runs inside `runWithHyperdriveConnectionString`, so
 *    lib/db/client.ts builds one client for this invocation and never
 *    reuses a client created by another request or cron run.
 *
 * Failures are logged per job by `runScheduledJobs` and forwarded to
 * `reportError`. If any job failed, this throws once all jobs have run, so
 * the invocation shows as failed in the Worker's Cron Events and logs.
 * Cloudflare doesn't retry failed cron runs; the next one fires on schedule.
 */
export async function handleScheduled(
  event: ScheduledEventInfo,
  env: ScheduledEnv | undefined,
  jobs?: readonly ScheduledJob[],
): Promise<JobRunReport[]> {
  // Same cast as runtimeEnvMiddleware: non-string bindings (HYPERDRIVE) ride
  // along but are never read through getRuntimeEnv().
  if (env) setRuntimeEnv(env as Record<string, string | undefined>)

  const scheduledAt = new Date(event.scheduledTime).toISOString()
  const run = () =>
    runScheduledJobs({
      jobs,
      cron: event.cron,
      onError: (error, job) => reportError(error, { source: 'scheduled', job, cron: event.cron }),
    })

  console.log({ level: 'info', event: 'scheduled_run.started', cron: event.cron, scheduledAt })

  const connectionString = env?.HYPERDRIVE?.connectionString
  const reports = connectionString ? await runWithHyperdriveConnectionString(connectionString, run) : await run()

  const failed = reports.filter((report) => !report.ok).map((report) => report.job)
  console.log({
    level: failed.length ? 'error' : 'info',
    event: 'scheduled_run.finished',
    cron: event.cron,
    scheduledAt,
    jobs: reports.length,
    failed,
  })

  if (failed.length) {
    throw new Error(`Scheduled jobs failed: ${failed.join(', ')}`)
  }
  return reports
}
