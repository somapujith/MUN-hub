import crypto from 'node:crypto'
import { getRuntimeEnv } from '@/lib/runtime-env'
import {
  WebhookVerificationError,
  type CreateOrderInput,
  type PaymentOrder,
  type PaymentWebhookEvent,
  type PaymentWebhookEventType,
  type PaymentsAdapter,
} from './adapter'

/**
 * Dev/test-only payments provider. Selected by the registry only when
 * `MOCK_PAYMENTS_ENABLED=true` (see ./registry.ts) — it must never be
 * reachable in production, where it would hand out free seats.
 *
 * Webhook wire format (Stripe-style signed timestamp):
 *   x-webhook-timestamp: <unix seconds at signing>
 *   x-webhook-signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *   body: {"id","type","orderId","providerPaymentId","amount","currency","createdAt"}
 */

export const MOCK_PROVIDER = 'mock_razorpay'

export const MOCK_SIGNATURE_HEADER = 'x-webhook-signature'
export const MOCK_TIMESTAMP_HEADER = 'x-webhook-timestamp'

// getRuntimeEnv (not `process.env` directly) — Cloudflare Workers never
// populate custom vars/secrets into `process.env`, so a direct read here
// would silently see this as unset on every real webhook in production even
// though it's correctly configured as a Workers secret. See lib/runtime-env.ts.
export function getMockWebhookSecret(): string | undefined {
  return getRuntimeEnv('MOCK_PAYMENT_WEBHOOK_SECRET') || undefined
}

function requireSecret(): string {
  const secret = getMockWebhookSecret()
  if (!secret) {
    throw new Error('MOCK_PAYMENT_WEBHOOK_SECRET not configured')
  }
  return secret
}

function sign(timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', requireSecret()).update(`${timestamp}.${rawBody}`).digest('hex')
}

function safeEqualHex(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(actual)
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}

interface MockWebhookBody {
  id: string
  type: PaymentWebhookEventType
  orderId: string
  providerPaymentId: string | null
  amount: number
  currency: string
  createdAt: string
}

function parseBody(rawBody: string): MockWebhookBody {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }
  const body = parsed as Record<string, unknown>
  const valid =
    typeof body.id === 'string' &&
    body.id.length > 0 &&
    (body.type === 'payment.captured' || body.type === 'payment.failed') &&
    typeof body.orderId === 'string' &&
    body.orderId.length > 0 &&
    (body.providerPaymentId === null || typeof body.providerPaymentId === 'string') &&
    typeof body.amount === 'number' &&
    Number.isInteger(body.amount) &&
    body.amount >= 0 &&
    typeof body.currency === 'string' &&
    typeof body.createdAt === 'string' &&
    !Number.isNaN(Date.parse(body.createdAt))
  if (!valid) {
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }
  if (body.type === 'payment.captured' && !body.providerPaymentId) {
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }
  return body as unknown as MockWebhookBody
}

export const mockPaymentsAdapter: PaymentsAdapter = {
  provider: MOCK_PROVIDER,

  async createOrder({ registrationId }: CreateOrderInput): Promise<PaymentOrder> {
    return { orderId: `mock_order_${registrationId}_${Date.now()}` }
  },

  async verifyAndParseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent | null> {
    const signature = headers.get(MOCK_SIGNATURE_HEADER) ?? ''
    const timestamp = headers.get(MOCK_TIMESTAMP_HEADER) ?? ''

    // The timestamp is part of the signed material, so a missing or
    // non-numeric one can never verify.
    if (!signature || !/^\d{1,12}$/.test(timestamp)) {
      throw new WebhookVerificationError('INVALID_SIGNATURE')
    }
    if (!safeEqualHex(sign(timestamp, rawBody), signature)) {
      throw new WebhookVerificationError('INVALID_SIGNATURE')
    }

    const body = parseBody(rawBody)
    return {
      eventId: body.id,
      providerEventType: body.type,
      type: body.type,
      providerOrderId: body.orderId,
      providerPaymentId: body.providerPaymentId,
      amount: body.amount,
      currency: body.currency,
      occurredAt: new Date(body.createdAt),
      signedAt: new Date(Number(timestamp) * 1000),
    }
  },
}

export interface SimulatedWebhook {
  rawBody: string
  headers: Headers
}

export interface SimulateOptions {
  eventId?: string
  providerPaymentId?: string
  /** Overrides the charged amount/currency (tests: amount mismatch). */
  amount?: number
  currency?: string
  /** Overrides the signed delivery time (tests: replay window). */
  signedAt?: Date
}

/**
 * Server-side-only helper for the mock checkout: builds and signs a
 * provider-shaped webhook for `order` exactly as the provider would send it,
 * so the result goes through the same `processPaymentWebhook` path as a real
 * delivery — without the HMAC secret ever reaching the browser.
 */
export function simulatePaymentOutcome(
  order: { orderId: string; amount: number; currency: string },
  outcome: 'success' | 'failure',
  options: SimulateOptions = {},
): SimulatedWebhook {
  const now = new Date()
  const signedAt = options.signedAt ?? now
  const body: MockWebhookBody = {
    id: options.eventId ?? `evt_mock_${crypto.randomUUID()}`,
    type: outcome === 'success' ? 'payment.captured' : 'payment.failed',
    orderId: order.orderId,
    providerPaymentId:
      options.providerPaymentId ?? (outcome === 'success' ? `mock_pay_${crypto.randomUUID()}` : null),
    amount: options.amount ?? order.amount,
    currency: options.currency ?? order.currency,
    createdAt: now.toISOString(),
  }
  const rawBody = JSON.stringify(body)
  const timestamp = String(Math.floor(signedAt.getTime() / 1000))

  return {
    rawBody,
    headers: new Headers({
      'content-type': 'application/json',
      [MOCK_TIMESTAMP_HEADER]: timestamp,
      [MOCK_SIGNATURE_HEADER]: sign(timestamp, rawBody),
    }),
  }
}
