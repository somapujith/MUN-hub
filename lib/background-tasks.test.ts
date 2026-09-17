import { describe, expect, it, vi } from 'vitest'
import { runInBackground, runWithWaitUntil } from './background-tasks'

describe('runInBackground', () => {
  it('hands the work to the registered waitUntil (Workers)', () => {
    const waitUntil = vi.fn()

    runWithWaitUntil(waitUntil, () => runInBackground('send', async () => {}))

    expect(waitUntil).toHaveBeenCalledOnce()
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('keeps work registered from deeper in the async call graph (the real call shape)', async () => {
    const waitUntil = vi.fn()

    // Mirrors a route handler: the action awaits its transaction, then starts
    // the notification afterwards — several `await`s inside the ALS scope.
    await runWithWaitUntil(waitUntil, async () => {
      await Promise.resolve()
      await Promise.resolve()
      runInBackground('send', async () => {})
    })

    expect(waitUntil).toHaveBeenCalledOnce()
  })

  it('does not leak a waitUntil into work started outside the scope', () => {
    const waitUntil = vi.fn()
    runWithWaitUntil(waitUntil, () => {})

    runInBackground('send', async () => {})

    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('still runs the work without a waitUntil (local Node dev and tests)', async () => {
    let ran = false
    expect(() =>
      runInBackground('send', async () => {
        ran = true
      }),
    ).not.toThrow()
    await vi.waitFor(() => expect(ran).toBe(true))
  })

  it('swallows a rejection instead of leaving it unhandled', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn()

    runWithWaitUntil(waitUntil, () =>
      runInBackground('send', async () => {
        throw new Error('delivery failed')
      }),
    )

    // The promise waitUntil receives must settle, never reject — Workers
    // treats a rejected waitUntil promise as a failed invocation.
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith('[send] background task failed', expect.any(Error))
    consoleError.mockRestore()
  })

  it('logs a synchronous throw from the work function instead of propagating it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      runInBackground('send', () => {
        throw new Error('boom')
      }),
    ).not.toThrow()
    expect(consoleError).toHaveBeenCalledWith('[send] background task failed', expect.any(Error))
    consoleError.mockRestore()
  })

  it('survives a waitUntil that throws (request already ended)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn(() => {
      throw new Error('no ExecutionContext')
    })

    expect(() => runWithWaitUntil(waitUntil, () => runInBackground('send', async () => {}))).not.toThrow()
    expect(consoleError).toHaveBeenCalledWith('[send] could not keep the background task alive', expect.any(Error))
    consoleError.mockRestore()
  })
})
