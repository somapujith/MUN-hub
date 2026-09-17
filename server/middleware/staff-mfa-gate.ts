import { createMiddleware } from 'hono/factory'
import { STAFF_ROLES } from '@/lib/actions/admin-staff'
import { hasConfirmedMfa } from '@/lib/actions/staff-mfa'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { AppVariables } from '../src/types'

/**
 * REQUIRE_STAFF_2FA, enforced where the session is, not per route.
 *
 * server/middleware/require-role.ts makes the same check, but only for
 * routes that go through `requireRole` with a staff role in the list. Plenty
 * of staff powers are granted *inside* lib actions behind `requireAuth`-only
 * routes — cancelling or archiving any MUN
 * (POST /muns/:munId/lifecycle/:action, which emails every delegate),
 * reviewing results, reading support conversations full of delegates'
 * personal data, every `assertOwnsOrAdmin` admin override — so with only the
 * per-route check an unenrolled staff session kept all of those while being
 * refused at /admin/*. That is not the policy the operator switched on.
 *
 * So: when REQUIRE_STAFF_2FA=true and the session belongs to a staff account
 * (OPERATIONS/ADMIN/SUPER_ADMIN) with no confirmed TOTP enrollment, nothing
 * under /api/v1 is allowed except:
 *
 * - `/auth/**` — sign in, sign out, read the session, and crucially the
 *   enrollment routes themselves, or the account could never get out of this
 *   state; and
 * - `/files/**` — public, unprivileged reads of uploaded images/PDFs, which
 *   a staff member's browser loads on any page it is allowed to show.
 *
 * Everything else answers 403 with the same message requireRole uses, so the
 * web app can react to one string. When REQUIRE_STAFF_2FA is unset (today's
 * production) this is a single string comparison and no query at all — every
 * existing route stays byte-for-byte unchanged.
 *
 * requireRole keeps its own copy of the check on purpose: it is the guard
 * that route modules reach for directly, and it must stay correct even if
 * this middleware is ever mounted somewhere narrower.
 */
export const staffMfaGateMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  if (getRuntimeEnv('REQUIRE_STAFF_2FA') !== 'true') return next()

  const session = c.get('session')
  if (!session || !(STAFF_ROLES as readonly string[]).includes(session.role)) return next()

  const path = c.req.path.replace(/^\/api\/v1/, '') || '/'
  if (path === '/auth' || path.startsWith('/auth/') || path.startsWith('/files/')) return next()

  if (await hasConfirmedMfa(session.userId)) return next()

  return c.json(
    { error: { code: 'FORBIDDEN', message: 'Two-factor authentication setup is required for this account' } },
    403,
  )
})
