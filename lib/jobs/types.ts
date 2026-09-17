/**
 * A unit of background work run by the API Worker's cron trigger
 * (server/src/scheduled.ts → runScheduledJobs in ./registry.ts).
 *
 * Jobs run every few minutes and a slow run can overlap the next one, so a
 * job must be idempotent: running it twice in a row, or two copies at once,
 * must leave the same end state as running it once.
 */
export interface ScheduledJob {
  /** Stable, unique name; appears in every log line for this job. */
  name: string
  run(context: JobContext): Promise<JobResult>
}

export interface JobContext {
  /** When this job started (not when the cron fired). */
  now: Date
  /** The cron expression that fired (server/wrangler.jsonc `triggers.crons`); undefined for manual runs. */
  cron?: string
}

/** Small summary counts for the log line, e.g. `{ released: 3 }`. Never PII. */
export type JobResult = Record<string, string | number | boolean>
