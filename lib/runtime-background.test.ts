import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInBackground, runWithWaitUntil } from './runtime-background'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runInBackground', () => {
  it('runs the work outside a request scope and resolves when it is done', async () => {
    const work = vi.fn(async () => 'done')
    await runInBackground('test work', work)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('logs a failure instead of rejecting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      runInBackground('failing work', async () => {
        throw new Error('boom')
      }),
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[background] failing work failed', expect.any(Error))
  })

  it("hands the work to the request's waitUntil inside a scope", async () => {
    const waitUntil = vi.fn()
    const pending = runWithWaitUntil(waitUntil, () => runInBackground('scoped work', async () => {}))
    expect(waitUntil).toHaveBeenCalledWith(pending)
    await pending
  })

  it('keeps each scope to its own waitUntil', async () => {
    const first = vi.fn()
    const second = vi.fn()
    await Promise.all([
      runWithWaitUntil(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await runInBackground('first', async () => {})
      }),
      runWithWaitUntil(second, async () => {
        await runInBackground('second', async () => {})
      }),
    ])
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('still runs the work if waitUntil throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const work = vi.fn(async () => {})
    await runWithWaitUntil(
      () => {
        throw new Error('no context')
      },
      () => runInBackground('work', work),
    )
    expect(work).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
  })
})
