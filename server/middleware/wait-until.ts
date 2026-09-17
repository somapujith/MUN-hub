import { createMiddleware } from 'hono/factory'
import { runWithWaitUntil } from '@/lib/runtime-background'
import type { AppVariables } from '../src/types'

/**
 * Gives lib/runtime-background.ts the request's `waitUntil`, so lib/ code can
 * start post-response work (emails after a commit) that Workers won't drop.
 * Runs the rest of the request inside the scope, like hyperdriveMiddleware.
 * Under local Node dev and Hono's `app.request()` test helper there is no
 * ExecutionContext (Hono's getter throws), and the request runs unscoped.
 */
export const waitUntilMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  let waitUntil: ((promise: Promise<unknown>) => void) | undefined
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
