import { Hono, type Context } from 'hono'
import { getPaymentsAdapter } from '@/lib/payments/registry'
import { processPaymentWebhook, type ProcessWebhookResult, type WebhookErrorCode } from '@/lib/payments/webhook'
import type { AppVariables } from '../src/types'

const WEBHOOK_ERROR_STATUS: Record<WebhookErrorCode, 400 | 404> = {
  INVALID_SIGNATURE: 400,
  INVALID_PAYLOAD: 400,
  STALE_EVENT: 400,
  PAYMENT_NOT_FOUND: 404,
}

/**
 * Keeps post-commit payment hooks alive past the response on Workers.
 * `c.executionCtx` throws outside Workers (Node dev, `app.request` tests),
 * where the already-running promise simply finishes on its own.
 */
export function keepAlive(c: Context, work: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(work)
  } catch {
    // Not on Workers.
  }
}

/** Maps a processor result to the HTTP response a provider expects. */
export function webhookResponse(c: Context<{ Variables: AppVariables }>, result: ProcessWebhookResult) {
  if (!result.ok) {
    return c.json({ error: result.message, code: result.error }, WEBHOOK_ERROR_STATUS[result.error])
  }
  keepAlive(c, result.afterCommit)
  return c.json(result.body, 200)
}

/**
 * Payments provider webhook. Raw body is read BEFORE any JSON parse so
 * signature verification uses the exact bytes; everything else lives in
 * lib/payments/webhook.ts. Mounted outside /api/v1 and outside CSRF
 * middleware. With no usable payments adapter there is nothing that could
 * have sent a genuine event, so the endpoint answers 404.
 */
export const webhooks = new Hono<{ Variables: AppVariables }>().post('/payments', async (c) => {
  const adapter = getPaymentsAdapter()
  if (!adapter) {
    return c.json({ error: 'Payments are not enabled' }, 404)
  }

  const rawBody = await c.req.text()
  const result = await processPaymentWebhook(adapter, rawBody, c.req.raw.headers)
  return webhookResponse(c, result)
})
