import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { fireAndForget } from '@/lib/background-tasks'
import { backgroundTasksMiddleware } from './background-tasks'

// The bug this guards: pipeline notifications are started after the
// triggering transaction commits and deliberately not awaited. On Cloudflare
// Workers, work still pending when the response is sent is cancelled — no
// rejection, no log line, the email simply never goes out. `fireAndForget`
// only sees a `waitUntil` if this middleware put one in scope.
describe('backgroundTasksMiddleware', () => {
  function appThatDefersWork(work: () => Promise<void>) {
    const app = new Hono()
    app.use('*', backgroundTasksMiddleware)
    app.get('/act', (c) => {
      fireAndForget('test', work)
      return c.json({ ok: true })
    })
    return app
  }

  it('hands deferred work to executionCtx.waitUntil on Workers', async () => {
    const waitUntil = vi.fn()
    const app = appThatDefersWork(async () => {})

    const res = await app.request('/act', {}, {}, { waitUntil, passThroughOnException: () => {}, props: {} })

    expect(res.status).toBe(200)
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('still runs the work when there is no ExecutionContext (Node dev, tests)', async () => {
    const work = vi.fn(async () => {})
    const app = appThatDefersWork(work)

    const res = await app.request('/act')

    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(work).toHaveBeenCalledOnce())
  })

  it('logs a failing deferred task instead of rejecting the response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn()
    const app = appThatDefersWork(async () => {
      throw new Error('smtp down')
    })

    const res = await app.request('/act', {}, {}, { waitUntil, passThroughOnException: () => {}, props: {} })

    expect(res.status).toBe(200)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[test] background work failed', expect.any(Error))
    error.mockRestore()
  })
})
