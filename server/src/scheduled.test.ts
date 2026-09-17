import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHyperdriveConnectionString } from '@/lib/db/hyperdrive-bridge'
import type { ScheduledJob } from '@/lib/jobs/types'
import { getRuntimeEnv, setRuntimeEnv } from '@/lib/runtime-env'
import { handleScheduled } from './scheduled'
import worker from './worker'

const EVENT = { cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 8, 17, 3, 0) }

function job(name: string, run: ScheduledJob['run']): ScheduledJob {
  return { name, run }
}

describe('handleScheduled', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    setRuntimeEnv({})
    vi.restoreAllMocks()
  })

  it('bridges the Worker env and runs every job inside a Hyperdrive scope', async () => {
    const seen: Array<{ connectionString?: string; appUrl?: string }> = []
    const capture = async () => {
      seen.push({ connectionString: getHyperdriveConnectionString(), appUrl: getRuntimeEnv('APP_URL') })
      return {}
    }

    const reports = await handleScheduled(
      EVENT,
      { APP_URL: 'https://munhub.in', HYPERDRIVE: { connectionString: 'postgres://hyperdrive.local/db' } },
      [job('one', capture), job('two', capture)],
    )

    expect(reports.map((r) => r.ok)).toEqual([true, true])
    expect(seen).toEqual([
      { connectionString: 'postgres://hyperdrive.local/db', appUrl: 'https://munhub.in' },
      { connectionString: 'postgres://hyperdrive.local/db', appUrl: 'https://munhub.in' },
    ])
    // The scope ends with the invocation.
    expect(getHyperdriveConnectionString()).toBeUndefined()
  })

  it('runs without a Hyperdrive binding (wrangler dev without one, local tests)', async () => {
    const seen: Array<string | undefined> = []

    await handleScheduled(EVENT, {}, [
      job('one', async () => {
        seen.push(getHyperdriveConnectionString())
        return {}
      }),
    ])

    expect(seen).toEqual([undefined])
  })

  it('passes the cron expression to jobs and logs the run', async () => {
    const crons: Array<string | undefined> = []

    await handleScheduled(EVENT, {}, [
      job('one', async ({ cron }) => {
        crons.push(cron)
        return { released: 0 }
      }),
    ])

    expect(crons).toEqual(['*/5 * * * *'])
    expect(console.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_run.started',
        cron: '*/5 * * * *',
        scheduledAt: '2026-09-17T03:00:00.000Z',
      }),
    )
    expect(console.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduled_run.finished', level: 'info', jobs: 1, failed: [] }),
    )
  })

  it('runs the remaining jobs after a failure, reports it, then fails the invocation', async () => {
    const after = vi.fn(async () => ({}))

    await expect(
      handleScheduled(EVENT, {}, [
        job('broken', async () => {
          throw new Error('deadlock detected')
        }),
        job('after', after),
      ]),
    ).rejects.toThrow('Scheduled jobs failed: broken')

    expect(after).toHaveBeenCalledOnce()
    // Forwarded to reportError, which always logs a structured line.
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'error.reported',
        error: 'deadlock detected',
        source: 'scheduled',
        job: 'broken',
        cron: '*/5 * * * *',
      }),
    )
    expect(console.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduled_run.finished', level: 'error', failed: ['broken'] }),
    )
  })
})

describe('worker entrypoint', () => {
  it('exports both fetch and scheduled handlers', () => {
    expect(typeof worker.fetch).toBe('function')
    expect(typeof worker.scheduled).toBe('function')
  })

  it('serves the API through fetch', async () => {
    const res = await worker.fetch(new Request('http://api.test/api/v1/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })
})
