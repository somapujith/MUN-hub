import { Hono, type Context } from 'hono'
import { handleTelegramUpdate } from '@/lib/actions/telegram'
import { getPaymentsAdapter } from '@/lib/payments/registry'
import { processPaymentWebhook, type ProcessWebhookResult, type WebhookErrorCode } from '@/lib/payments/webhook'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { LIMITERS } from '../middleware/rate-limit'
import { consumeRateLimit, getClientIp, rateLimitIpKey } from '../lib/rate-limit-store'
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
 * middleware — and outside rateLimitMiddleware's RULES table too, so its own
 * per-IP limit (LIMITERS.webhooksPaymentsIp) is applied directly here rather
 * than relying on the /api/v1-scoped middleware. Every hit that reaches
 * `processPaymentWebhook` for GuruPay triggers a real outbound authenticated
 * `check-status` call, so this endpoint must never be unthrottled — it could
 * otherwise be used to amplify calls against GuruPay's API using MUNHub's
 * key, or to exhaust Workers resources. The limit (60/min per IP) is
 * generous enough for real webhook/retry volume from GuruPay itself. With no
 * usable payments adapter there is nothing that could have sent a genuine
 * event, so the endpoint answers 404 (checked after the rate limit, so an
 * unauthenticated flood still costs the caller their budget either way).
 */
export const webhooks = new Hono<{ Variables: AppVariables }>().post('/payments', async (c) => {
  const ip = rateLimitIpKey(getClientIp(c))
  const { allowed, retryAfterSec } = await consumeRateLimit(c.env, LIMITERS.webhooksPaymentsIp, `ip:${ip}`)
  if (!allowed) {
    c.header('Retry-After', String(Math.max(1, retryAfterSec)))
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } }, 429)
  }

  const adapter = getPaymentsAdapter()
  if (!adapter) {
    return c.json({ error: 'Payments are not enabled' }, 404)
  }

  const rawBody = await c.req.text()
  const result = await processPaymentWebhook(adapter, rawBody, c.req.raw.headers)
  return webhookResponse(c, result)
})

/**
 * Telegram bot webhook. Verified with the secret token Telegram echoes back
 * on every request once set via `setWebhook`'s `secret_token` param
 * (`TELEGRAM_WEBHOOK_SECRET`) — Telegram's own recommended alternative to
 * signature verification, since update payloads aren't signed. With no
 * secret configured the endpoint refuses every request rather than accepting
 * unauthenticated Telegram-shaped POSTs from anyone who finds the URL.
 * Always answers 200 (never a retriable error) so a payload we can't parse
 * doesn't spin Telegram's automatic retries.
 */
webhooks.post('/telegram', async (c) => {
  const secret = getRuntimeEnv('TELEGRAM_WEBHOOK_SECRET')
  if (!secret) return c.json({ error: 'Telegram webhook is not configured' }, 404)
  if (c.req.header('x-telegram-bot-api-secret-token') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const update: unknown = await c.req.json().catch(() => null)
  keepAlive(c, handleTelegramUpdate(update).catch((error: unknown) => {
    console.error('[telegram webhook] handling failed', error)
  }))
  return c.json({ ok: true })
})
