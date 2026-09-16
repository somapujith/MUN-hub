import { createMiddleware } from 'hono/factory'
import { setRuntimeEnv } from '@/lib/runtime-env'
import type { AppVariables } from '../src/types'

/**
 * Bridges Cloudflare Workers' `c.env` (plain vars + secrets) into
 * lib/runtime-env.ts, so lib/ modules with no Hono context can read them
 * (see that file's header comment for why this is needed at all). Must run
 * before anything that might read a var/secret this way — kept first in
 * server/src/app.ts's middleware stack, alongside hyperdriveMiddleware.
 * No-op for local Node dev (server/src/index.ts) and Hono's `app.request()`
 * test helper, where `c.env` doesn't carry these keys and `getRuntimeEnv()`
 * falls back to real `process.env`.
 */
export const runtimeEnvMiddleware = createMiddleware<{
  Variables: AppVariables
  Bindings: Record<string, string | undefined>
}>(async (c, next) => {
  if (c.env) setRuntimeEnv(c.env)
  await next()
})
