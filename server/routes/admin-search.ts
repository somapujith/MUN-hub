import { Hono } from 'hono'
import { z } from 'zod'
import { recordPiiRead } from '@/lib/actions/admin-pii-read'
import { listPaymentExceptions, resolvePaymentException, searchRegistrations } from '@/lib/actions/admin-search'
import { getPaymentTimeline, PAYMENT_RECONCILE_ERRORS, reconcilePaymentAsAdmin } from '@/lib/payments/admin-reconcile'
import { PAYMENT_EXCEPTION_ERRORS, RESOLUTION_NOTE_MAX_LENGTH } from '@/lib/payments/exceptions'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const searchQuerySchema = z
  .object({
    q: z.string().min(1),
  })
  .strict()

const paymentExceptionsQuerySchema = z
  .object({
    status: z.enum(['open', 'resolved']).optional(),
    q: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()

const resolveExceptionBodySchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(1, PAYMENT_EXCEPTION_ERRORS.noteRequired)
      .max(RESOLUTION_NOTE_MAX_LENGTH, PAYMENT_EXCEPTION_ERRORS.noteTooLong),
  })
  .strict()

const RESOLVE_ERROR_RESPONSES: Record<string, { status: 404 | 409; code: string }> = {
  [PAYMENT_EXCEPTION_ERRORS.notFound]: { status: 404, code: 'NOT_FOUND' },
  [PAYMENT_EXCEPTION_ERRORS.alreadyResolved]: { status: 409, code: 'CONFLICT_STATE' },
}

const RECONCILE_ERROR_RESPONSES: Record<string, { status: 404 | 409; code: string }> = {
  [PAYMENT_RECONCILE_ERRORS.notFound]: { status: 404, code: 'NOT_FOUND' },
  [PAYMENT_RECONCILE_ERRORS.unsupportedProvider]: { status: 409, code: 'CONFLICT_STATE' },
  [PAYMENT_RECONCILE_ERRORS.alreadySettled]: { status: 409, code: 'CONFLICT_STATE' },
  [PAYMENT_RECONCILE_ERRORS.notConfigured]: { status: 409, code: 'CONFLICT_STATE' },
}

export const adminSearchRoutes = new Hono<{ Variables: AppVariables }>()

adminSearchRoutes.get(
  '/admin/search/registrations',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const { q } = searchQuerySchema.parse(c.req.query())
    const session = c.get('session')!
    const results = await searchRegistrations(q, session)
    // Rows carry delegate names.
    await recordPiiRead({
      actorId: session.userId,
      route: 'GET /admin/search/registrations',
      targetType: 'registration',
      targetIds: results.map((row) => row.registrationId),
      hasQuery: true,
    })
    return c.json(results)
  },
)

/**
 * Payment exceptions (money taken with no valid registration), newest first,
 * paginated. `?status=open|resolved` (default open), `?q=` matches the
 * delegate's email or the MUN's name.
 */
adminSearchRoutes.get(
  '/admin/payment-exceptions',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const query = paymentExceptionsQuerySchema.parse(c.req.query())
    const session = c.get('session')!
    const result = await listPaymentExceptions({ status: query.status, search: query.q, limit: query.limit, offset: query.offset }, session)
    // Rows carry delegate names/emails.
    await recordPiiRead({
      actorId: session.userId,
      route: 'GET /admin/payment-exceptions',
      targetType: 'payment',
      targetIds: result.results.map((row) => row.paymentId),
      hasQuery: Boolean(query.q),
    })
    return c.json(result)
  },
)

/** Marks one payment exception resolved, with a required note (audited). */
adminSearchRoutes.post(
  '/admin/payment-exceptions/:paymentId/resolve',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  zValidator('json', resolveExceptionBodySchema),
  async (c) => {
    try {
      const resolved = await resolvePaymentException(
        c.req.param('paymentId'),
        c.req.valid('json').note,
        c.get('session'),
      )
      return c.json(resolved)
    } catch (error) {
      const mapped = error instanceof Error ? RESOLVE_ERROR_RESPONSES[error.message] : undefined
      if (mapped) {
        return c.json({ error: { code: mapped.code, message: (error as Error).message } }, mapped.status)
      }
      throw error
    }
  },
)

/**
 * Manual, on-demand counterpart to the 5-minute reconcileCashfreeOrders cron
 * job (lib/jobs/reconcile-cashfree-orders.ts) — runs the same
 * checkOrderPayments call + real webhook-processing settlement path for one
 * payment an admin is looking at right now, instead of waiting for the next
 * sweep. See lib/payments/admin-reconcile.ts for the full reuse story.
 */
adminSearchRoutes.post(
  '/admin/payments/:paymentId/reconcile',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    try {
      const result = await reconcilePaymentAsAdmin(c.req.param('paymentId'), c.get('session'))
      return c.json(result)
    } catch (error) {
      const mapped = error instanceof Error ? RECONCILE_ERROR_RESPONSES[error.message] : undefined
      if (mapped) {
        return c.json({ error: { code: mapped.code, message: (error as Error).message } }, mapped.status)
      }
      throw error
    }
  },
)

/**
 * Read-only payment lifecycle timeline — every payment_webhook_events row for
 * one payment, oldest first. Admin's only payment visibility before this was
 * the exceptions queue above and searchRegistrations' bare payments.status;
 * neither shows event history.
 */
adminSearchRoutes.get(
  '/admin/payments/:paymentId/timeline',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    try {
      const result = await getPaymentTimeline(c.req.param('paymentId'), c.get('session'))
      return c.json(result)
    } catch (error) {
      if (error instanceof Error && error.message === PAYMENT_RECONCILE_ERRORS.notFound) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      throw error
    }
  },
)
