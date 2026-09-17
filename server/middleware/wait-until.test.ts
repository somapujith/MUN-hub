import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { runInBackground } from '@/lib/runtime-background'
import type { AppVariables } from '../src/types'
import { waitUntilMiddleware } from './wait-until'

function appWithBackgroundWork(work: () => Promise<void>) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', waitUntilMiddleware)
  app.get('/', (c) => {
    void runInBackground('test', work)
    return c.json({ ok: true })
  })
  return app
}

describe('waitUntilMiddleware', () => {
  it("hands lib background work to the request's ExecutionContext", async () => {
    const work = vi.fn(async () => {})
    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }

    const res = await appWithBackgroundWork(work).fetch(new Request('http://api.test/'), {}, executionCtx)

    expect(res.status).toBe(200)
    expect(executionCtx.waitUntil).toHaveBeenCalledTimes(1)
    await executionCtx.waitUntil.mock.calls[0][0]
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('lets the request run unscoped without an ExecutionContext (Node, app.request)', async () => {
    const work = vi.fn(async () => {})

    const res = await appWithBackgroundWork(work).request('/')

    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1))
  })
})
