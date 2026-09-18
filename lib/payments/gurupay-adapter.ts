import crypto from 'node:crypto'
import {
  WebhookVerificationError,
  type CreateOrderInput,
  type PaymentOrder,
  type PaymentWebhookEvent,
  type PaymentsAdapter,
} from './adapter'

/**
 * GuruPay: a live, real-money payment gateway (docs/payments/SPEC.md).
 * Redirect-based checkout (GuruPay returns a `payment_url` to send the
 * browser to), caller-generated order ids, and NO webhook signature — trust
 * comes entirely from a synchronous server-to-server `check-status` call,
 * folded into `verifyAndParseWebhook` (see that function's doc comment) and
 * reused by the reconciliation job (`lib/jobs/reconcile-gurupay-orders.ts`)
 * via the exported `checkOrderStatus`.
 *
 * Never cache this adapter instance or an HTTP client at module scope
 * (Cloudflare Workers request-scoping rule — see CLAUDE.md's "Cloudflare
 * Hyperdrive bridge" section for the production incident this rule exists
 * to prevent). `createGuruPayAdapter(config)` is cheap and pure; call it
 * fresh from `lib/payments/registry.ts#getPaymentsAdapter` on every
 * invocation, never store its return value in a module-level variable.
 *
 * `GURUPAY_API_KEY` must be read exclusively via `getRuntimeEnv` by the
 * caller (registry.ts) — this file never touches `process.env` directly and
 * takes the key as a plain config value instead, so it stays agnostic to
 * how the caller sourced it.
 */

export const GURUPAY_PROVIDER = 'gurupay'

const CREATE_ORDER_TIMEOUT_MS = 10_000
const CHECK_STATUS_TIMEOUT_MS = 10_000

// Confirmed real API base URL (GuruPay dashboard, 2026-09-18):
// `api.gurupaygateway.com` does not resolve in DNS at all — the real API and
// the hosted checkout page both live under `www.gurupaygateway.com`
// (`POST https://www.gurupaygateway.com/api/create-order`,
// `POST https://www.gurupaygateway.com/api/check-status`, and the returned
// `payment_url` is `https://www.gurupaygateway.com/pay/...`). Also the
// confirmed CSP/security-header allowlist domain — see web/public/_headers
// and web/vercel.json.
const GURUPAY_API_BASE_URL = 'https://www.gurupaygateway.com'
/** The exact host `payment_url` must be on — see `assertValidPaymentUrl` below. */
const GURUPAY_CHECKOUT_HOST = 'www.gurupaygateway.com'

export interface GuruPayAdapterConfig {
  apiKey: string
  /**
   * Fallback `callback_url` (GuruPay's browser-redirect-after-payment
   * target — NOT the webhook endpoint, which GuruPay's own dashboard
   * configures separately and which is never passed in any API request,
   * confirmed 2026-09-18) used only when a `createOrder` call doesn't supply
   * its own `input.returnUrl`. In normal operation every real call from
   * `lib/actions/registration.ts` supplies a per-registration `returnUrl`
   * (e.g. `${APP_URL}/register/:slug/pay?registrationId=...`); this is a
   * safety-net default (the web app's root) so `createOrder` never
   * accidentally sends GuruPay's own webhook route as the browser redirect.
   */
  callbackUrl: string
}

type GuruPayPaymentStatus = 'success' | 'pending' | 'failed'

/**
 * `POST /api/create-order` response — VERIFIED against the real live API by
 * direct diagnostic call (2026-09-18, a real ₹100 order:
 * `{"status":"success","message":"Order created successfully","data":{"payment_url":"https://www.gurupaygateway.com/pay/...","order_id":"...","token":"...","amount":100,"currency":"INR","customer_name":"...","expires_at":"...","created_at":"..."}}`).
 * This SUPERSEDES an earlier, WRONG assumption (claimed top-level fields,
 * never actually verified against a live call) that shipped to production
 * and caused every real order to fail — see git history 2026-09-18. Fields
 * are nested under `data`; the envelope's own `status`/`message` only say
 * whether the API call itself succeeded, not the payment outcome.
 */
