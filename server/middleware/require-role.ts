import type { MiddlewareHandler } from 'hono'
import { requireRole as assertRole } from '@/lib/auth/authorize'
import type { Role } from '@/lib/db/schema-enums'
import type { AppVariables } from '../src/types'

/** Wraps lib/auth/authorize.requireRole — 403 on mismatch. */
export function requireRole(allowedRoles: Role[]): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    try {
      assertRole(c.get('session'), allowedRoles)
    } catch {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
    }
    await next()
  }
}
