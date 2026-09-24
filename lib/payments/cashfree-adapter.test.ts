import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookVerificationError } from './adapter'
import { CASHFREE_PROVIDER, checkOrderPayments, createCashfreeAdapter } from './cashfree-adapter'

/**
 * Every test in this file stubs `fetch` — Cashfree's real API is never
 * called. Request/response shapes here are VERIFIED against the real live
 * API by a direct diagnostic call (2026-09-24, `POST /pg/orders` against
 * api.cashfree.com — see docs/payments/CASHFREE.md).
 */

const CONFIG = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  env: 'production' as const,
  notifyUrl: 'https://api.munhub.in/webhooks/payments',
  appUrl: 'https://www.munhub.in',
}

const CUSTOMER = { id: 'user-uuid-1234-5678', name: 'Test Delegate', email: 'delegate@example.com', phone: '9999999999' }

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

function createOrderBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    order_id: 'echoed_order_id',
    order_status: 'ACTIVE',
    payment_session_id: 'session_abc123',
    ...overrides,
  }
}

function signWebhook(body: string, timestamp: string, secret = CONFIG.clientSecret) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}${body}`).digest('base64')
  return new Headers({ 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp })
}

function webhookBody(
  type: 'PAYMENT_SUCCESS_WEBHOOK' | 'PAYMENT_FAILED_WEBHOOK' | 'PAYMENT_USER_DROPPED_WEBHOOK',
  overrides: Partial<Record<string, unknown>> = {},
) {
  return JSON.stringify({
    type,
    event_time: '2026-09-24T13:55:05+05:30',
    data: {
      order: { order_id: 'order_abc', order_amount: 1613, order_currency: 'INR' },
      payment: {
        cf_payment_id: 'cf_pay_1',
        payment_status: type === 'PAYMENT_SUCCESS_WEBHOOK' ? 'SUCCESS' : 'FAILED',
        payment_amount: 1613,
        payment_currency: 'INR',
        payment_time: '2026-09-24T13:55:22+05:30',
      },
    },
    ...overrides,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createCashfreeAdapter', () => {
  it('has the cashfree provider key', () => {
    const adapter = createCashfreeAdapter(CONFIG)
    expect(adapter.provider).toBe(CASHFREE_PROVIDER)
    expect(CASHFREE_PROVIDER).toBe('cashfree')
  })
})

describe('CashfreeAdapter.createOrder', () => {
  it('POSTs the correct request shape and headers, and returns the generated order id + checkoutSessionId', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return jsonResponse(createOrderBody())
      }),
    )

    const adapter = createCashfreeAdapter(CONFIG)
    const order = await adapter.createOrder({
      amount: 1613,
      currency: 'INR',
      registrationId: 'reg_abc',
      returnUrl: 'https://www.munhub.in/register/some-mun/pay?registrationId=reg_abc',
      customer: CUSTOMER,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.cashfree.com/pg/orders')
    expect(calls[0].init.method).toBe('POST')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('x-client-id')).toBe('test-client-id')
    expect(headers.get('x-client-secret')).toBe('test-client-secret')
    expect(headers.get('x-api-version')).toBe('2023-08-01')

    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody.order_amount).toBe(1613)
    expect(sentBody.order_currency).toBe('INR')
    expect(sentBody.order_id).toMatch(/^mh_/)
    expect(sentBody.order_id.length).toBeLessThanOrEqual(45)
    // customer_id strips non-alphanumeric characters (hyphens) from the UUID.
    expect(sentBody.customer_details).toEqual({
      customer_id: 'useruuid12345678',
      customer_name: CUSTOMER.name,
      customer_email: CUSTOMER.email,
      customer_phone: CUSTOMER.phone,
    })
    expect(sentBody.order_meta.return_url).toBe('https://www.munhub.in/register/some-mun/pay?registrationId=reg_abc')
    expect(sentBody.order_meta.notify_url).toBe(CONFIG.notifyUrl)

    // Returned orderId is always the generated one, even though the real API
    // does echo one back — never trusted over our own record.
    expect(order.orderId).toBe(sentBody.order_id)
    expect(order.orderId).not.toBe('echoed_order_id')
    expect(order.checkoutSessionId).toBe('session_abc123')
    expect(order.checkoutUrl).toBeUndefined()
  })

  it('falls back to config.appUrl when no returnUrl is supplied', async () => {
    const calls: Array<{ init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ init })
        return jsonResponse(createOrderBody())
      }),
    )
    const adapter = createCashfreeAdapter(CONFIG)
    await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x', customer: CUSTOMER })

    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody.order_meta.return_url).toBe(CONFIG.appUrl)
  })

  it('generates a unique order id per call, well under the 45-char limit', async () => {
    const generatedIds = new Set<string>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { order_id: string }
        generatedIds.add(body.order_id)
        return jsonResponse(createOrderBody())
      }),
    )

    const adapter = createCashfreeAdapter(CONFIG)
    const first = await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_same', customer: CUSTOMER })
    const second = await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_same', customer: CUSTOMER })

    expect(first.orderId).not.toBe(second.orderId)
    expect(generatedIds.size).toBe(2)
    for (const id of generatedIds) expect(id.length).toBeLessThanOrEqual(45)
  })

  it('throws when input.customer is missing (Cashfree requires customer_details)', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    await expect(adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })).rejects.toThrow(
      /requires input.customer/,
    )
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'invalid request' }, { status: 400 })))
    const adapter = createCashfreeAdapter(CONFIG)
    await expect(
      adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x', customer: CUSTOMER }),
    ).rejects.toThrow()
  })

  it('throws on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const adapter = createCashfreeAdapter(CONFIG)
    await expect(
      adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x', customer: CUSTOMER }),
    ).rejects.toThrow()
  })

  it('throws on a response missing payment_session_id (malformed shape)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ order_id: 'x', order_status: 'ACTIVE' })))
    const adapter = createCashfreeAdapter(CONFIG)
    await expect(
      adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x', customer: CUSTOMER }),
    ).rejects.toThrow(/unexpected response shape/)
  })
})

describe('CashfreeAdapter.verifyAndParseWebhook', () => {
  it('accepts a validly signed PAYMENT_SUCCESS_WEBHOOK and normalizes it, with a real signedAt', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = webhookBody('PAYMENT_SUCCESS_WEBHOOK')
    const event = await adapter.verifyAndParseWebhook(body, signWebhook(body, timestamp))

    expect(event).toMatchObject({
      type: 'payment.captured',
      providerEventType: 'PAYMENT_SUCCESS_WEBHOOK',
      providerOrderId: 'order_abc',
      providerPaymentId: 'cf_pay_1',
      eventId: 'cf_pay_1',
      amount: 1613,
      currency: 'INR',
    })
    expect(event?.signedAt?.getTime()).toBe(Number(timestamp) * 1000)
  })

  it('maps PAYMENT_FAILED_WEBHOOK and PAYMENT_USER_DROPPED_WEBHOOK to payment.failed', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    for (const type of ['PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK'] as const) {
      const timestamp = String(Math.floor(Date.now() / 1000))
      const body = webhookBody(type)
      const event = await adapter.verifyAndParseWebhook(body, signWebhook(body, timestamp))
      expect(event?.type).toBe('payment.failed')
      expect(event?.providerEventType).toBe(type)
    }
  })

  it('ignores an unrecognized webhook type (returns null, not a throw)', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = webhookBody('PAYMENT_SUCCESS_WEBHOOK', { type: 'PAYMENT_LINK_EVENT' })
    const event = await adapter.verifyAndParseWebhook(body, signWebhook(body, timestamp))
    expect(event).toBeNull()
  })

  it('rejects a tampered body (INVALID_SIGNATURE)', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = webhookBody('PAYMENT_SUCCESS_WEBHOOK')
    const headers = signWebhook(body, timestamp)
    const tampered = body.replace('"payment_amount":1613', '"payment_amount":1')
    const error = await adapter.verifyAndParseWebhook(tampered, headers).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('INVALID_SIGNATURE')
  })

  it('rejects a forged webhook body signed with a different secret', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = webhookBody('PAYMENT_SUCCESS_WEBHOOK')
    const error = await adapter
      .verifyAndParseWebhook(body, signWebhook(body, timestamp, 'wrong-secret'))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('INVALID_SIGNATURE')
  })

  it('rejects missing signature/timestamp headers', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    const body = webhookBody('PAYMENT_SUCCESS_WEBHOOK')
    const error = await adapter.verifyAndParseWebhook(body, new Headers()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('INVALID_SIGNATURE')
  })

  it('rejects an authentic but structurally malformed payload as INVALID_PAYLOAD', async () => {
    const adapter = createCashfreeAdapter(CONFIG)
    const timestamp = String(Math.floor(Date.now() / 1000))
    for (const body of [
      'not json',
      JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK' }),
      JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: {}, payment: {} } }),
    ]) {
      const error = await adapter.verifyAndParseWebhook(body, signWebhook(body, timestamp)).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(WebhookVerificationError)
      expect((error as WebhookVerificationError).reason).toBe('INVALID_PAYLOAD')
    }
  })
})

describe('checkOrderPayments', () => {
  it('returns null when the attempt list is empty (still pending)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    const event = await checkOrderPayments('order_x', CONFIG)
    expect(event).toBeNull()
  })

  it('prefers a SUCCESS attempt over any FAILED ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          { cf_payment_id: 'p1', payment_status: 'FAILED', payment_amount: 1613, payment_currency: 'INR' },
          { cf_payment_id: 'p2', payment_status: 'SUCCESS', payment_amount: 1613, payment_currency: 'INR' },
        ]),
      ),
    )
    const event = await checkOrderPayments('order_x', CONFIG)
    expect(event?.type).toBe('payment.captured')
    expect(event?.providerPaymentId).toBe('p2')
  })

  it('falls back to the most recent FAILED attempt when there is no SUCCESS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          { cf_payment_id: 'p1', payment_status: 'FAILED', payment_amount: 1613, payment_currency: 'INR' },
          { cf_payment_id: 'p2', payment_status: 'FAILED', payment_amount: 1613, payment_currency: 'INR' },
        ]),
      ),
    )
    const event = await checkOrderPayments('order_x', CONFIG)
    expect(event?.type).toBe('payment.failed')
    expect(event?.providerPaymentId).toBe('p2')
  })

  it('throws WebhookVerificationError(INVALID_PAYLOAD) on a network/shape failure, never a bare error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(checkOrderPayments('order_x', CONFIG)).rejects.toBeInstanceOf(WebhookVerificationError)
  })
})
