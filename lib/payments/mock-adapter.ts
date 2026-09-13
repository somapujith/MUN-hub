import crypto from 'node:crypto'
import type { PaymentOrder, PaymentsAdapter, RefundResult } from './adapter'

function getWebhookSecret(): string {
  const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET
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

  async refund(_providerPaymentId: string, _amount: number, idempotencyKey: string): Promise<RefundResult> {
    // Mock provider — refunds "succeed" immediately with a fake id, same
    // fire-and-forget shape as createOrder. A real Razorpay adapter would
    // call the provider's refund API here and could fail/throw. Callers
    // (lib/lifecycle/refund.ts) call this OUTSIDE any DB transaction as part
    // of a two-phase commit: the refund_requests row is durably marked
    // PROCESSING (its own committed transaction) before this is ever
    // called, specifically so a failure *after* this call succeeds can
    // never silently reset the row to a freely-re-approvable state. The
    // mock derives the fake providerRefundId from the idempotency key so a
    // retried call with the same key is at least recognizable as the same
    // logical attempt, mirroring what a real provider's idempotency-key
    // support guarantees server-side.
    return { providerRefundId: `mock_refund_${idempotencyKey}` }
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
