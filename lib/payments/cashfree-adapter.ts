import crypto from 'node:crypto'
import {
  WebhookVerificationError,
  type CreateOrderInput,
  type PaymentOrder,
  type PaymentWebhookEvent,
  type PaymentsAdapter,
} from './adapter'

/**
 * Cashfree: a live, real-money payment gateway (docs/payments/CASHFREE.md).
 * SDK-driven checkout (Cashfree returns a `payment_session_id`; the browser
 * hands it to Cashfree's own JS SDK, which performs the redirect — there is
 * no plain hosted-checkout URL to redirect to directly), caller-generated
 * order ids, and a REAL webhook signature (`x-webhook-signature` = base64
 * HMAC-SHA256(`x-webhook-timestamp` + rawBody, the client secret) — confirmed
 * against Cashfree's own documentation and sample verification code, 2026-09-24).
 * The signature alone authenticates a webhook delivery — trust does not
 * depend on any additional server-to-server call. `checkOrderPayments` is
 * still exported for the reconciliation job (`lib/jobs/reconcile-cashfree-
 * orders.ts`), which exists only as a missed-delivery safety net, not the
 * primary trust mechanism.
 *
 * Never cache this adapter instance or an HTTP client at module scope
 * (Cloudflare Workers request-scoping rule — see CLAUDE.md's "Cloudflare
 * Hyperdrive bridge" section for the production incident this rule exists to
 * prevent). `createCashfreeAdapter(config)` is cheap and pure; call it fresh
 * from `lib/payments/registry.ts#getPaymentsAdapter` on every invocation,
 * never store its return value in a module-level variable.
 *
 * `CASHFREE_CLIENT_ID`/`CASHFREE_CLIENT_SECRET` must be read exclusively via
 * `getRuntimeEnv` by the caller (registry.ts) — this file never touches
 * `process.env` directly and takes them as plain config values instead, so it
 * stays agnostic to how the caller sourced them.
 */

export const CASHFREE_PROVIDER = 'cashfree'

const CREATE_ORDER_TIMEOUT_MS = 10_000
const CHECK_PAYMENTS_TIMEOUT_MS = 10_000

/**
 * Pinned, VERIFIED live (2026-09-24, a real diagnostic `POST /orders` call
 * against api.cashfree.com returned 200 with this header). Do not bump to an
 * unverified "latest" version string without re-confirming against a live
 * call first.
 */
const CASHFREE_API_VERSION = '2023-08-01'

/** order_id must be alphanumeric/underscore/hyphen, <= 45 chars (Cashfree's Orders API). */
const ORDER_ID_MAX_LENGTH = 45

export interface CashfreeAdapterConfig {
  clientId: string
  clientSecret: string
  env: 'sandbox' | 'production'
  /**
   * MUN Hub's own webhook endpoint, sent as `order_meta.notify_url` on every
   * order — Cashfree's webhook URL is per-order, not a dashboard-level
   * setting, so there is no separate "configure the webhook" step.
   */
  notifyUrl: string
  /**
   * Fallback `return_url` (the browser's post-payment redirect target) used
   * only when a `createOrder` call doesn't supply its own `input.returnUrl`.
   * In normal operation every real call from `lib/actions/registration.ts`
   * supplies a per-registration `returnUrl`; this is a safety-net default
   * (the web app's root) so `createOrder` never sends an empty return target.
   */
  appUrl: string
}

