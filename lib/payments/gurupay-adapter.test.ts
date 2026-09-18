import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookVerificationError } from './adapter'
import { checkOrderStatus, createGuruPayAdapter, GURUPAY_PROVIDER } from './gurupay-adapter'

/**
 * Every test in this file stubs `fetch` — GuruPay's real API is never
 * called. See docs/payments/SPEC.md §6 ("Test suite accidentally hitting
 * real GuruPay") and §9.
 *
 * Response shapes here are the CONFIRMED REAL ones (GuruPay dashboard,
 * 2026-09-18) — top-level fields, not nested under `data`, and `amount` as a
 * STRING in check-status. This replaced an earlier, wrong guess (nested
 * `data.xxx`, numeric amount) that SPEC.md had assumed before the dashboard
 * was reviewed.
 */

const CONFIG = { apiKey: 'test-gurupay-key', callbackUrl: 'https://www.munhub.in' }
const VALID_PAYMENT_URL = 'https://www.gurupaygateway.com/pay/abc123'

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createGuruPayAdapter', () => {
  it('has the gurupay provider key', () => {
    const adapter = createGuruPayAdapter(CONFIG)
    expect(adapter.provider).toBe(GURUPAY_PROVIDER)
    expect(GURUPAY_PROVIDER).toBe('gurupay')
  })
})

describe('GuruPayAdapter.createOrder', () => {
  it('POSTs the correct request shape and headers, and returns the generated order id + checkoutUrl', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })
      }),
    )

    const adapter = createGuruPayAdapter(CONFIG)
    const order = await adapter.createOrder({ amount: 1613, currency: 'INR', registrationId: 'reg_abc' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://www.gurupaygateway.com/api/create-order')
    expect(calls[0].init.method).toBe('POST')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('X-Guru-Key')).toBe('test-gurupay-key')
    expect(headers.get('content-type')).toMatch(/application\/json/)

    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody.amount).toBe(1613)
    expect(sentBody.order_id).toMatch(/^mh_reg_abc_/)
    expect(sentBody.callback_url).toBe(CONFIG.callbackUrl)

    // Returned orderId is the generated one — create-order's confirmed real
    // response doesn't echo one back at all.
    expect(order.orderId).toBe(sentBody.order_id)
    expect(order.checkoutUrl).toBe(VALID_PAYMENT_URL)
  })

  it('sends a per-registration returnUrl as callback_url, not the adapter default (bug fix: callback_url must never be the webhook route)', async () => {
    const calls: Array<{ init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ init })
        return jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })
      }),
    )
    const adapter = createGuruPayAdapter(CONFIG)
    await adapter.createOrder({
      amount: 100,
      currency: 'INR',
      registrationId: 'reg_x',
      returnUrl: 'https://www.munhub.in/register/some-mun/pay?registrationId=reg_x',
    })

    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody.callback_url).toBe('https://www.munhub.in/register/some-mun/pay?registrationId=reg_x')
    expect(sentBody.callback_url).not.toContain('/webhooks/payments')
  })

  it('falls back to the adapter-level callbackUrl when no returnUrl is supplied, and it is never the webhook route', async () => {
    const calls: Array<{ init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ init })
        return jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })
      }),
    )
    const adapter = createGuruPayAdapter(CONFIG)
    await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })

    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody.callback_url).toBe(CONFIG.callbackUrl)
    expect(sentBody.callback_url).not.toContain('/webhooks/payments')
  })

  it('generates a unique order id per call, even for the same registrationId (retry-safe)', async () => {
    const generatedIds = new Set<string>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { order_id: string }
        generatedIds.add(body.order_id)
        return jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })
      }),
    )

    const adapter = createGuruPayAdapter(CONFIG)
    const first = await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_same' })
    const second = await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_same' })

    expect(first.orderId).not.toBe(second.orderId)
    expect(generatedIds.size).toBe(2)
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'failed', error: 'bad request' }, { status: 400 })))
    const adapter = createGuruPayAdapter(CONFIG)
    await expect(adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })).rejects.toThrow()
  })

  it('throws on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const adapter = createGuruPayAdapter(CONFIG)
    await expect(adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })).rejects.toThrow()
  })

  it('throws on a response missing payment_url (malformed shape)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'success' })))
    const adapter = createGuruPayAdapter(CONFIG)
    await expect(adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })).rejects.toThrow(
      /unexpected response shape/,
    )
  })

  it('sends a request with an abort signal (10s timeout wired)', async () => {
    let sawSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sawSignal = init.signal as AbortSignal
        return jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })
      }),
    )
    const adapter = createGuruPayAdapter(CONFIG)
    await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })
    expect(sawSignal).toBeInstanceOf(AbortSignal)
  })

  describe('payment_url validation (bug fix — reject an untrusted redirect target)', () => {
    it.each([
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a different host', 'https://evil.example.com/pay/abc'],
      ['a non-https scheme', 'http://www.gurupaygateway.com/pay/abc'],
      ['a malformed URL', 'not a url at all'],
    ])('rejects %s', async (_label, paymentUrl) => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'success', payment_url: paymentUrl })))
      const adapter = createGuruPayAdapter(CONFIG)
      await expect(adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })).rejects.toThrow()
    })

    it('accepts the confirmed real host/scheme (https://www.gurupaygateway.com)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })))
      const adapter = createGuruPayAdapter(CONFIG)
      const order = await adapter.createOrder({ amount: 100, currency: 'INR', registrationId: 'reg_x' })
      expect(order.checkoutUrl).toBe(VALID_PAYMENT_URL)
    })
  })
})

