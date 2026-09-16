import crypto from 'node:crypto'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { PaymentOrder, PaymentsAdapter } from './adapter'

// getRuntimeEnv (not `process.env` directly) — Cloudflare Workers never
// populate custom vars/secrets into `process.env`, so a direct read here
// would silently see this as unset on every real webhook in production even
// though it's correctly configured as a Workers secret. See lib/runtime-env.ts.
function getWebhookSecret(): string {
  const secret = getRuntimeEnv('MOCK_PAYMENT_WEBHOOK_SECRET')
  if (!secret) {
    throw new Error('MOCK_PAYMENT_WEBHOOK_SECRET not configured')
  }
  return secret
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getWebhookSecret()).update(payload).digest('hex')
}

export const mockPaymentsAdapter: PaymentsAdapter = {
  async createOrder(_amount: number, _currency: string, registrationId: string): Promise<PaymentOrder> {
    return { orderId: `mock_order_${registrationId}_${Date.now()}` }
  },

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = sign(payload)

    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(signature)

    if (expectedBuf.length !== actualBuf.length) {
      return false
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf)
  },
}

/**
 * Server-side-only helper for a mock checkout page: signs a fake payment
 * outcome (success/failure) so the resulting webhook payload+signature can
 * be posted to `POST /api/webhooks/payments` exactly as a real provider
 * would — without the HMAC secret ever reaching the browser.
 */
export async function simulatePaymentOutcome(
  orderId: string,
  outcome: 'success' | 'failure',
): Promise<{ signature: string; payload: string }> {
  const payload = JSON.stringify({
    orderId,
    status: outcome === 'success' ? 'paid' : 'failed',
    providerPaymentId: outcome === 'success' ? `mock_pay_${orderId}` : undefined,
  })

  return { payload, signature: sign(payload) }
}
