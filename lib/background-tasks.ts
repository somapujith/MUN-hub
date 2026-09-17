import { AsyncLocalStorage } from 'node:async_hooks'

// -----------------------------------------------------------------------------
// background-tasks — keeping post-commit work alive past the response
// -----------------------------------------------------------------------------
//
// Several lib/ modules start work AFTER the transaction that triggered it has
// committed and deliberately don't await it, so a slow email never delays (or
// fails) the write: the pipeline notifications in lib/lifecycle/go-live.ts,
// lib/lifecycle/organizer-confirmation.ts and lib/lifecycle/module-completion.ts.
//
// Under Node that is fine — the promise settles on its own. On Cloudflare
// Workers it is not: work still pending when the response is returned can be
// cancelled outright, so a detached promise that starts with a Hyperdrive read
// and then an email API call will usually never finish. No error is logged,
// because the promise is cancelled rather than rejected.
//
// Handlers keep such work alive with `c.executionCtx.waitUntil(...)`, but a
// lib/ module has no Hono context — the same problem lib/db/hyperdrive-bridge.ts
// and lib/runtime-env.ts solve, and this file follows the same shape:
// `server/middleware/background-tasks.ts` runs each request inside
// `runWithBackgroundTasks`, handing it a sink that forwards to `waitUntil`, and
// `fireAndForget` below registers its promise with whatever sink is in scope.
//
// Outside a request scope (local Node dev, Vitest, the cron handler) there is
// no sink and the promise simply runs to completion as before.
// -----------------------------------------------------------------------------

/** Receives a detached promise that must outlive the response — `waitUntil`, in practice. */
export type BackgroundTaskSink = (promise: Promise<unknown>) => void

const sinkStorage = new AsyncLocalStorage<BackgroundTaskSink>()

/**
 * Runs `fn` (and everything in its async call graph) with `sink` registered as
 * the destination for `fireAndForget`/`registerBackgroundTask` promises.
 */
export function runWithBackgroundTasks<T>(sink: BackgroundTaskSink, fn: () => T): T {
  return sinkStorage.run(sink, fn)
}

/**
 * Hands `promise` to the sink for the current request, if there is one. Never
 * throws: a sink that rejects the registration (an already-finished
 * ExecutionContext) must not take down the caller, which has already committed
 * its work.
 */
export function registerBackgroundTask(promise: Promise<unknown>): void {
  const sink = sinkStorage.getStore()
  if (!sink) return
  try {
    sink(promise)
  } catch (error) {
    console.error('[background-tasks] could not register background work', error)
  }
}

/**
 * Starts `work` without awaiting it, logs any failure under `label`, and keeps
 * it alive past the response on Workers. The single helper every post-commit
 * notification site should use instead of a bare `work().catch(...)`.
 */
export function fireAndForget(label: string, work: () => Promise<void>): void {
  const pending = Promise.resolve()
    .then(work)
    .catch((error: unknown) => {
      console.error(`[${label}] background work failed`, error)
    })
  registerBackgroundTask(pending)
}