describe('GuruPayAdapter.verifyAndParseWebhook', () => {
  function stubCheckStatus(response: { status?: number; body?: unknown; reject?: boolean }) {
    return vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (response.reject) throw new Error('network down')
        return jsonResponse(response.body, { status: response.status ?? 200 })
      }),
    )
  }

  it('maps a success check-status response to a captured event, built entirely from check-status fields (string amount coerced to whole rupees)', async () => {
    stubCheckStatus({
      body: { status: 'success', amount: '1613.00', utr: 'UTR12345', paid_at: '2026-09-18T10:00:00Z' },
    })
    const adapter = createGuruPayAdapter(CONFIG)

    // Forged webhook body: fake amount/status that must be IGNORED in favor
    // of whatever check-status actually returns.
    const forgedBody = JSON.stringify({ order_id: 'mh_reg_1_abc', amount: 1, utr: 'FAKE', status: 'failed' })
    const event = await adapter.verifyAndParseWebhook(forgedBody, new Headers())

    expect(event).toMatchObject({
      type: 'payment.captured',
      providerEventType: 'success',
      // Always the REQUESTED order id, never anything read off the response
      // (the confirmed real check-status shape doesn't echo order_id at all).
      providerOrderId: 'mh_reg_1_abc',
      providerPaymentId: 'UTR12345',
      amount: 1613,
      currency: 'INR',
    })
    expect(event?.eventId).toBe('mh_reg_1_abc:success:UTR12345')
    expect(event?.signedAt).toBeNull()
    expect(event?.occurredAt.toISOString()).toBe(new Date('2026-09-18T10:00:00Z').toISOString())
  })

  it('a forged webhook body with a fake amount/status is ignored — check-status is authoritative', async () => {
    stubCheckStatus({ body: { status: 'success', amount: '5000.00', utr: 'REAL_UTR' } })
    const adapter = createGuruPayAdapter(CONFIG)
    const forgedBody = JSON.stringify({ order_id: 'mh_reg_2_xyz', amount: 1, status: 'success', utr: 'FORGED_UTR' })

    const event = await adapter.verifyAndParseWebhook(forgedBody, new Headers())

    expect(event?.amount).toBe(5000)
    expect(event?.providerPaymentId).toBe('REAL_UTR')
    expect(event?.amount).not.toBe(1)
    expect(event?.providerPaymentId).not.toBe('FORGED_UTR')
  })

  it('maps a failed check-status response to a failed event', async () => {
    stubCheckStatus({ body: { status: 'failed', amount: '100.00', utr: null } })
    const adapter = createGuruPayAdapter(CONFIG)
    const event = await adapter.verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_3' }), new Headers())

    expect(event).toMatchObject({ type: 'payment.failed', providerOrderId: 'mh_reg_3', providerPaymentId: null })
    expect(event?.eventId).toBe('mh_reg_3:failed:none')
  })

  it('returns null for a pending check-status response (authentic, nothing to act on yet)', async () => {
    stubCheckStatus({ body: { status: 'pending', amount: '100.00' } })
    const adapter = createGuruPayAdapter(CONFIG)
    const event = await adapter.verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_4' }), new Headers())
    expect(event).toBeNull()
  })

  it('throws INVALID_PAYLOAD (not INVALID_SIGNATURE) when check-status returns a non-2xx', async () => {
    stubCheckStatus({ status: 500, body: { status: 'failed' } })
    const adapter = createGuruPayAdapter(CONFIG)
    const error = await adapter
      .verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_5' }), new Headers())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('INVALID_PAYLOAD')
  })

  it('throws INVALID_PAYLOAD when check-status is unreachable (network error)', async () => {
    stubCheckStatus({ reject: true })
    const adapter = createGuruPayAdapter(CONFIG)
    const error = await adapter
      .verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_6' }), new Headers())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('INVALID_PAYLOAD')
  })

  it('throws INVALID_PAYLOAD when check-status returns malformed JSON/shape', async () => {
    stubCheckStatus({ body: { status: 'success' /* missing amount */ } })
    const adapter = createGuruPayAdapter(CONFIG)
    const error = await adapter
      .verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_7' }), new Headers())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('INVALID_PAYLOAD')
  })

  it('throws INVALID_PAYLOAD for a malformed webhook body (no order_id) WITHOUT ever calling check-status', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = createGuruPayAdapter(CONFIG)

    for (const badBody of ['not json', JSON.stringify({}), JSON.stringify({ order_id: '' }), JSON.stringify({ order_id: 123 })]) {
      const error = await adapter.verifyAndParseWebhook(badBody, new Headers()).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(WebhookVerificationError)
      expect((error as WebhookVerificationError).reason).toBe('INVALID_PAYLOAD')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to now() for occurredAt when check-status has no paid_at', async () => {
    stubCheckStatus({ body: { status: 'success', amount: '100.00', utr: 'U1' } })
    const adapter = createGuruPayAdapter(CONFIG)
    const before = Date.now()
    const event = await adapter.verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_8' }), new Headers())
    expect(event?.occurredAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('throws when check-status returns a non-numeric amount', async () => {
    stubCheckStatus({ body: { status: 'success', amount: 'not-a-number', utr: 'U1' } })
    const adapter = createGuruPayAdapter(CONFIG)
    const error = await adapter
      .verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_reg_9' }), new Headers())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('checkOrderStatus (exported helper reused by the reconciliation job)', () => {
  it('calls POST /api/check-status with the X-Guru-Key header and order_id body, using the REQUESTED order id as providerOrderId', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        // Confirmed real shape: no order_id echoed back at all.
        return jsonResponse({ status: 'success', amount: '100.00', utr: 'U1' })
      }),
    )

    const event = await checkOrderStatus('mh_x', CONFIG)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://www.gurupaygateway.com/api/check-status')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('X-Guru-Key')).toBe('test-gurupay-key')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ order_id: 'mh_x' })
    expect(event).toMatchObject({ type: 'payment.captured', providerOrderId: 'mh_x', amount: 100 })
  })

  it('returns null for a pending order, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'pending', amount: '1.00' })))
    expect(await checkOrderStatus('mh_y', CONFIG)).toBeNull()
  })

  it('throws WebhookVerificationError on failure, same as verifyAndParseWebhook', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 502 })))
    await expect(checkOrderStatus('mh_z', CONFIG)).rejects.toBeInstanceOf(WebhookVerificationError)
  })
})

