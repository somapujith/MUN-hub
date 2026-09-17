import { createMiddleware } from 'hono/factory'
import { runWithBackgroundTasks } from '@/lib/background-tasks'
import type { AppVariables } from '../src/types'

/**
 * Bridges Cloudflare Workers' `executionCtx.waitUntil` into
 * lib/background-tasks.ts, so lib/ modules with no Hono context can keep
 * post-commit work (pipeline notification emails) alive past the response.
 * Without it a detached promise is cancelled when the invocation ends and the
 * email silently never goes out — see that file's header comment.
 *
 * Runs the rest of the request inside the AsyncLocalStorage scope, the same
 * shape as hyperdriveMiddleware. `c.executionCtx` throws when there is no
 * ExecutionContext (local Node dev, Hono's `app.request()` test helper), so
 * the sink resolves it per call and swallows that — the promise then simply
 * settles on its own, exactly as before.
 */
export const backgroundTasksMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  await runWithBackgroundTasks((promise) => {
    try {
      c.executionCtx.waitUntil(promise)
    } catch {
      // Not on Workers — nothing to keep alive.
    }
  }, () => next())
})
