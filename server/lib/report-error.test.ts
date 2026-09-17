import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { parseSentryDsn, reportError, reportRequestError } from './report-error'

const DSN = 'https://abc123@o42.ingest.sentry.io/4507'

function parseEnvelope(body: string) {
  const lines = body.split('\n')
  return { lines, header: JSON.parse(lines[0]), item: JSON.parse(lines[1]), event: JSON.parse(lines[2]) }
}

describe('parseSentryDsn', () => {
  it('builds the envelope endpoint from a standard DSN', () => {
    expect(parseSentryDsn(DSN)).toEqual({
      dsn: DSN,
      publicKey: 'abc123',
      envelopeUrl: 'https://o42.ingest.sentry.io/api/4507/envelope/',
    })
  })

  it('keeps a path prefix and port (self-hosted Sentry)', () => {
    expect(parseSentryDsn('https://key@sentry.example.com:9000/prefix/7')?.envelopeUrl).toBe(
      'https://sentry.example.com:9000/prefix/api/7/envelope/',
    )
  })

  it('rejects malformed DSNs', () => {
    expect(parseSentryDsn('not a url')).toBeNull()
    expect(parseSentryDsn('https://o42.ingest.sentry.io/4507')).toBeNull() // no public key
    expect(parseSentryDsn('https://abc@o42.ingest.sentry.io/')).toBeNull() // no project id
    expect(parseSentryDsn('ftp://abc@o42.ingest.sentry.io/1')).toBeNull()
  })
})

describe('reportError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    setRuntimeEnv({})
  })

  afterEach(() => {
    setRuntimeEnv({})
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('only logs when SENTRY_DSN is unset', async () => {
    vi.stubEnv('SENTRY_DSN', '')

    await reportError(new Error('database unreachable'), { requestId: 'req-1', path: '/api/v1/muns' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'error.reported',
        errorType: 'Error',
        error: 'database unreachable',
        requestId: 'req-1',
        path: '/api/v1/muns',
        stack: expect.stringContaining('database unreachable'),
      }),
    )
  })

  it("doesn't let context overwrite the log line's own fields", async () => {
    await reportError(new Error('real message'), { error: 'spoofed', level: 'info' })

    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ error: 'real message', level: 'error' }))
  })

  it('sends one envelope to Sentry when SENTRY_DSN is set on the Worker env', async () => {
    setRuntimeEnv({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging', SENTRY_RELEASE: 'abc1234' })
    const failure = new Error('outer', { cause: new Error('inner') })

    await reportError(failure, { requestId: 'req-2', job: 'releaseExpiredHolds', attempt: 2, skipped: undefined })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://o42.ingest.sentry.io/api/4507/envelope/')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-sentry-envelope')
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=abc123')
    expect(headers['X-Sentry-Auth']).toContain('sentry_version=7')
    expect(init.signal).toBeInstanceOf(AbortSignal)

    const { lines, header, item, event } = parseEnvelope(init.body as string)
    expect(lines).toHaveLength(3)
    expect(header).toMatchObject({ dsn: DSN, event_id: event.event_id })
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(item).toEqual({ type: 'event', content_type: 'application/json' })
    expect(event).toMatchObject({
      level: 'error',
      environment: 'staging',
      release: 'abc1234',
      tags: { requestId: 'req-2', job: 'releaseExpiredHolds', attempt: '2' },
      extra: { cause: 'inner' },
    })
    expect(event.tags).not.toHaveProperty('skipped')
    const exception = event.exception.values[0]
    expect(exception).toMatchObject({ type: 'Error', value: 'outer' })
    expect(exception.stacktrace.frames.length).toBeGreaterThan(0)
    expect(exception.stacktrace.frames.at(-1).filename).toContain('report-error.test.ts')
  })

  it('defaults the environment to production and omits an unset release', async () => {
    vi.stubEnv('SENTRY_DSN', DSN)

    await reportError('a thrown string')

    const { event } = parseEnvelope((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(event.environment).toBe('production')
    expect(event).not.toHaveProperty('release')
    expect(event.exception.values[0]).toEqual({ type: 'NonError', value: 'a thrown string' })
  })

  it('never throws when Sentry is unreachable or refuses the event', async () => {
    setRuntimeEnv({ SENTRY_DSN: DSN })

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(reportError(new Error('boom'))).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'error_report.delivery_failed', error: 'network down' }),
    )

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(reportError(new Error('boom'))).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'error_report.rejected', status: 429 }))
  })

  it('skips delivery for a malformed DSN', async () => {
    setRuntimeEnv({ SENTRY_DSN: 'nonsense' })

    await reportError(new Error('boom'))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'error_report.invalid_dsn' }))
  })
})

describe('reportRequestError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setRuntimeEnv({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('works without an ExecutionContext (Node, app.request) and tags method and path', async () => {
    const app = new Hono()
    app.get('/boom', (c) => {
      reportRequestError(c, new Error('handler failed'), { requestId: 'req-3' })
      return c.text('ok')
    })

    const res = await app.request('/boom?token=secret')

    expect(res.status).toBe(200)
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'handler failed', method: 'GET', path: '/boom', requestId: 'req-3' }),
      ),
    )
    // The query string (which can carry reset tokens) is never reported.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret')
  })

  it('keeps delivery alive with waitUntil on Workers', async () => {
    const waitUntil = vi.fn()
    const app = new Hono()
    app.get('/boom', (c) => {
      reportRequestError(c, new Error('handler failed'))
      return c.text('ok')
    })

    await app.request('/boom', {}, {}, { waitUntil, passThroughOnException: () => {}, props: {} })

    expect(waitUntil).toHaveBeenCalledOnce()
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })
})