describe('amount unit handling (confirmed real shape: whole rupees, string-typed in check-status)', () => {
  it('sends amount as-is (whole rupees, numeric) to create-order, no ×100/÷100 conversion', async () => {
    let sentAmount: number | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { amount: number }
        sentAmount = body.amount
        return jsonResponse({ status: 'success', payment_url: VALID_PAYMENT_URL })
      }),
    )
    const adapter = createGuruPayAdapter(CONFIG)
    await adapter.createOrder({ amount: 1499, currency: 'INR', registrationId: 'reg_unit' })

    expect(sentAmount).toBe(1499)
  })

  it('coerces check-status\'s string amount ("1613.00") to the integer 1613, matching payments.amount units', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'success', amount: '1613.00', utr: 'U' })))
    const adapter = createGuruPayAdapter(CONFIG)
    const event = await adapter.verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_unit' }), new Headers())
    expect(event?.amount).toBe(1613)
    expect(Number.isInteger(event?.amount)).toBe(true)
  })

  it('rounds a fractional-paise string amount to the nearest whole rupee', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'success', amount: '99.5', utr: 'U' })))
    const adapter = createGuruPayAdapter(CONFIG)
    const event = await adapter.verifyAndParseWebhook(JSON.stringify({ order_id: 'mh_round' }), new Headers())
    expect(event?.amount).toBe(100)
  })
})
