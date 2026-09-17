import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { WebhookVerificationError } from './adapter'
import {
  MOCK_SIGNATURE_HEADER,
  MOCK_TIMESTAMP_HEADER,
  mockPaymentsAdapter,
  simulatePaymentOutcome,
} from './mock-adapter'

const ORDER = { orderId: 'mock_order_1', amount: 2500, currency: 'INR' }

function signedHeaders(rawBody: string, timestamp: string, secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET!) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return new Headers({ [MOCK_TIMESTAMP_HEADER]: timestamp, [MOCK_SIGNATURE_HEADER]: signature })
}

async function verificationFailure(rawBody: string, headers: Headers) {
  const error = await mockPaymentsAdapter.verifyAndParseWebhook(rawBody, headers).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(WebhookVerificationError)
  return (error as WebhookVerificationError).reason
}

describe('mockPaymentsAdapter', () => {
  it('creates an order with a unique orderId', async () => {
    const order = await mockPaymentsAdapter.createOrder({ amount: 2500, currency: 'INR', registrationId: 'reg_123' })
    expect(order.orderId).toMatch(/^mock_order_reg_123_/)
  })

  it('verifies and normalizes a simulated capture', async () => {
    const { rawBody, headers } = simulatePaymentOutcome(ORDER, 'success')
    const event = await mockPaymentsAdapter.verifyAndParseWebhook(rawBody, headers)
    expect(event).toMatchObject({
      type: 'payment.captured',
      providerEventType: 'payment.captured',
      providerOrderId: 'mock_order_1',
      amount: 2500,
      currency: 'INR',
    })
    expect(event?.eventId).toMatch(/^evt_mock_/)
    expect(event?.providerPaymentId).toMatch(/^mock_pay_/)
    expect(Math.abs(event!.signedAt!.getTime() - Date.now())).toBeLessThan(5_000)
  })

  it('verifies a simulated failure with no payment id', async () => {
    const { rawBody, headers } = simulatePaymentOutcome(ORDER, 'failure')
    const event = await mockPaymentsAdapter.verifyAndParseWebhook(rawBody, headers)
    expect(event?.type).toBe('payment.failed')
    expect(event?.providerPaymentId).toBeNull()
  })

  it('carries a signed timestamp override through to signedAt', async () => {
    const signedAt = new Date('2026-01-01T00:00:00Z')
    const { rawBody, headers } = simulatePaymentOutcome(ORDER, 'success', { signedAt })
    const event = await mockPaymentsAdapter.verifyAndParseWebhook(rawBody, headers)
    expect(event?.signedAt?.toISOString()).toBe(signedAt.toISOString())
  })

  it('rejects a tampered body', async () => {
    const { rawBody, headers } = simulatePaymentOutcome(ORDER, 'success')
    const tampered = rawBody.replace('"amount":2500', '"amount":1')
    expect(await verificationFailure(tampered, headers)).toBe('INVALID_SIGNATURE')
  })

  it('rejects a changed timestamp (it is part of the signed material)', async () => {
    const { rawBody, headers } = simulatePaymentOutcome(ORDER, 'success')
    headers.set(MOCK_TIMESTAMP_HEADER, String(Number(headers.get(MOCK_TIMESTAMP_HEADER)) + 1))
    expect(await verificationFailure(rawBody, headers)).toBe('INVALID_SIGNATURE')
  })

  it('rejects a missing timestamp, a missing signature and a short signature without throwing oddly', async () => {
    const { rawBody } = simulatePaymentOutcome(ORDER, 'success')
    expect(await verificationFailure(rawBody, new Headers({ [MOCK_SIGNATURE_HEADER]: 'abc' }))).toBe('INVALID_SIGNATURE')
    expect(await verificationFailure(rawBody, new Headers({ [MOCK_TIMESTAMP_HEADER]: '123' }))).toBe('INVALID_SIGNATURE')
    expect(
      await verificationFailure(rawBody, new Headers({ [MOCK_TIMESTAMP_HEADER]: '123', [MOCK_SIGNATURE_HEADER]: 'short' })),
    ).toBe('INVALID_SIGNATURE')
  })

  it('rejects a signature made with a different secret', async () => {
    const { rawBody } = simulatePaymentOutcome(ORDER, 'success')
    const headers = signedHeaders(rawBody, String(Math.floor(Date.now() / 1000)), 'some-other-secret')
    expect(await verificationFailure(rawBody, headers)).toBe('INVALID_SIGNATURE')
  })

  it('rejects an authentic but malformed payload as INVALID_PAYLOAD', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    for (const body of [
      'not json',
      JSON.stringify({ orderId: 'mock_order_1', status: 'paid' }),
      JSON.stringify({ id: 'evt', type: 'payment.captured', orderId: 'o', providerPaymentId: null, amount: 1, currency: 'INR', createdAt: new Date().toISOString() }),
      JSON.stringify({ id: 'evt', type: 'payment.captured', orderId: 'o', providerPaymentId: 'p', amount: 1.5, currency: 'INR', createdAt: new Date().toISOString() }),
    ]) {
      expect(await verificationFailure(body, signedHeaders(body, timestamp))).toBe('INVALID_PAYLOAD')
    }
  })
})
