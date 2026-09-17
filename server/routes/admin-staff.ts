import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  changeStaffRole,
  createStaffAccount,
  issueStaffSetPasswordLink,
  listStaff,
  reinstateStaff,
  STAFF_ERRORS,
  STAFF_ROLES,
  suspendStaff,
} from '@/lib/actions/admin-staff'
import { resetStaffMfa } from '@/lib/actions/staff-mfa'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

type AppContext = Context<{ Variables: AppVariables }>

// Reads: any staff role. Writes: SUPER_ADMIN only (lib/actions/admin-staff.ts
// re-checks this under a row lock).
const MANAGE_ROLES = ['SUPER_ADMIN'] as const

const listQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    role: z.enum(STAFF_ROLES).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const createBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    role: z.enum(STAFF_ROLES),
  })
  .strict()

const roleBodySchema = z.object({ role: z.enum(STAFF_ROLES) }).strict()

const suspendBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict()

const STAFF_ERROR_STATUS: Record<string, 400 | 409> = {
  [STAFF_ERRORS.self]: 409,
  [STAFF_ERRORS.alreadySuspended]: 409,
  [STAFF_ERRORS.notSuspended]: 409,
  [STAFF_ERRORS.suspendedNoLink]: 409,
  [STAFF_ERRORS.invalidEmail]: 400,
  [STAFF_ERRORS.invalidRole]: 400,
  [STAFF_ERRORS.reasonRequired]: 400,
}

/** Maps this lane's lib errors; everything else ('Forbidden', '… not found', duplicates) goes to the global handler. */
async function withStaffErrors(c: AppContext, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = Object.hasOwn(STAFF_ERROR_STATUS, message) ? STAFF_ERROR_STATUS[message] : undefined
    if (status === undefined) throw error
    return c.json({ error: { code: status === 409 ? 'CONFLICT_STATE' : 'VALIDATION_FAILED', message } }, status)
  }
}

/**
 * Base URL for set-password links. APP_URL is the configured public web
 * origin (the SPA serves /reset-password on every host). The request Origin is
 * only a fallback for local dev; the link goes back to the authenticated
 * SUPER_ADMIN who asked for it, not to an email address.
 */
function resolveAppUrl(c: AppContext): string {
  return getRuntimeEnv('APP_URL') ?? c.req.header('Origin') ?? 'http://localhost:5173'
}

export const adminStaffRoutes = new Hono<{ Variables: AppVariables }>()

adminStaffRoutes.get('/admin/staff', requireAuth, requireRole([...STAFF_ROLES]), async (c) => {
  const params = listQuerySchema.parse(c.req.query())
  return c.json(await listStaff(params, c.get('session')))
})

adminStaffRoutes.post(
  '/admin/staff',
  requireAuth,
  requireRole([...MANAGE_ROLES]),
  zValidator('json', createBodySchema),
  (c) =>
    withStaffErrors(c, async () => {
      const result = await createStaffAccount(c.req.valid('json'), resolveAppUrl(c), c.get('session'))
      c.header('Cache-Control', 'no-store')
      return c.json(result, 201)
    }),
)

adminStaffRoutes.patch(
  '/admin/staff/:userId/role',
  requireAuth,
  requireRole([...MANAGE_ROLES]),
  zValidator('json', roleBodySchema),
  (c) =>
    withStaffErrors(c, async () => {
      const staff = await changeStaffRole(c.req.param('userId'), c.req.valid('json').role, c.get('session'))
      return c.json(staff)
    }),
)

adminStaffRoutes.post(
  '/admin/staff/:userId/suspend',
  requireAuth,
  requireRole([...MANAGE_ROLES]),
  zValidator('json', suspendBodySchema),
  (c) =>
    withStaffErrors(c, async () => {
      const staff = await suspendStaff(c.req.param('userId'), c.req.valid('json').reason, c.get('session'))
      return c.json(staff)
    }),
)

adminStaffRoutes.post('/admin/staff/:userId/reinstate', requireAuth, requireRole([...MANAGE_ROLES]), (c) =>
  withStaffErrors(c, async () => {
    const staff = await reinstateStaff(c.req.param('userId'), c.get('session'))
    return c.json(staff)
  }),
)

adminStaffRoutes.post('/admin/staff/:userId/set-password-link', requireAuth, requireRole([...MANAGE_ROLES]), (c) =>
  withStaffErrors(c, async () => {
    const link = await issueStaffSetPasswordLink(c.req.param('userId'), resolveAppUrl(c), c.get('session'))
    c.header('Cache-Control', 'no-store')
    return c.json(link)
  }),
)

// Clears a staff member's TOTP enrollment (lib/actions/staff-mfa.ts) so they
// can re-enroll after losing their device — SUPER_ADMIN only, audit-logged.
adminStaffRoutes.post('/admin/staff/:userId/mfa/reset', requireAuth, requireRole([...MANAGE_ROLES]), async (c) => {
  await resetStaffMfa(c.req.param('userId'), c.get('session')!)
  return c.body(null, 204)
})
