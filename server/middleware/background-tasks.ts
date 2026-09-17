import { createMiddleware } from 'hono/factory'
import { runWithBackgroundTasks } from '@/lib/background-tasks'
import type { AppVariables } from '../src/types'

/** Structural, so this file doesn't depend on Workers' global type declarations. */
type WaitUntilCapable = { waitUntil: (work: Promise<unknown>) => void }

/**
 * Hands `lib/background-tasks.ts` this request's `waitUntil`, so post-commit
 * notification sends started by a `lib/` action survive the response on
 * Cloudflare Workers. Same shape as `keepAlive` in server/routes/webhooks.ts,
 * but reachable from framework-agnostic `lib/` code that never sees `c`.
 *
 * Runs the rest of the request (`next()`) *inside* the AsyncLocalStorage
 * scope, like hyperdriveMiddleware/storageMiddleware, so nothing leaks into
 * another request handled by the same isolate.
 *
 * `c.executionCtx` throws when there is no ExecutionContext — local Node dev
 * (`@hono/node-server`) and Hono's `app.request(...)` test helper — where an
 * un-awaited promise simply finishes on its own and no sink is needed.
 */
export const backgroundTasksMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  let executionCtx: WaitUntilCapable | undefined
  try {
    executionCtx = c.executionCtx
  } catch {
    executionCtx = undefined
  }

  if (!executionCtx) {
    await next()
    return
  }

  const ctx = executionCtx
  await runWithBackgroundTasks(
    (work) => ctx.waitUntil(work),
    () => next(),
  )
})
