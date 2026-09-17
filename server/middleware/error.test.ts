import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppVariables } from '../src/types'

const { reportRequestError } = vi.hoisted(() => ({ reportRequestError: vi.fn() }))
vi.mock('../lib/report-error', () => ({ reportRequestError }))

const { errorHandler } = await import('./error')

function appThrowing(error: unknown) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-123')
    await next()
  })
  app.get('/', () => {
    throw error
  })
  app.onError(errorHandler)
  return app
}

afterEach(() => {
  vi.restoreAllMocks()
  reportRequestError.mockReset()
})

describe('errorHandler', () => {
  it('reports an unhandled error once, with the request id, and answers a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('unexpected: connection reset')

    const res = await appThrowing(failure).request('/')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error', requestId: 'req-123' },
    })
    expect(reportRequestError).toHaveBeenCalledTimes(1)
    expect(reportRequestError).toHaveBeenCalledWith(expect.anything(), failure, { requestId: 'req-123' })
  })

  it('does not report mapped errors', async () => {
    const res = await appThrowing(new Error('Forbidden')).request('/')

    expect(res.status).toBe(403)
    expect(reportRequestError).not.toHaveBeenCalled()
  })
})
