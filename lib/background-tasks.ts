import { AsyncLocalStorage } from 'node:async_hooks'

// -----------------------------------------------------------------------------
// Background work that must outlive the HTTP response
// -----------------------------------------------------------------------------
//
// Several lib/ actions send notifications after their transaction commits
// without making the caller wait for them (a slow email API must not slow the
// response down). On Cloudflare Workers, a promise that is still pending when
// the response has been sent can be cancelled — silently, with no rejection
// and no log line — unless it was handed to the request's
// `ExecutionContext.waitUntil`. lib/ modules have no Hono context, so
// `server/middleware/background-tasks.ts` puts the request's `waitUntil` into
// this AsyncLocalStorage scope (the same pattern as
// lib/db/hyperdrive-bridge.ts), and `runInBackground` registers every
// detached promise with it.
//
// Local Node dev and Vitest never enter the scope: there is no
// ExecutionContext there, and a detached promise simply runs to completion.
// -----------------------------------------------------------------------------

export type WaitUntil = (promise: Promise<unknown>) => void

const waitUntilContext = new AsyncLocalStorage<WaitUntil>()

/** Runs `fn` with `waitUntil` available to every `runInBackground` call in its async call graph. */
export function runWithWaitUntil<T>(waitUntil: WaitUntil, fn: () => T): T {
  return waitUntilContext.run(waitUntil, fn)
}

/**
 * Starts `work` now without waiting for it, and keeps it alive past the
 * response on Workers. A failure is logged with `label` and never thrown, so
 * it can't affect the caller. Only use this after the caller's transaction
 * has committed.
 */
export function runInBackground(label: string, work: () => Promise<void>): void {
  let pending: Promise<void>
  try {
    pending = work().catch((error: unknown) => {
      console.error(`[${label}] background task failed`, error)
    })
  } catch (error) {
    console.error(`[${label}] background task failed`, error)
    return
  }

  const waitUntil = waitUntilContext.getStore()
  if (!waitUntil) return
  try {
    waitUntil(pending)
  } catch (error) {
    // The work is already running; only its keep-alive failed.
    console.error(`[${label}] could not keep the background task alive`, error)
  }
}
