import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { runInBackground } from '@/lib/background-tasks'
import { backgroundTasksMiddleware } from './background-tasks'

function appThatNotifiesAfterCommit(started: { promise?: Promise<unknown> }) {
  const app = new Hono()
  app.use('*', backgroundTasksMiddleware)
  app.post('/decide', async (c) => {
    // Stands in for a lib/ action: transaction commits, then the notification
    // starts and the handler returns without awaiting it.
    await Promise.resolve()
    const pending = new Promise((resolve) => setTimeout(resolve, 5))
    started.promise = pending
    runInBackground(pending)
    return c.json({ ok: true })
  })
  return app
}

describe('backgroundTasksMiddleware', () => {
  it('keeps a post-commit notification alive with waitUntil on Workers', async () => {
    const waitUntil = vi.fn()
    const started: { promise?: Promise<unknown> } = {}

    const res = await appThatNotifiesAfterCommit(started).request(
      '/decide',
      { method: 'POST' },
      {},
      { waitUntil, passThroughOnException: () => {}, props: {} },
    )

    expect(res.status).toBe(200)
    // Without this, Workers may cancel the pending Hyperdrive query / ZeptoMail
    // fetch the moment the response is returned, and the email never goes out.
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
    await started.promise
  })

  it('passes the request through without an ExecutionContext (Node dev, app.request)', async () => {
    const started: { promise?: Promise<unknown> } = {}

    const res = await appThatNotifiesAfterCommit(started).request('/decide', { method: 'POST' })

    expect(res.status).toBe(200)
    await expect(started.promise).resolves.toBeUndefined()
  })

  it('scopes the sink to one request — a later request never reuses it', async () => {
    const waitUntil = vi.fn()
    const started: { promise?: Promise<unknown> } = {}
    const app = appThatNotifiesAfterCommit(started)

    await app.request('/decide', { method: 'POST' }, {}, { waitUntil, passThroughOnException: () => {}, props: {} })
    await started.promise
    expect(waitUntil).toHaveBeenCalledTimes(1)

    // Same isolate, no ExecutionContext this time: the previous request's
    // waitUntil must not be reachable (that is the bug AsyncLocalStorage
    // prevents — see lib/db/hyperdrive-bridge.ts's header).
    await app.request('/decide', { method: 'POST' })
    await started.promise
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })
})
