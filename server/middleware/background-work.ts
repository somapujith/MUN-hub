import { createMiddleware } from 'hono/factory'
import { runWithBackgroundWork } from '@/lib/background-work'
import type { AppVariables } from '../src/types'

/**
 * Hands this request's `ExecutionContext.waitUntil` to lib/background-work.ts
 * so post-commit notifications started with `runInBackground` survive the
 * response on Workers. Runs `next()` inside the AsyncLocalStorage scope, like
 * hyperdriveMiddleware and storageMiddleware.
 *
 * Hono's `c.executionCtx` getter throws when there is no ExecutionContext
 * (local Node dev, `app.request()` tests without one); the request then runs
 * outside any scope and `runInBackground` just lets Node finish the work.
 */
export const backgroundWorkMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  let executionCtx: { waitUntil(work: Promise<unknown>): void } | undefined
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
  // Called as a method: Workers' waitUntil throws "Illegal invocation" when
  // detached from its ExecutionContext.
  await runWithBackgroundWork((work) => ctx.waitUntil(work), () => next())
})