function baseUrl(env: CashfreeAdapterConfig['env']): string {
  return env === 'sandbox' ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `mh_<uuid>` — well under the 45-char limit. No registrationId embedded: `payments.provider_order_id` already links back to it in our own DB. */
function generateOrderId(): string {
  return `mh_${crypto.randomUUID()}`
}

async function cashfreeFetch(
  config: Pick<CashfreeAdapterConfig, 'clientId' | 'clientSecret' | 'env'>,
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetch(`${baseUrl(config.env)}${path}`, {
    method,
    headers: {
      'x-client-id': config.clientId,
      'x-client-secret': config.clientSecret,
      'x-api-version': CASHFREE_API_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    throw new Error(`Cashfree ${method} ${path} failed: ${response.status}`)
  }
  return response.json()
}

interface CashfreeCreateOrderResponse {
  order_id: string
  order_status: string
  payment_session_id: string
}

function isValidCreateOrderResponse(json: unknown): json is CashfreeCreateOrderResponse {
  return (
    isRecord(json) &&
    typeof json.order_id === 'string' &&
    typeof json.payment_session_id === 'string' &&
    typeof json.order_status === 'string'
  )
}

/**
 * `POST /orders`. Amount units (verified 2026-09-24 against a live order):
 * Cashfree's `order_amount` is whole/decimal rupees, sent as-is — matches
 * this codebase's whole-rupee convention (lib/payments/adapter.ts). Requires
 * `input.customer` — Cashfree's `customer_details` (id, name, email, phone)
 * is a required field on order creation (the mock adapter has no such
 * requirement). `customer_id` strips hyphens from our UUID `users.id` since
 * Cashfree's customer_id is alphanumeric-only.
 */
async function createOrder(config: CashfreeAdapterConfig, input: CreateOrderInput): Promise<PaymentOrder> {
  if (!input.customer) {
    throw new Error('Cashfree createOrder requires input.customer (customer_details is a required field)')
  }
  const orderId = generateOrderId()
  if (orderId.length > ORDER_ID_MAX_LENGTH) {
    // Structurally impossible with crypto.randomUUID(), but guard explicitly
    // rather than let a malformed order_id reach Cashfree silently.
    throw new Error(`Generated Cashfree order_id exceeds ${ORDER_ID_MAX_LENGTH} chars: ${orderId}`)
  }

  const json = await cashfreeFetch(
    config,
    '/orders',
    'POST',
    {
      order_id: orderId,
      order_amount: input.amount,
      order_currency: input.currency,
      customer_details: {
        customer_id: input.customer.id.replace(/[^a-zA-Z0-9]/g, ''),
        customer_name: input.customer.name,
        customer_email: input.customer.email,
        customer_phone: input.customer.phone,
      },
      order_meta: {
        return_url: input.returnUrl ?? config.appUrl,
        notify_url: config.notifyUrl,
      },
    },
    CREATE_ORDER_TIMEOUT_MS,
  )

  if (!isValidCreateOrderResponse(json)) {
    throw new Error('Cashfree create-order returned an unexpected response shape')
  }

  // The generated order_id is authoritative regardless of whatever
  // `order_id` echoes back (real API does echo it, but a caller-generated id
  // should never trust a provider echo over its own record).
  return { orderId, checkoutSessionId: json.payment_session_id }
}

interface CashfreeWebhookPayload {
  type: string
  event_time?: string
  data: {
    order: { order_id: string; order_amount?: number; order_currency?: string }
    payment: {
      cf_payment_id: string
      payment_status: string
      payment_amount: number
      payment_currency: string
      payment_time?: string
    }
  }
}

/** Maps a Cashfree webhook `type` to the normalized event type, or null for anything this system doesn't act on. */
function toEventType(type: string): 'payment.captured' | 'payment.failed' | null {
  if (type === 'PAYMENT_SUCCESS_WEBHOOK') return 'payment.captured'
  // A dropped/abandoned checkout releases the seat exactly like an explicit
  // failure — no separate state needed for it.
  if (type === 'PAYMENT_FAILED_WEBHOOK' || type === 'PAYMENT_USER_DROPPED_WEBHOOK') return 'payment.failed'
  return null
}

function isValidWebhookPayload(json: unknown): json is CashfreeWebhookPayload {
  if (!isRecord(json) || typeof json.type !== 'string' || !isRecord(json.data)) return false
  const { order, payment } = json.data as Record<string, unknown>
  if (!isRecord(order) || typeof order.order_id !== 'string') return false
  if (!isRecord(payment)) return false
  return (
    typeof payment.cf_payment_id === 'string' &&
    typeof payment.payment_status === 'string' &&
    typeof payment.payment_amount === 'number' &&
    typeof payment.payment_currency === 'string'
  )
}

function normalizeWebhookPayload(payload: CashfreeWebhookPayload, signedAt: Date | null): PaymentWebhookEvent | null {
  const type = toEventType(payload.type)
  if (type === null) return null

  const { order, payment } = payload.data
  return {
    // Stable per payment ATTEMPT (present on both success and failure per
    // Cashfree's own documented payload samples) — a distinct id per attempt
    // is exactly what the (provider, eventId) dedupe needs.
    eventId: payment.cf_payment_id,
    providerEventType: payload.type,
    type,
    providerOrderId: order.order_id,
    providerPaymentId: payment.cf_payment_id,
    amount: payment.payment_amount,
    currency: payment.payment_currency,
    occurredAt: payment.payment_time ? new Date(payment.payment_time) : new Date(),
    // Real signed delivery timestamp — the processor's 5-minute replay
    // window is a real defense here.
    signedAt,
  }
}

/**
 * `GET /orders/{orderId}/payments` — an array of payment attempts for that
 * order (verified 2026-09-24 against a live order: `[]` for an unpaid one).
 * Picks the most decisive attempt: any SUCCESS wins, else the most recent
 * FAILED, else null (still pending) — normalized the same way the webhook
 * path does, minus a signed timestamp (there is none for a polled read, so
 * the replay-window check is skipped for this path exactly as it already is
 * for any event with `signedAt: null`).
 *
 * Exported so the reconciliation job (`lib/jobs/reconcile-cashfree-orders.ts`)
 * can call it directly with a plain order id.
 */
export async function checkOrderPayments(
  orderId: string,
  config: Pick<CashfreeAdapterConfig, 'clientId' | 'clientSecret' | 'env'>,
): Promise<PaymentWebhookEvent | null> {
  let json: unknown
  try {
    json = await cashfreeFetch(config, `/orders/${encodeURIComponent(orderId)}/payments`, 'GET', undefined, CHECK_PAYMENTS_TIMEOUT_MS)
  } catch (error) {
    console.error(`[payments] Cashfree get-payments failed for order_id=${orderId}`, error)
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }

  if (!Array.isArray(json)) {
    console.error(`[payments] Cashfree get-payments returned an unexpected shape for order_id=${orderId}`)
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }

  const attempts = json.filter(
    (item): item is CashfreeWebhookPayload['data']['payment'] =>
      isRecord(item) &&
      typeof item.cf_payment_id === 'string' &&
      typeof item.payment_status === 'string' &&
      typeof item.payment_amount === 'number' &&
      typeof item.payment_currency === 'string',
  )

  const success = attempts.find((a) => a.payment_status === 'SUCCESS')
  const chosen = success ?? [...attempts].reverse().find((a) => a.payment_status === 'FAILED')
  if (!chosen) return null // still pending, or no decisive attempt yet

  return normalizeWebhookPayload(
    {
      type: chosen.payment_status === 'SUCCESS' ? 'PAYMENT_SUCCESS_WEBHOOK' : 'PAYMENT_FAILED_WEBHOOK',
      data: { order: { order_id: orderId }, payment: chosen },
    },
    null,
  )
}

/**
 * Verifies `x-webhook-signature` = base64(HMAC-SHA256(`x-webhook-timestamp` +
 * rawBody, clientSecret)) — Cashfree signs webhooks with the CLIENT SECRET,
 * not a separate webhook secret (confirmed against Cashfree's documentation,
 * 2026-09-24). Uses `crypto.timingSafeEqual` on equal-length buffers, same
 * careful-compare pattern `mock-adapter.ts` already uses.
 */
function verifySignature(rawBody: string, headers: Headers, clientSecret: string): Date {
  const signature = headers.get('x-webhook-signature')
  const timestamp = headers.get('x-webhook-timestamp')
  if (!signature || !timestamp) {
    throw new WebhookVerificationError('INVALID_SIGNATURE', 'Missing webhook signature headers')
  }

  const expected = crypto.createHmac('sha256', clientSecret).update(`${timestamp}${rawBody}`).digest('base64')

  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  const valid =
    expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf)
  if (!valid) {
    throw new WebhookVerificationError('INVALID_SIGNATURE')
  }

  const signedAtMs = Number(timestamp) * 1000
  if (!Number.isFinite(signedAtMs)) {
    throw new WebhookVerificationError('INVALID_PAYLOAD', 'Malformed x-webhook-timestamp')
  }
  return new Date(signedAtMs)
}

export function createCashfreeAdapter(config: CashfreeAdapterConfig): PaymentsAdapter {
  return {
    provider: CASHFREE_PROVIDER,

    createOrder: (input) => createOrder(config, input),

    /**
     * (a) Verifies the signature FIRST — nothing is read from the body until
     *     the signature checks out.
     * (b) Parses and structurally validates the body.
     * (c) Maps PAYMENT_SUCCESS_WEBHOOK/PAYMENT_FAILED_WEBHOOK/
     *     PAYMENT_USER_DROPPED_WEBHOOK to the normalized event; anything
     *     else is ignored (returns null).
     */
    verifyAndParseWebhook: async (rawBody, headers) => {
      const signedAt = verifySignature(rawBody, headers, config.clientSecret)

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        throw new WebhookVerificationError('INVALID_PAYLOAD')
      }
      if (!isValidWebhookPayload(parsed)) {
        throw new WebhookVerificationError('INVALID_PAYLOAD')
      }

      return normalizeWebhookPayload(parsed, signedAt)
    },
  }
}
