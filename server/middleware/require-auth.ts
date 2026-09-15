import type { MiddlewareHandler } from 'hono'
import type { AppVariables } from '../src/types'

/** Returns 401 when c.get('session') is null. */
export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const session = c.get('session')
  if (!session) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401)
  }
  await next()
}
