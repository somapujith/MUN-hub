import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { runInBackground } from '@/lib/background-work'
import { backgroundWorkMiddleware } from './background-work'

function buildApp(work: () => Promise<unknown>) {
  const app = new Hono()
  app.use('*', backgroundWorkMiddleware)
  app.post('/notify', async (c) => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    void runInBackground(work, '[test] notification failed')
    return c.json({ ok: true })
  })
  return app
}

describe('backgroundWorkMiddleware', () => {
  it("passes post-commit work to the request's ExecutionContext.waitUntil", async () => {
    let sent = false
    const app = buildApp(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      sent = true
    })
    // A detached `waitUntil` throws "Illegal invocation" on Workers; this
    // fake does the same, so the test fails if the middleware unbinds it.
    const executionCtx = {
      pending: [] as Promise<unknown>[],
      waitUntil(this: { pending: Promise<unknown>[] } | undefined, work: Promise<unknown>) {
        if (this !== executionCtx) throw new TypeError('Illegal invocation')
        this.pending.push(work)
      },
      passThroughOnException() {},
      props: {},
    }

    const res = await app.request('/notify', { method: 'POST' }, undefined, executionCtx)

    expect(res.status).toBe(200)
    expect(executionCtx.pending).toHaveLength(1)
    expect(sent).toBe(false)
    await Promise.all(executionCtx.pending)
    expect(sent).toBe(true)
  })

  it('still runs the work when there is no ExecutionContext (Node dev, tests)', async () => {
    const work = vi.fn().mockResolvedValue(undefined)
    const app = buildApp(work)

    const res = await app.request('/notify', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(work).toHaveBeenCalledTimes(1)
  })
})
