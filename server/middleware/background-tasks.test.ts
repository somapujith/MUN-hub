import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInBackground, runWithWaitUntil } from '@/lib/background-tasks'
import { backgroundTasksMiddleware } from './background-tasks'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runInBackground', () => {
  it('starts the work and hands it to waitUntil when the request provides one', async () => {
    const waitUntil = vi.fn()
    const work = vi.fn(async () => {})

    runWithWaitUntil(waitUntil, () => runInBackground('test', work))

    expect(work).toHaveBeenCalledOnce()
    expect(waitUntil).toHaveBeenCalledOnce()
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
  })

  it('still runs the work without a waitUntil scope (local Node, tests)', async () => {
    let done = false
    runInBackground('test', async () => {
      done = true
    })
    await vi.waitFor(() => expect(done).toBe(true))
  })

  it('logs a failure instead of rejecting the promise it keeps alive', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn()

    runWithWaitUntil(waitUntil, () =>
      runInBackground('failing task', async () => {
        throw new Error('email API down')
      }),
    )

    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledWith('[failing task] background task failed', expect.any(Error))
  })

  it('logs a synchronous throw from the work function', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      runInBackground('sync throw', () => {
        throw new Error('boom')
      }),
    ).not.toThrow()
    expect(console.error).toHaveBeenCalledWith('[sync throw] background task failed', expect.any(Error))
  })
})

describe('backgroundTasksMiddleware', () => {
  it('registers work a handler starts without awaiting with the request ExecutionContext', async () => {
    const waitUntil = vi.fn()
    const app = new Hono()
    app.use('*', backgroundTasksMiddleware)
    app.post('/confirm', (c) => {
      runInBackground('pipeline notification', async () => {})
      return c.json({ ok: true })
    })

    const res = await app.request('/confirm', { method: 'POST' }, {}, { waitUntil, passThroughOnException: () => {}, props: {} })

    expect(res.status).toBe(200)
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('passes requests through when there is no ExecutionContext', async () => {
    let ran = false
    const app = new Hono()
    app.use('*', backgroundTasksMiddleware)
    app.get('/ping', (c) => {
      runInBackground('pipeline notification', async () => {
        ran = true
      })
      return c.text('pong')
    })

    const res = await app.request('/ping')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('pong')
    await vi.waitFor(() => expect(ran).toBe(true))
  })
})