interface GuruPayCreateOrderResponse {
  status: string
  data: {
    payment_url: string
    order_id?: string
  }
}

/**
 * `POST /api/check-status` response — VERIFIED against the real live API by
 * direct diagnostic call (2026-09-18):
 * `{"status":"success","data":{"order_id":"...","amount":100,"currency":"INR","payment_status":"pending","customer_name":"...","customer_mobile":null,"utr":null,"payment_method":"UPI","provider":"paytm","gateway_txn_id":null,"paid_at":null,"payment_url":"...","callback_url":"...","expires_at":"...","created_at":"..."}}`.
 * This SUPERSEDES an earlier, wrong, never-actually-verified assumption
 * (top-level fields, string amount, a `status` field carrying the payment
 * outcome) — see the create-order doc comment above for why that happened.
 * The envelope's `status` is "success" whenever the check-status CALL itself
 * worked — it says nothing about the payment. The actual payment outcome is
 * `data.payment_status`. `amount` is a number, not a string, in the real
 * response; `parseWholeRupeeAmount` below still accepts either defensively.
 */
interface GuruPayCheckStatusResponse {
  order_id?: string
  amount: string | number
  currency?: string
  payment_status: GuruPayPaymentStatus
  utr?: string | null
  paid_at?: string | null
}

/** The full check-status envelope — see `GuruPayCheckStatusResponse`'s doc comment. */
interface GuruPayCheckStatusEnvelope {
  status: string
  data: GuruPayCheckStatusResponse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * `mh_<registrationId>_<uuid>` — unique per ATTEMPT, not per registration
 * (docs/payments/SPEC.md §4.4.1): a failed `createOrder` call followed by a
 * retry with the same registration must not collide on GuruPay's side.
 * `crypto.randomUUID()` (not `Date.now()`, which `mock-adapter.ts` uses) so
 * two calls in the same millisecond under retry still get distinct ids.
 */
function generateOrderId(registrationId: string): string {
  return `mh_${registrationId}_${crypto.randomUUID()}`
}

async function guruPayFetch(path: string, apiKey: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await fetch(`${GURUPAY_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'X-Guru-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`GuruPay ${path} failed: ${response.status}`)
  }
  return response.json()
}

/**
 * Coerces GuruPay's `amount` (a JSON number in the real, verified
 * check-status response, e.g. `100` — accepts a string defensively too, in
 * case a future response ever sends one) to a whole-rupee integer, matching
 * this codebase's amount convention (see lib/payments/adapter.ts's file
 * header / lib/payments/fees.ts) — every `amount` elsewhere in this system
 * is a whole currency unit, never a fractional/float value. Throws on
 * anything that isn't a finite, non-negative number once parsed, so a
 * malformed amount fails loudly here rather than silently producing NaN/an
 * unexpected value that could mis-compare in `processPaymentWebhook`'s
 * `amountMatches` check.
 */
function parseWholeRupeeAmount(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`GuruPay returned a non-numeric or negative amount: ${JSON.stringify(raw)}`)
  }
  return Math.round(parsed)
}

/**
 * Validates GuruPay's `payment_url` before it's ever stored or redirected
 * to: must parse as a URL, must be `https:`, and must be on GuruPay's own
 * confirmed checkout host (`www.gurupaygateway.com`) — never a
 * `javascript:` URL, a different host, or a non-https scheme. Throws on
 * anything else; a hosted-checkout URL this codebase can't trust is treated
 * the same as any other `createOrder` failure (existing "couldn't start
 * your payment" error path), never stored or redirected to.
 */
function assertValidPaymentUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`GuruPay returned a malformed payment_url: ${rawUrl}`)
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== GURUPAY_CHECKOUT_HOST) {
    throw new Error(`GuruPay returned a payment_url on an untrusted origin: ${rawUrl}`)
  }
  return parsed.toString()
}

function isValidCreateOrderResponse(json: unknown): json is GuruPayCreateOrderResponse {
  return isRecord(json) && typeof json.status === 'string' && isRecord(json.data) && typeof json.data.payment_url === 'string'
}

/**
 * `POST /api/create-order`. Amount units (docs/payments/SPEC.md §11 Q1,
 * confirmed 2026-09-18): GuruPay's `amount` is whole rupees, sent as-is, no
 * ×100/÷100 conversion — matches this codebase's whole-rupee convention
 * throughout (lib/payments/adapter.ts, lib/payments/fees.ts).
 */
async function createOrder(config: GuruPayAdapterConfig, input: CreateOrderInput): Promise<PaymentOrder> {
  const orderId = generateOrderId(input.registrationId)

  const json = await guruPayFetch(
    '/api/create-order',
    config.apiKey,
    {
      amount: input.amount,
      order_id: orderId,
      customer_name: 'MUN Hub delegate',
      // The browser's post-payment redirect target — NOT the webhook
      // endpoint. Prefers the per-registration page the caller supplied
      // (lib/actions/registration.ts builds `${APP_URL}/register/:slug/pay?
      // registrationId=...`); falls back to the adapter's configured default
      // only if none was given. See GuruPayAdapterConfig.callbackUrl.
      callback_url: input.returnUrl ?? config.callbackUrl,
      description: `MUN Hub registration ${input.registrationId}`,
    },
    CREATE_ORDER_TIMEOUT_MS,
  )

