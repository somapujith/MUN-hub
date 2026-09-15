import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments, registrations } from '@/lib/db/schema'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'
import type { AppVariables } from '../src/types'

interface WebhookPayload {
  orderId: string
  status: 'paid' | 'failed'
  providerPaymentId?: string
}

/**
 * Payments provider webhook — ported from app/api/webhooks/payments/route.ts.
 * Raw body is read BEFORE JSON parse so signature verification uses exact bytes.
 * Mounted outside /api/v1 and outside CSRF middleware.
 */
export const webhooks = new Hono<{ Variables: AppVariables }>().post('/payments', async (c) => {
  const rawBody = await c.req.text()
  const signature = c.req.header('x-webhook-signature') ?? ''

  if (!mockPaymentsAdapter.verifyWebhookSignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 400)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  const payload = parsed as WebhookPayload

  if (!payload.orderId || typeof payload.orderId !== 'string') {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  if (payload.status !== 'paid' && payload.status !== 'failed') {
    return c.json({ error: 'Invalid payload' }, 400)
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerOrderId, payload.orderId))
    .limit(1)

  if (!payment) {
    return c.json({ error: 'Payment not found' }, 404)
  }

  if (payment.status === 'PAID') {
    return c.json({ ok: true, alreadyConfirmed: true }, 200)
  }

  if (payload.status === 'failed') {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id))

      await tx
        .update(registrations)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(registrations.id, payment.registrationId), eq(registrations.status, 'PAYMENT_PENDING')))
    })
    return c.json({ ok: true }, 200)
  }

  const outcome = await db.transaction(async (tx) => {
    const [currentRegistration] = await tx
      .select({ status: registrations.status })
      .from(registrations)
      .where(eq(registrations.id, payment.registrationId))
      .for('update')
      .limit(1)

    const registrationIsConfirmable = currentRegistration?.status === 'PAYMENT_PENDING'

    await tx
      .update(payments)
      .set({
        status: registrationIsConfirmable ? 'PAID' : 'REFUNDED',
        providerPaymentId: payload.providerPaymentId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))

    if (registrationIsConfirmable) {
      await tx
        .update(registrations)
        .set({ status: 'CONFIRMED', updatedAt: new Date() })
        .where(eq(registrations.id, payment.registrationId))
    }

    return { registrationIsConfirmable }
  })

  return c.json({ ok: true, refundOwed: !outcome.registrationIsConfirmable }, 200)
})
