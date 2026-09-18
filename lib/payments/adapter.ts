/**
 * Payments provider seam. Everything outside `lib/payments/` talks to a
 * provider only through this interface, obtained from `getPaymentsAdapter()`
 * (./registry.ts) — never by importing a concrete adapter. A real gateway
 * (Razorpay — see docs/payments/INTEGRATION.md) is one new file implementing
 * this interface plus one registry entry; call sites stay unchanged.
 *
 * Amount units: every `amount` in this interface is in the same units as
 * `registration_products.price` / `payments.amount` — whole currency units
 * (rupees for INR). An adapter whose provider works in minor units (Razorpay:
 * paise) converts at its own boundary, in both directions.
 */

export interface CreateOrderInput {
  amount: number
  /** ISO 4217, e.g. 'INR'. */
  currency: string
  /** Our registration id — sent to the provider as the order's receipt/reference. */
  registrationId: string
  /**
   * Where the student's BROWSER should land after paying, for a
   * redirect-based provider (GuruPay's `callback_url`) — a real MUN Hub page
   * (e.g. `${APP_URL}/register/:slug/pay?registrationId=...`), never the
   * webhook endpoint. This redirect is never trusted to confirm anything
   * (see GuruPayAdapter.verifyAndParseWebhook) — it only returns the student
   * to a page that polls `GET /registrations/:id`. Optional: the mock
   * adapter and any non-redirect-based provider ignore it.
   */
  returnUrl?: string
}

export interface PaymentOrder {
  /** Provider's order id — stored as `payments.provider_order_id`. */
  orderId: string
  /**
   * Hosted checkout page to redirect the browser to, for a redirect-based
   * provider (GuruPay: `payment_url`). Optional and additive — the mock
   * adapter and any future embedded-widget adapter (Razorpay's Checkout.js)
   * are not forced to supply it; `PaymentOrder` without this field stays a
   * valid return value for either of those.
   */
  checkoutUrl?: string
}

export type PaymentWebhookEventType = 'payment.captured' | 'payment.failed'

/**
 * A provider webhook, verified and normalized. Only events that change a
 * payment are normalized; everything else the provider sends is `null`
 * from `verifyAndParseWebhook` (acknowledged, not acted on).
 */
export interface PaymentWebhookEvent {
  /** Provider's unique event id — the dedupe key in `payment_webhook_events`. */
  eventId: string
  /** Provider's name for the event, kept for the event log (e.g. 'payment.captured'). */
  providerEventType: string
  type: PaymentWebhookEventType
  providerOrderId: string
  /** Null when the provider sends a failure without a payment id. */
  providerPaymentId: string | null
  /** Whole currency units (see file header). */
  amount: number
  currency: string
  /** When the payment event happened at the provider. */
  occurredAt: Date
  /**
   * The delivery timestamp covered by the signature, when the provider signs
   * one (the mock does, in `x-webhook-timestamp`). The webhook processor
   * rejects deliveries whose signed timestamp is outside the replay window.
   * Null when the provider signs no delivery time — replay protection then
   * rests on the (provider, eventId) dedupe alone. Do NOT map a timestamp
   * that the provider keeps unchanged across its own retries (Razorpay's
   * `created_at`) here, or legitimate retries would be rejected as replays.
   */
  signedAt: Date | null
}

/** Thrown by `verifyAndParseWebhook` for a bad signature or malformed payload. */
export class WebhookVerificationError extends Error {
  constructor(
    readonly reason: 'INVALID_SIGNATURE' | 'INVALID_PAYLOAD',
    message = reason === 'INVALID_SIGNATURE' ? 'Invalid signature' : 'Invalid payload',
  ) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

export interface PaymentsAdapter {
  /**
   * Stable provider key, stored on `payments.provider` and
   * `payment_webhook_events.provider`. A webhook verified by one adapter
   * never settles a payment created by another.
   */
  readonly provider: string

  /** Creates a provider order. Called outside any DB transaction. */
  createOrder(input: CreateOrderInput): Promise<PaymentOrder>

  /**
   * Verifies `rawBody` (the exact request bytes, before any JSON parse)
   * against the signature in `headers`, then normalizes it.
   * - throws `WebhookVerificationError` if the signature or payload is bad;
   * - returns `null` for an authentic event this system doesn't act on;
   * - otherwise returns the normalized event.
   */
  verifyAndParseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent | null>
}
