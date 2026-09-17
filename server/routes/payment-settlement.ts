import { Hono } from 'hono'
import { z } from 'zod'
import {
  getMunPaymentsSummary,
  getPaymentSettings,
  setPaymentVerificationState,
  upsertPaymentSettings,
} from '@/lib/actions/payment-settlement'
import { paymentVerificationEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

const upsertPaymentBodySchema = z
  .object({
    legalName: z.string().min(1),
    orgType: z.string().min(1),
    addressLine1: z.string().min(1),
    addressLine2: z.string().nullable().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(1),
    pan: z.string().min(1),
    gstin: z.string().nullable().optional(),
    authorizedRepName: z.string().min(1),
    authorizedRepEmail: z.string().email(),
    accountHolderName: z.string().min(1),
    bankName: z.string().min(1),
    accountNumber: z.string().min(1),
    ifsc: z.string().min(1),
    accountType: z.string().min(1),
    gateway: z.string().min(1),
    currency: z.string().optional(),
    // No `refundPolicy`: MUN Hub has one platform-wide no-refunds policy.
    // `.strict()` rejects the field if an old client still sends it.
    settlementNotes: z.string().nullable().optional(),
  })
  .strict()

const verificationStateBodySchema = z
  .object({
    state: z.enum(paymentVerificationEnum.enumValues),
  })
  .strict()

export const paymentSettlementRoutes = new Hono<{ Variables: AppVariables }>()

paymentSettlementRoutes.get('/muns/:munId/payment-settings', requireAuth, async (c) => {
  const settings = await getPaymentSettings(c.req.param('munId'), c.get('session'))
  return c.json(settings)
})

/** Paid-registration money for the finance page: gross, fee, fee tax, net. */
paymentSettlementRoutes.get('/muns/:munId/payments-summary', requireAuth, async (c) => {
  const totals = await getMunPaymentsSummary(c.req.param('munId'), c.get('session'))
  return c.json({ totals })
})

paymentSettlementRoutes.put(
  '/muns/:munId/payment-settings',
  requireAuth,
  zValidator('json', upsertPaymentBodySchema),
  async (c) => {
    const settings = await upsertPaymentSettings(
      c.req.param('munId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(settings, 200)
  },
)

paymentSettlementRoutes.post(
  '/muns/:munId/payment-settings/actions/set-verification-state',
  requireAuth,
  requireRole([...PUBLISH_ROLES]),
  zValidator('json', verificationStateBodySchema),
  async (c) => {
    const settings = await setPaymentVerificationState(
      c.req.param('munId'),
      c.req.valid('json').state,
      c.get('session'),
    )
    return c.json(settings, 200)
  },
)
