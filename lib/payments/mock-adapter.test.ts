import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mockPaymentsAdapter, simulatePaymentOutcome } from './mock-adapter'

describe('mockPaymentsAdapter', () => {
  it('creates an order with a unique orderId', async () => {
    const order = await mockPaymentsAdapter.createOrder(2500, 'INR', 'reg_123')
    expect(order.orderId).toMatch(/^mock_order_/)
  })

  it('verifies a correctly signed webhook payload', () => {
    const payload = JSON.stringify({ orderId: 'mock_order_1', status: 'paid' })
    const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET!
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, signature)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const payload = JSON.stringify({ orderId: 'mock_order_1', status: 'paid' })
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, 'bad-signature')).toBe(false)
  })

  it('rejects a signature of differing length without throwing', () => {
    const payload = JSON.stringify({ orderId: 'mock_order_1', status: 'paid' })
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, 'short')).toBe(false)
  })

  it('refunds using the idempotency key so a retried call is recognizable as the same attempt', async () => {
    const result = await mockPaymentsAdapter.refund('pay_123', 5000, 'refund-request-abc')
    expect(result.providerRefundId).toBe('mock_refund_refund-request-abc')

    // Same idempotency key -> same providerRefundId, exactly what a real
    // provider's idempotency-key support guarantees on a retried call.
    const retried = await mockPaymentsAdapter.refund('pay_123', 5000, 'refund-request-abc')
    expect(retried.providerRefundId).toBe(result.providerRefundId)
  })
})

describe('simulatePaymentOutcome', () => {
  it('produces a payload+signature that verifies as authentic for success', async () => {
    const { payload, signature } = await simulatePaymentOutcome('mock_order_abc', 'success')
    expect(JSON.parse(payload).status).toBe('paid')
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, signature)).toBe(true)
  })

  it('produces a payload+signature that verifies as authentic for failure', async () => {
    const { payload, signature } = await simulatePaymentOutcome('mock_order_abc', 'failure')
    expect(JSON.parse(payload).status).toBe('failed')
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, signature)).toBe(true)
  })
})
