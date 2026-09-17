import { describe, expect, it, vi } from 'vitest'
import { runInBackground, runWithBackgroundTasks } from './background-tasks'

describe('runInBackground', () => {
  it('hands the work to the registered sink (Workers: waitUntil)', () => {
    const sink = vi.fn()
    const work = Promise.resolve('sent')

    runWithBackgroundTasks(sink, () => runInBackground(work))

    expect(sink).toHaveBeenCalledOnce()
    expect(sink.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('keeps work registered from deeper in the async call graph (the real call shape)', async () => {
    const sink = vi.fn()

    // Mirrors a route handler: the action awaits its transaction, then starts
    // the notification afterwards — several `await`s inside the ALS scope.
    await runWithBackgroundTasks(sink, async () => {
      await Promise.resolve()
      await Promise.resolve()
      runInBackground(Promise.resolve())
    })

    expect(sink).toHaveBeenCalledOnce()
  })

  it('does not leak a sink into work started outside the scope', () => {
    const sink = vi.fn()
    runWithBackgroundTasks(sink, () => {})

    runInBackground(Promise.resolve())

    expect(sink).not.toHaveBeenCalled()
  })

  it('is a no-op without a sink (local Node dev and tests)', () => {
    expect(() => runInBackground(Promise.resolve())).not.toThrow()
  })

  it('swallows a rejection instead of leaving it unhandled', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sink = vi.fn()

    runWithBackgroundTasks(sink, () => runInBackground(Promise.reject(new Error('delivery failed'))))

    // The promise the sink receives must settle, never reject — Workers
    // treats a rejected waitUntil promise as a failed invocation.
    await expect(sink.mock.calls[0][0]).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('survives a sink that throws (request already ended)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sink = vi.fn(() => {
      throw new Error('no ExecutionContext')
    })

    expect(() => runWithBackgroundTasks(sink, () => runInBackground(Promise.resolve()))).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
