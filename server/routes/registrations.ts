import { zValidator } from '../lib/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { assertEmailVerifiedIfRequired } from '@/lib/actions/email-verification'
import {
  REGISTRATION_ERRORS,
  REGISTRATION_ERROR_STATUS,
  getProductAvailability,
  getProductsAvailability,
  getRegistrationById,
  getRegistrationReceipt,
  initiateRegistration,
} from '@/lib/actions/registration'
import { isProfileComplete } from '@/lib/actions/student-profile'
import { db } from '@/lib/db/client'
import { payments, registrations } from '@/lib/db/schema'
import { MOCK_PROVIDER, simulatePaymentOutcome } from '@/lib/payments/mock-adapter'
import { getPaymentsAdapter } from '@/lib/payments/registry'
import { processPaymentWebhook } from '@/lib/payments/webhook'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'
import { keepAlive } from './webhooks'

const MAX_BATCH_AVAILABILITY_IDS = 50
const MAX_IDEMPOTENCY_KEY_LENGTH = 255

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

function registrationErrorResponse(c: Context<{ Variables: AppVariables }>, message: string) {
  const status = REGISTRATION_ERROR_STATUS[message] ?? 400
  const code =
    status === 503 ? 'PAYMENTS_UNAVAILABLE' : status === 409 ? 'CONFLICT_STATE' : 'VALIDATION_FAILED'
  return c.json({ error: { code, message } }, status)
}

function notFound(c: Context<{ Variables: AppVariables }>) {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Registration not found' } }, 404)
}

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

/**
 * Starts a registration. The `Idempotency-Key` header is required and is
 * passed through: a retry with the same key by the same user answers 200
 * with the original registration instead of 201 with a new one.
 * A paid pass with no usable payments adapter answers 503
 * PAYMENTS_UNAVAILABLE (no seat is held); a free pass is confirmed at once.
 */
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
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
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
    const session = c.get('session')!
    const idempotencyKey = c.req.header('Idempotency-Key')!.trim()

    // The one-time participant profile (emergency contact, DOB, school…) is
    // required before any registration. Enforced here rather than inside
    // initiateRegistration so lib unit tests can keep calling it directly.
    if (!(await isProfileComplete(session.userId))) {
      return registrationErrorResponse(c, REGISTRATION_ERRORS.profileIncomplete)
    }
    // A no-op unless REQUIRE_EMAIL_VERIFICATION is "true"; its error is
    // mapped to 403 by the shared handler (server/middleware/error.ts).
    await assertEmailVerifiedIfRequired(session.userId)

    try {
      const result = await initiateRegistration(body, session, { idempotencyKey })
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (Object.hasOwn(REGISTRATION_ERROR_STATUS, message)) {
        return registrationErrorResponse(c, message)
      }
      throw error
    }
  },
)

/**
 * Enriched read for the checkout/confirmation pages: `getRegistrationById`
 * (lib/actions/registration.ts) stays the single source of truth for the
 * owner/admin/organizer authorization decision — this only adds the
 * presentation-only joins (product name/price, mun, committee, portfolio,
 * payment) that page needs to render, mirroring the shape
 * `lib/actions/student-dashboard.ts#getUpcomingRegistrations` already
 * returns.
 *
 * `paymentProvider` is the provider checkout should use right now, or null
 * when online payments are unavailable (the pay page then says so instead
 * of offering a checkout).
 */
registrationsRoutes.get('/registrations/:id', requireAuth, async (c) => {
  const registrationId = c.req.param('id')
  const session = c.get('session')
  const registration = await getRegistrationById(registrationId, session)

  if (!registration) {
    return notFound(c)
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
    return notFound(c)
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
    payment: detail.payment.map((p) => ({ amount: p.amount, currency: p.currency, status: p.status })),
    paymentProvider: getPaymentsAdapter()?.provider ?? null,
  })
})

/**
 * The delegate's receipt. Owner-only: anyone else (organizers and admins
 * included) gets the same 404 as for an unknown id.
 */
registrationsRoutes.get('/registrations/:id/receipt', requireAuth, async (c) => {
  const receipt = await getRegistrationReceipt(c.req.param('id'), c.get('session'))
  if (!receipt) {
    return notFound(c)
  }
  return c.json(receipt)
})

/**
 * Mock checkout submit (dev/test only). Exists only while the mock adapter
 * is the active one (`MOCK_PAYMENTS_ENABLED=true`) — otherwise 404, exactly
 * as if the route didn't exist. Builds a mock-signed provider webhook
 * server-side (the HMAC secret never reaches the browser) and runs it
 * through `processPaymentWebhook`, the same verification + settlement path a
 * real delivery to `/webhooks/payments` takes — confirmation never happens
 * anywhere else.
 *
 * Only the registration's own delegate may drive its payment; everyone else
 * gets 404.
 */
registrationsRoutes.post(
  '/registrations/:id/mock-payment',
  requireAuth,
  async (c, next) => {
    if (getPaymentsAdapter()?.provider !== MOCK_PROVIDER) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
    }
    await next()
  },
  zValidator('json', mockPaymentBodySchema),
  async (c) => {
    const adapter = getPaymentsAdapter()!
    const registrationId = c.req.param('id')
    const session = c.get('session')!
    const { outcome } = c.req.valid('json')

    const [registration] = await db
      .select({ userId: registrations.userId })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .limit(1)
    if (!registration || registration.userId !== session.userId) {
      return notFound(c)
    }

    const [payment] = await db
      .select({ orderId: payments.providerOrderId, amount: payments.amount, currency: payments.currency })
      .from(payments)
      .where(eq(payments.registrationId, registrationId))
      .limit(1)

    if (!payment) {
      return c.json(
        { error: { code: 'CONFLICT_STATE', message: 'This registration has nothing to pay' } },
        409,
      )
    }

    const webhook = simulatePaymentOutcome(payment, outcome)
    const result = await processPaymentWebhook(adapter, webhook.rawBody, webhook.headers)

    if (!result.ok) {
      console.error(`[payments] mock payment for ${registrationId} rejected: ${result.error}`)
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

    keepAlive(c, result.afterCommit)
    return c.json(result.body)
  },
)
