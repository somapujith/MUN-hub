import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Keeps post-commit background work (notification emails, mostly) alive past
 * the HTTP response on Cloudflare Workers.
 *
 * Why this exists: a Worker may cancel anything still pending once the
 * response has been returned, unless that work was handed to
 * `ExecutionContext.waitUntil`. Several `lib/` modules start a promise after
 * their transaction commits and deliberately never await it, so a slow
 * response never waits on ZeptoMail — correct under Node, but on Workers
 * that promise's Hyperdrive query or `fetch` can simply be cancelled, and
 * the `.catch(...)` never even runs, so the drop is silent.
 *
 * `lib/` is framework-agnostic and has no access to Hono's `c.executionCtx`
 * (Workers only hands you an ExecutionContext inside a request handler), so
 * this mirrors the `lib/db/hyperdrive-bridge.ts` / `lib/storage/bindings.ts`
 * pattern: `server/middleware/background-tasks.ts` runs the request inside
 * `runWithBackgroundTasks`, and any `lib/` module can then call
 * `runInBackground(promise)` without importing anything Workers-specific.
 *
 * AsyncLocalStorage, not a module-level variable: a Worker isolate is reused
 * across requests and can interleave concurrent ones, so a shared slot would
 * hand one request's work to another request's ExecutionContext (the same
 * class of bug documented at length in lib/db/hyperdrive-bridge.ts).
 *
 * Under local Node dev and Vitest no sink is ever registered, so
 * `runInBackground` is a no-op wrapper: the promise is already running and
 * the process simply lets it finish, exactly as before this bridge existed.
 */

/** Receives a promise that must outlive the response. Must never throw. */
export type BackgroundTaskSink = (work: Promise<unknown>) => void

const backgroundTaskContext = new AsyncLocalStorage<BackgroundTaskSink>()

/** Runs `fn` with `sink` available to `runInBackground` for its whole async call graph. */
export function runWithBackgroundTasks<T>(sink: BackgroundTaskSink, fn: () => T): T {
  return backgroundTaskContext.run(sink, fn)
}

/**
 * Registers already-started work that must survive the response.
 *
 * `work` must never reject — every call site attaches its own `.catch(...)`
 * and logs, since a notification failure must never surface as a failure of
 * the state change that triggered it. A rejection is caught here too rather
 * than becoming an unhandled rejection that could fail the whole invocation.
 */
export function runInBackground(work: Promise<unknown>): void {
  const settled = work.catch((error) => {
    console.error('[background-tasks] background work rejected', error)
  })

  const sink = backgroundTaskContext.getStore()
  if (!sink) return // Node dev / tests: the promise finishes on its own.

  try {
    sink(settled)
  } catch (error) {
    // A sink that refuses the work (e.g. the request already ended) must not
    // break the caller — the promise is running regardless.
    console.error('[background-tasks] could not keep background work alive', error)
  }
}
