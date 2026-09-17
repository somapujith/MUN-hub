import { createMiddleware } from 'hono/factory'
import { runWithWaitUntil, type WaitUntil } from '@/lib/background-tasks'
import type { AppVariables } from '../src/types'

/**
 * Hands the request's `ExecutionContext.waitUntil` to lib/background-tasks.ts
 * for the rest of the request, so post-commit notifications that lib/ actions
 * start without awaiting are not cancelled once the response is sent (see
 * that file's header). Runs `next()` inside the AsyncLocalStorage scope, like
 * hyperdriveMiddleware.
 *
 * Hono's `c.executionCtx` getter throws when there is no ExecutionContext
 * (local Node dev, the `app.request()` test helper); the request then runs
 * without the scope and detached work simply finishes on its own.
 */
export const backgroundTasksMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  let waitUntil: WaitUntil | undefined
  try {
    const executionCtx = c.executionCtx
    waitUntil = (promise) => executionCtx.waitUntil(promise)
  } catch {
    waitUntil = undefined
  }

  if (waitUntil) {
    await runWithWaitUntil(waitUntil, () => next())
  } else {
    await next()
  }
})