  if (!isValidCreateOrderResponse(json)) {
    throw new Error('GuruPay create-order returned an unexpected response shape')
  }

  // The generated order_id is authoritative regardless of whatever
  // `data.order_id` echoes back (real API does echo it, but a caller-
  // generated id should never trust a provider echo over its own record).
  return { orderId, checkoutUrl: assertValidPaymentUrl(json.data.payment_url) }
}

/** Maps GuruPay's `payment_status` to the normalized event type, or null for 'pending' (§4.4.1 step 4). */
function toEventType(status: GuruPayPaymentStatus): 'payment.captured' | 'payment.failed' | null {
  if (status === 'success') return 'payment.captured'
  if (status === 'failed') return 'payment.failed'
  return null
}

/**
 * `eventId` derivation (docs/payments/SPEC.md §4.4.1 step 6): GuruPay has no
 * explicit unique event id, and check-status is a snapshot, not an event.
 * `${order_id}:${payment_status}:${utr ?? 'none'}` — `order_id` here is
 * always the REQUESTED order id (the one this codebase generated and asked
 * check-status about), never `data.order_id` from the response — the real
 * API does echo one back, but it's still not trusted over our own record
 * (see `normalizeCheckStatusData`'s doc comment). A later check-status call
 * (webhook retry or the reconciliation job) that returns the same
 * success+utr as an already-processed webhook naturally dedupes.
 */
function deriveEventId(requestedOrderId: string, data: GuruPayCheckStatusResponse): string {
  return `${requestedOrderId}:${data.payment_status}:${data.utr ?? 'none'}`
}

/**
 * Normalizes a check-status response into a `PaymentWebhookEvent`.
 * `requestedOrderId` — the order id THIS call asked check-status about — is
 * always what's trusted as `providerOrderId` (bug fix, docs/payments/SPEC.md):
 * the real response DOES echo `data.order_id`, but a mismatch there is
 * exactly the kind of untrusted-provider-data case this system must never
 * silently accept, so it's deliberately ignored in favor of the requested
 * id, not merged in.
 */
