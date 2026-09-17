import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Post-response work for lib/ code that has no Hono context.
 *
 * On Cloudflare Workers, work still pending when the response is returned
 * can be dropped unless it is handed to the request's
 * `ExecutionContext.waitUntil`. lib/ modules can't reach that context, so
 * `server/middleware/wait-until.ts` runs each request inside
 * `runWithWaitUntil`, and `runInBackground` hands its promise to the
 * request's `waitUntil` when there is one. The work runs in the same async
 * scope as the request, so it uses the request's database client (see
 * lib/db/hyperdrive-bridge.ts). Same AsyncLocalStorage pattern as that file:
 * never a module-level variable, since one isolate serves many requests.
 *
 * Outside a request scope (local Node dev, tests, cron jobs) the work simply
 * runs to completion on its own; cron jobs should await their work instead.
 */

type WaitUntil = (promise: Promise<unknown>) => void

const waitUntilContext = new AsyncLocalStorage<WaitUntil>()

export function runWithWaitUntil<T>(waitUntil: WaitUntil, fn: () => T): T {
  return waitUntilContext.run(waitUntil, fn)
}

/**
 * Starts `work` without making the caller wait for it. Failures are logged
 * under `label`, never thrown. Returns the (never-rejecting) promise for a
 * caller that does need to wait, such as a test.
 */
export function runInBackground(label: string, work: () => Promise<unknown>): Promise<void> {
  const pending = Promise.resolve()
    .then(work)
    .then(
      () => undefined,
      (error: unknown) => {
        console.error(`[background] ${label} failed`, error)
      },
    )

  const waitUntil = waitUntilContext.getStore()
  if (waitUntil) {
    try {
      waitUntil(pending)
    } catch (error) {
      console.error(`[background] could not keep ${label} alive past the response`, error)
    }
  }
  return pending
}
