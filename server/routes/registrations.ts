import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  getProductAvailability,
  getProductsAvailability,
  getRegistrationById,
  initiateRegistration,
} from '@/lib/actions/registration'
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

  return c.json(registration)
})
