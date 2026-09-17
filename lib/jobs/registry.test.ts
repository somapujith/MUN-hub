import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEDULED_JOBS, runScheduledJobs, scheduledLifecycleTransitionsJob } from './registry'
import type { JobContext, ScheduledJob } from './types'

function job(name: string, run: ScheduledJob['run']): ScheduledJob {
  return { name, run }
}

describe('SCHEDULED_JOBS', () => {
  it('registers every cron job, releasing holds before the lifecycle job and housekeeping last', () => {
    expect(SCHEDULED_JOBS.map((j) => j.name)).toEqual([
      'releaseExpiredHolds',
      'runScheduledLifecycleTransitions',
      'runSlaNotifications',
      'runConferenceReminders',
      'runOrganizerDigest',
      'purgeExpiredAuthArtifacts',
    ])
  })

  it('has unique job names (they identify jobs in the logs)', () => {
    const names = SCHEDULED_JOBS.map((j) => j.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('runScheduledJobs', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs every job in order and reports each result', async () => {
    const order: string[] = []
    const reports = await runScheduledJobs({
      jobs: [
        job('first', async () => {
          order.push('first')
          return { released: 2 }
        }),
        job('second', async () => {
          order.push('second')
          return { sent: 0 }
        }),
      ],
    })

    expect(order).toEqual(['first', 'second'])
    expect(reports).toMatchObject([
      { job: 'first', ok: true, result: { released: 2 } },
      { job: 'second', ok: true, result: { sent: 0 } },
    ])
    for (const report of reports) expect(report.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does not start a job until the previous one has finished', async () => {
    let running = 0
    let maxRunning = 0
    const slow = async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return {}
    }

    await runScheduledJobs({ jobs: [job('a', slow), job('b', slow), job('c', slow)] })

    expect(maxRunning).toBe(1)
  })

  it('passes the cron expression and a start time to each job', async () => {
    const contexts: JobContext[] = []
    const before = Date.now()

    await runScheduledJobs({
      cron: '*/5 * * * *',
      jobs: [
        job('capture', async (context) => {
          contexts.push(context)
          return {}
        }),
      ],
    })

    expect(contexts).toHaveLength(1)
    expect(contexts[0].cron).toBe('*/5 * * * *')
    expect(contexts[0].now.getTime()).toBeGreaterThanOrEqual(before)
    expect(contexts[0].scheduledTime).toBeUndefined()
  })

  it('passes the cron trigger scheduled time to each job', async () => {
    const scheduledTime = new Date('2026-09-17T03:30:00Z')
    const seen: Array<Date | undefined> = []

    await runScheduledJobs({
      scheduledTime,
      jobs: [
        job('capture', async (context) => {
          seen.push(context.scheduledTime)
          return {}
        }),
      ],
    })

    expect(seen).toEqual([scheduledTime])
  })

  it('keeps going after a job throws, and reports the failure', async () => {
    const after = vi.fn(async () => ({ ok: true }))

    const reports = await runScheduledJobs({
      jobs: [
        job('broken', async () => {
          throw new Error('connection reset')
        }),
        job('after', after),
      ],
    })

    expect(after).toHaveBeenCalledOnce()
    expect(reports).toMatchObject([
      { job: 'broken', ok: false, error: 'connection reset' },
      { job: 'after', ok: true },
    ])
    expect(reports[0].result).toBeUndefined()
  })

  it('logs one structured line per job', async () => {
    await runScheduledJobs({
      cron: '*/5 * * * *',
      jobs: [
        job('fine', async () => ({ released: 1 })),
        job('broken', async () => {
          throw new Error('boom')
        }),
      ],
    })

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        event: 'scheduled_job.succeeded',
        job: 'fine',
        cron: '*/5 * * * *',
        result: { released: 1 },
      }),
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'scheduled_job.failed',
        job: 'broken',
        error: 'boom',
        stack: expect.stringContaining('boom'),
      }),
    )
  })

  it('hands a failed job to onError with its name', async () => {
    const failure = new Error('boom')
    const onError = vi.fn()

    await runScheduledJobs({
      jobs: [
        job('fine', async () => ({})),
        job('broken', async () => {
          throw failure
        }),
      ],
      onError,
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(failure, 'broken')
  })

  it('survives an onError hook that throws', async () => {
    const reports = await runScheduledJobs({
      jobs: [
        job('broken', async () => {
          throw new Error('boom')
        }),
        job('after', async () => ({})),
      ],
      onError: async () => {
        throw new Error('tracker down')
      },
    })

    expect(reports.map((r) => r.ok)).toEqual([false, true])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduled_job.on_error_failed', job: 'broken', error: 'tracker down' }),
    )
  })

  it('turns a non-Error throw into a readable message', async () => {
    const reports = await runScheduledJobs({
      jobs: [
        job('weird', async () => {
          throw 'plain string'
        }),
      ],
    })

    expect(reports[0]).toMatchObject({ ok: false, error: 'plain string' })
  })
})

describe('scheduledLifecycleTransitionsJob', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips with a warning, without failing the run, while SYSTEM_ACTOR_USER_ID is unset', async () => {
    vi.stubEnv('SYSTEM_ACTOR_USER_ID', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await scheduledLifecycleTransitionsJob.run({ now: new Date() })

    expect(result).toEqual({ notConfigured: true })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job.skipped',
        job: 'runScheduledLifecycleTransitions',
        reason: 'SYSTEM_ACTOR_USER_ID is not set',
      }),
    )
  })
})
