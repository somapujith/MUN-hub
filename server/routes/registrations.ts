import { zValidator } from '../lib/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  getProductAvailability,
  getProductsAvailability,
  getRegistrationById,
  initiateRegistration,
} from '@/lib/actions/registration'
import { db } from '@/lib/db/client'
import { payments, registrations } from '@/lib/db/schema'
import { simulatePaymentOutcome } from '@/lib/payments/mock-adapter'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const MAX_BATCH_AVAILABILITY_IDS = 50

const initiateRegistrationBodySchema = z
  .object({
    munId: z.string().uuid(),
    registrationProductId: z.string().uuid(),
    committeeId: z.string().uuid().optional(),
    portfolioId: z.string().uuid().optional(),
    formResponses: z.record(z.string(), z.unknown()).optional(),
    accommodationOptionId: z.string().uuid().optional(),
    accommodationAnswers: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const mockPaymentBodySchema = z
  .object({
    outcome: z.enum(['success', 'failure']),
  })
  .strict()

export const registrationsRoutes = new Hono<{ Variables: AppVariables }>()

registrationsRoutes.get('/products/:productId/availability', async (c) => {
  const productId = c.req.param('productId')
  const availability = await getProductAvailability(productId)
  return c.json(availability)
})

registrationsRoutes.get('/products/availability', async (c) => {
  const idsParam = c.req.query('ids') ?? ''
  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    return c.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Query parameter ids is required' } },
      400,
    )
  }

  if (ids.length > MAX_BATCH_AVAILABILITY_IDS) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: `At most ${MAX_BATCH_AVAILABILITY_IDS} product ids allowed`,
        },
      },
      400,
    )
  }

  const pairs = await getProductsAvailability(ids)
  const availability = Object.fromEntries(pairs)
  return c.json({ availability })
})

registrationsRoutes.post(
  '/registrations',
  requireAuth,
  async (c, next) => {
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Idempotency-Key header is required',
          },
        },
        400,
      )
    }
    await next()
  },
  zValidator('json', initiateRegistrationBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const session = c.get('session')
    const result = await initiateRegistration(body, session)
    return c.json(result, 201)
  },
)

/**
 * Enriched read for the checkout/confirmation pages: `getRegistrationById`
 * (lib/actions/registration.ts) stays the single source of truth for the
 * owner/admin/organizer authorization decision — this only adds the
 * presentation-only joins (product name/price, mun, committee, portfolio)
 * that page needs to render, mirroring the shape
 * `lib/actions/student-dashboard.ts#getUpcomingRegistrations` already
 * returns and the same two-step (authorize via lib, then join for display)
 * pattern `app/register/[slug]/pay/page.tsx` used server-side.
 */
registrationsRoutes.get('/registrations/:id', requireAuth, async (c) => {
  const registrationId = c.req.param('id')
  const session = c.get('session')
  const registration = await getRegistrationById(registrationId, session)

  if (!registration) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Registration not found' } },
      404,
    )
  }

  const detail = await db.query.registrations.findFirst({
    where: eq(registrations.id, registrationId),
    with: {
      mun: true,
      committee: true,
      portfolio: true,
      payment: true,
      registrationProduct: true,
    },
  })

  if (!detail) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Registration not found' } },
      404,
    )
  }

  return c.json({
    id: detail.id,
    status: detail.status,
    registrationProductId: detail.registrationProductId,
    committeeId: detail.committeeId,
    portfolioId: detail.portfolioId,
    userId: detail.userId,
    expiresAt: detail.expiresAt,
    productName: detail.registrationProduct.name,
    productPrice: detail.registrationProduct.price,
    mun: {
      id: detail.mun.id,
      slug: detail.mun.slug,
      name: detail.mun.name,
      city: detail.mun.city,
      country: detail.mun.country,
      startDate: detail.mun.startDate,
      endDate: detail.mun.endDate,
    },
    committee: detail.committee ? { name: detail.committee.name } : null,
    portfolio: detail.portfolio ? { name: detail.portfolio.name } : null,
    payment: detail.payment.map((p) => ({ amount: p.amount, status: p.status })),
  })
})

/**
 * Mock checkout submit — ported from
 * `app/register/[slug]/actions.ts#completeMockPaymentAction`. Signs a
 * provider-shaped payload server-side (the HMAC secret never reaches the
 * browser) and posts it to the same `/webhooks/payments` route a real
 * provider would call, so confirmation still only ever happens in
 * `server/routes/webhooks.ts` — never duplicated here.
 *
 * `getRegistrationById` throws Forbidden for a non-owner (caught by the app
 * error handler) and returns null for an unknown id, so one student can't
 * drive another student's payment.
 */
registrationsRoutes.post(
  '/registrations/:id/mock-payment',
  requireAuth,
  zValidator('json', mockPaymentBodySchema),
  async (c) => {
    const registrationId = c.req.param('id')
    const session = c.get('session')
    const { outcome } = c.req.valid('json')

    const registration = await getRegistrationById(registrationId, session)
    if (!registration) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Registration not found' } },
        404,
      )
    }

    const [payment] = await db
      .select({ orderId: payments.providerOrderId })
      .from(payments)
      .where(eq(payments.registrationId, registrationId))
      .limit(1)

    if (!payment) {
      throw new Error('Payment order not found')
    }

    const { payload, signature } = await simulatePaymentOutcome(payment.orderId, outcome)

    // Self-call, same-origin: derived from the incoming request rather than
    // a hardcoded/env-configured origin, matching the Next.js reference's
    // reasoning (a fixed "http://localhost:3000" fallback would silently
    // break this under any deployment target where that env var isn't set).
    const host = c.req.header('host') ?? 'localhost:3001'
    const protocol = c.req.header('x-forwarded-proto') ?? 'http'

    let response: Response
    try {
      response = await fetch(`${protocol}://${host}/webhooks/payments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        body: payload,
      })
    } catch {
      return c.json(
        {
          error: {
            code: 'INTERNAL',
            message: 'Payment processor unreachable. Your seat is still held.',
          },
        },
        502,
      )
    }

    const body: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      return c.json(
        {
          error: {
            code: 'INTERNAL',
            message: 'Payment processor unreachable. Your seat is still held.',
          },
        },
        502,
      )
    }

    return c.json(body ?? { ok: true })
  },
)
