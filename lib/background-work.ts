import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Keeps post-commit side effects (notification emails) alive after the HTTP
 * response is sent.
 *
 * On Cloudflare Workers, work still pending once a handler has returned its
 * response can be cancelled unless it is handed to the request's
 * `ExecutionContext.waitUntil`. lib/ code has no access to Hono's
 * `c.executionCtx`, so `server/middleware/background-work.ts` runs the rest
 * of each request inside `runWithBackgroundWork` here, the same way
 * lib/db/hyperdrive-bridge.ts and lib/storage/bindings.ts receive their
 * bindings. The store is scoped to the request with AsyncLocalStorage, never
 * held at module level, so one request's `waitUntil` is never used for
 * another request handled by the same isolate.
 *
 * Local Node dev and Vitest run outside any scope: `runInBackground` still
 * starts the work and Node keeps the promise alive on its own.
 *
 * Callers that can simply `await` the side effect (registration-lifecycle.ts,
 * registration.ts) should keep doing that; this is for call sites where a
 * notification must not delay or fail the response.
 */

export type WaitUntil = (work: Promise<unknown>) => void

interface BackgroundWorkContext {
  waitUntil: WaitUntil
}

const backgroundWorkContext = new AsyncLocalStorage<BackgroundWorkContext>()

export function runWithBackgroundWork<T>(waitUntil: WaitUntil, fn: () => T): T {
  return backgroundWorkContext.run({ waitUntil }, fn)
}

/**
 * Starts `work` without waiting for it. The returned promise never rejects:
 * a failure (thrown synchronously or rejected) is logged with
 * `failureMessage` and swallowed, so it can never surface as a failure of
 * the change that triggered it. Inside a request scope the promise is also
 * handed to `waitUntil` so Workers doesn't cancel it after the response.
 */
export function runInBackground(work: () => Promise<unknown>, failureMessage: string): Promise<void> {
  let started: Promise<unknown>
  try {
    started = work()
  } catch (error) {
    started = Promise.reject(error)
  }
  const pending = started.then(
    () => undefined,
    (error: unknown) => {
      console.error(failureMessage, error)
    },
  )

  const store = backgroundWorkContext.getStore()
  if (store) {
    try {
      store.waitUntil(pending)
    } catch (error) {
      // The work is already running; only the keep-alive failed.
      console.error(`${failureMessage} (could not keep it alive past the response)`, error)
    }
  }
  return pending
}
