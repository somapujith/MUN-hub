import type { MiddlewareHandler } from 'hono'
import { requireRole as assertRole } from '@/lib/auth/authorize'
import { STAFF_ROLES } from '@/lib/actions/admin-staff'
import { hasConfirmedMfa } from '@/lib/actions/staff-mfa'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { Role } from '@/lib/db/schema-enums'
import type { AppVariables } from '../src/types'

/**
 * Wraps lib/auth/authorize.requireRole — 403 on mismatch. When `allowedRoles`
 * includes a staff role (OPERATIONS/ADMIN/SUPER_ADMIN) and
 * REQUIRE_STAFF_2FA=true, additionally requires *confirmed* TOTP enrollment
 * (lib/actions/staff-mfa.ts) — a staff account can always sign in and reach
 * the enrollment routes (requireAuth only, not this), but every other
 * staff-gated route is blocked until setup is confirmed. The env check comes
 * first so this is a single boolean comparison — no extra query — whenever
 * REQUIRE_STAFF_2FA is unset, which keeps every existing staff-role route
 * (including the seeded admin's E2E login) byte-for-byte unchanged until the
 * env var is deliberately turned on.
 */
export function requireRole(allowedRoles: Role[]): MiddlewareHandler<{ Variables: AppVariables }> {
  const mayNeedMfa = allowedRoles.some((role) => (STAFF_ROLES as readonly string[]).includes(role))

  return async (c, next) => {
    const session = c.get('session')
    try {
      assertRole(session, allowedRoles)
    } catch {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
    }

    if (mayNeedMfa && getRuntimeEnv('REQUIRE_STAFF_2FA') === 'true' && !(await hasConfirmedMfa(session.userId))) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Two-factor authentication setup is required for this account' } },
        403,
      )
    }

    await next()
  }
}
