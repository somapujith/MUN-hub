import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInBackground, runWithBackgroundWork } from './background-work'

describe('runInBackground', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands the pending work to the request scope waitUntil', async () => {
    const waitUntil = vi.fn()
    let finished = false

    runWithBackgroundWork(waitUntil, () => {
      void runInBackground(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        finished = true
      }, 'test failed')
    })

    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(finished).toBe(false)
    await waitUntil.mock.calls[0][0]
    expect(finished).toBe(true)
  })

  it('keeps the scope across awaits inside the request', async () => {
    const waitUntil = vi.fn()

    await runWithBackgroundWork(waitUntil, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      void runInBackground(async () => undefined, 'test failed')
    })

    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('still runs the work outside any request scope', async () => {
    const work = vi.fn().mockResolvedValue(undefined)
    await runInBackground(work, 'test failed')
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('never uses a waitUntil from a scope that has ended', async () => {
    const waitUntil = vi.fn()
    runWithBackgroundWork(waitUntil, () => undefined)

    await runInBackground(async () => undefined, 'test failed')
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('logs and swallows a rejected or synchronously throwing task', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const waitUntil = vi.fn()

    await runWithBackgroundWork(waitUntil, async () => {
      await expect(runInBackground(() => Promise.reject(new Error('smtp down')), '[x] rejected')).resolves.toBeUndefined()
      await expect(
        runInBackground(() => {
          throw new Error('lookup failed')
        }, '[x] threw'),
      ).resolves.toBeUndefined()
    })

    expect(consoleError).toHaveBeenCalledWith('[x] rejected', expect.objectContaining({ message: 'smtp down' }))
    expect(consoleError).toHaveBeenCalledWith('[x] threw', expect.objectContaining({ message: 'lookup failed' }))
    // The promises handed to waitUntil never reject either.
    for (const [pending] of waitUntil.mock.calls) {
      await expect(pending).resolves.toBeUndefined()
    }
  })

  it('does not throw when waitUntil itself throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const work = vi.fn().mockResolvedValue(undefined)

    await runWithBackgroundWork(
      () => {
        throw new Error('Illegal invocation')
      },
      async () => {
        await runInBackground(work, '[x] failed')
      },
    )

    expect(work).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[x] failed'), expect.any(Error))
  })
})
