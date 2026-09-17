import { Hono } from 'hono'
import { z } from 'zod'
import { recordPiiRead } from '@/lib/actions/admin-pii-read'
import { listPaymentExceptions, resolvePaymentException, searchRegistrations } from '@/lib/actions/admin-search'
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

/** Open payment exceptions (money taken with no valid registration), newest first. */
adminSearchRoutes.get(
  '/admin/payment-exceptions',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const session = c.get('session')!
    const results = await listPaymentExceptions(session)
    // Rows carry delegate names and emails.
    await recordPiiRead({
      actorId: session.userId,
      route: 'GET /admin/payment-exceptions',
      targetType: 'payment',
      targetIds: results.map((row) => row.paymentId),
      hasQuery: false,
    })
    return c.json(results)
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