function normalizeCheckStatusData(requestedOrderId: string, data: GuruPayCheckStatusResponse): PaymentWebhookEvent | null {
  const type = toEventType(data.payment_status)
  if (type === null) return null

  return {
    eventId: deriveEventId(requestedOrderId, data),
    providerEventType: data.payment_status,
    type,
    providerOrderId: requestedOrderId,
    providerPaymentId: data.utr ?? null,
    amount: parseWholeRupeeAmount(data.amount),
    // The real response does include `data.currency` — used when present;
    // this system operates in INR exclusively either way (see
    // lib/payments/adapter.ts's file header), so a missing field still falls
    // back safely rather than trusting an absent one blindly.
    currency: data.currency ?? 'INR',
    occurredAt: data.paid_at ? new Date(data.paid_at) : new Date(),
    // No signed delivery timestamp exists for GuruPay at all — replay
    // protection rests entirely on (provider, eventId) dedupe, same
    // documented rationale as Razorpay's in docs/payments/INTEGRATION.md §2.5.
    signedAt: null,
  }
}

function isValidCheckStatusResponse(json: unknown): json is GuruPayCheckStatusEnvelope {
  if (!isRecord(json)) return false
  if (json.status !== 'success' || !isRecord(json.data)) return false
  const { data } = json
  return (
    (data.payment_status === 'success' || data.payment_status === 'pending' || data.payment_status === 'failed') &&
    (typeof data.amount === 'string' || typeof data.amount === 'number')
  )
}

/**
 * `POST /api/check-status` for `orderId`, normalized the same way
 * `verifyAndParseWebhook` does. Exported so the reconciliation job
 * (`lib/jobs/reconcile-gurupay-orders.ts`) can call it directly with a plain
 * order id instead of fabricating a fake webhook body/headers pair to hand
 * to `verifyAndParseWebhook` (docs/payments/SPEC.md §4.4.2).
 *
 * Throws `WebhookVerificationError('INVALID_PAYLOAD')` on a network error,
 * non-2xx response, or malformed response shape — never `INVALID_SIGNATURE`
 * (there is no signature to be invalid). Returns `null` for `pending`.
 */
export async function checkOrderStatus(
  orderId: string,
  config: Pick<GuruPayAdapterConfig, 'apiKey'>,
): Promise<PaymentWebhookEvent | null> {
  let json: unknown
  try {
    json = await guruPayFetch('/api/check-status', config.apiKey, { order_id: orderId }, CHECK_STATUS_TIMEOUT_MS)
  } catch (error) {
    console.error(`[payments] GuruPay check-status failed for order_id=${orderId}`, error)
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }

  if (!isValidCheckStatusResponse(json)) {
    console.error(`[payments] GuruPay check-status returned an unexpected shape for order_id=${orderId}`)
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }

  return normalizeCheckStatusData(orderId, json.data)
}

/** Structural-only validation of the webhook body's `order_id` (never trusted for the outcome). */
function extractOrderId(rawBody: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }
  if (!isRecord(parsed) || typeof parsed.order_id !== 'string' || parsed.order_id.length === 0) {
    throw new WebhookVerificationError('INVALID_PAYLOAD')
  }
  return parsed.order_id
}

export function createGuruPayAdapter(config: GuruPayAdapterConfig): PaymentsAdapter {
  return {
    provider: GURUPAY_PROVIDER,

    createOrder: (input) => createOrder(config, input),

    /**
     * (a) Parses `order_id` out of the raw body — structural validation
     *     only, this is not trusted data.
     * (b) Calls `POST /api/check-status` with that `order_id`.
     * (c) Builds the normalized event ENTIRELY from the check-status
     *     response — never from the webhook body's own `amount`/`status`
     *     fields (docs/payments/SPEC.md §4.4.1, §9 — see
     *     gurupay-adapter.test.ts's forged-webhook-body tests).
     */
    verifyAndParseWebhook: async (rawBody) => {
      const orderId = extractOrderId(rawBody)
      return checkOrderStatus(orderId, config)
    },
  }
}
