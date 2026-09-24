# Payments: how the seam works and how to add Razorpay

> **Status (2026-09-24): doubly superseded.** Razorpay was never built.
> GuruPay shipped after it (`docs/payments/SPEC.md`), then was itself fully
> removed and replaced by **Cashfree**, the current live gateway —
> `docs/payments/CASHFREE.md` is the authoritative doc for the real,
> currently-shipped implementation (`lib/payments/cashfree-adapter.ts`,
> `lib/jobs/reconcile-cashfree-orders.ts`, `lib/payments/fees-additive.ts`).
> The interface seam, webhook processor, registry pattern and fee module
> described below are still the real architecture — CASHFREE.md documents
> where Cashfree's actual API forced deviations from this Razorpay recipe
> (real webhook signatures, no plain redirect URL, required customer
> details). This document's Razorpay-specific sections (§2 "Adding
> Razorpay") are kept as historical reference only — no future work should
> follow this recipe without reading CASHFREE.md first.

Status (2026-09-17): the payment path is **gateway-ready but has no real gateway**.
The only adapter is the dev/test mock, which works only with
`MOCK_PAYMENTS_ENABLED=true`. In production (flag unset) paid passes are refused
with `503 PAYMENTS_UNAVAILABLE`, free passes still work, and the pay page says
"Online payments aren't available yet". This document is the recipe for
turning on Razorpay. Nothing here makes a network call today.

Product rules that shape everything below:

- **No refunds.** All payments are final (`/legal/refunds`). Money taken with no
  valid registration behind it is a **payment exception**, which an admin
  resolves by hand (Admin → Payments → Resolve, note required, audited).
- **Platform fee is included in the listed price.** The delegate pays the listed
  amount; MUN Hub keeps the fee plus GST on the fee; the organizer is owed the rest.
- **Only the webhook confirms a registration.** A browser callback never does.

## 1. How it fits together

| Piece | File | Job |
|---|---|---|
| Interface | `lib/payments/adapter.ts` | `PaymentsAdapter { provider, createOrder, verifyAndParseWebhook }`, normalized `PaymentWebhookEvent`, `WebhookVerificationError` |
| Registry | `lib/payments/registry.ts` | `getPaymentsAdapter()` picks the adapter from `PAYMENTS_ADAPTER` per request; returns `null` when none is usable |
| Mock | `lib/payments/mock-adapter.ts` | Dev/test provider (`mock_razorpay`); signs `x-webhook-timestamp` + `x-webhook-signature` |
| Webhook processor | `lib/payments/webhook.ts` | `processPaymentWebhook(adapter, rawBody, headers)`: verify → replay window → dedupe → settle, all under row locks |
| Fees | `lib/payments/fees.ts` | `computeFeeBreakdown(amount, {feeBps, taxBps})`, `getPlatformFeeRates()` |
| Early-bird | `lib/payments/pricing.ts` | `effectivePassPrice(product, now)` (decided inside the registration transaction) |
| Hooks | `lib/payments/events.ts` | `onRegistrationConfirmed`, `onPaymentFailed` (no-ops; notifications lane fills them) |
| Exceptions | `lib/payments/exceptions.ts`, `exception-reasons.ts` | Admin list + resolve |
| Order creation | `lib/actions/registration.ts#initiateRegistration` | Reserve seat → `createOrder` → payment row with amount, currency, fee split |
| HTTP | `server/routes/webhooks.ts` (`POST /webhooks/payments`), `server/routes/registrations.ts` | Webhook endpoint; registration, receipt, mock checkout |
| Pay page | `web/src/pages/register/register-pay-page.tsx` | Offers a checkout based on `paymentProvider` from `GET /registrations/:id` |

### Normalized webhook event

```ts
{
  eventId: string            // dedupe key, unique per provider
  providerEventType: string  // provider's own name, for the log
  type: 'payment.captured' | 'payment.failed'
  providerOrderId: string    // matches payments.provider_order_id
  providerPaymentId: string | null
  amount: number             // WHOLE RUPEES (see "Amount units")
  currency: string           // 'INR'
  occurredAt: Date
  signedAt: Date | null      // signed DELIVERY time, or null (see replay window)
}
```

`verifyAndParseWebhook` throws `WebhookVerificationError('INVALID_SIGNATURE' | 'INVALID_PAYLOAD')`,
returns `null` for an authentic event we don't act on (answered `200 {ok, ignored}`),
or returns the event.

### What the processor guarantees

- **Signature first**: a bad signature → `400`, nothing read or written.
- **Replay window**: if `signedAt` is set and is more than 5 minutes from now → `400 STALE_EVENT`
  (logged in `payment_webhook_events` as `REJECTED_STALE`, still re-processable).
- **Dedupe**: `(provider, eventId)` is claimed in `payment_webhook_events` inside the settlement
  transaction. A processed event → `200 {ok, duplicate: true}`. A crash or unknown order leaves
  `processed_at` null, so the provider's retry is evaluated again.
- **Provider isolation**: a payment row is only settled by the adapter whose `provider` created it.
- **Amount and currency must equal the payment row**, else exception `AMOUNT_MISMATCH` (not confirmed).
- **Captured, registration still `PAYMENT_PENDING`** → payment `PAID`, registration `CONFIRMED`,
  `200 {ok, confirmed: true}`, then `onRegistrationConfirmed` after commit.
- **Captured after the hold was released** → payment `PAID` + exception
  `PAYMENT_AFTER_HOLD_EXPIRED`, registration untouched, `200 {ok, exception: true}`.
- **Second, different capture on a paid order** → exception `DUPLICATE_PAYMENT`.
- **Failed** → payment `FAILED`, registration `CANCELLED` (seat released), then `onPaymentFailed`.
  A failure after a capture is ignored.
- **Unknown order** → `404` (not marked processed).

### Responses the provider sees

| Case | Status |
|---|---|
| applied / duplicate / ignored / exception | `200` |
| bad signature, malformed body, stale delivery | `400` |
| unknown order | `404` |
| no usable adapter (payments disabled) | `404` |
| unexpected error | `500` (provider retries) |

## 2. Adding Razorpay

### 2.1 Files to add or change

1. **`lib/payments/razorpay-adapter.ts`** (new) — `export function createRazorpayAdapter(config): PaymentsAdapter`
   with `provider: 'razorpay'`. Build it per call from `getRuntimeEnv(...)` values. Never read
   `process.env` and never cache a client at module scope (Workers).
2. **`lib/payments/registry.ts`** — add:
   ```ts
   case 'razorpay': {
     const keyId = getRuntimeEnv('RAZORPAY_KEY_ID')
     const keySecret = getRuntimeEnv('RAZORPAY_KEY_SECRET')
     const webhookSecret = getRuntimeEnv('RAZORPAY_WEBHOOK_SECRET')
     return keyId && keySecret && webhookSecret
       ? createRazorpayAdapter({ keyId, keySecret, webhookSecret })
       : null
   }
   ```
3. **`lib/payments/razorpay-adapter.test.ts`** (new) — unit tests with recorded payloads and a
   stubbed `fetch` (see 2.6).
4. **`server/routes/registrations.ts`** — `GET /registrations/:id` already returns
   `paymentProvider`. Add the public checkout data the browser needs when it is `'razorpay'`:
   `checkout: { keyId: getRuntimeEnv('RAZORPAY_KEY_ID'), orderId, amountPaise, currency, name, prefill }`.
   The key **id** is public; the key **secret** must never leave the server.
5. **`web/src/components/registration/razorpay-checkout.tsx`** (new) and
   **`web/src/pages/register/register-pay-page.tsx`** — when `paymentProvider === 'razorpay'`,
   load `https://checkout.razorpay.com/v1/checkout.js` and open Checkout (2.4). Today the page
   shows the "not available" notice for every provider except the mock; replace that branch.
6. **Security headers (sec-edge lane files)** — allow Checkout in the web app's CSP:
   `script-src https://checkout.razorpay.com`, `frame-src https://api.razorpay.com https://checkout.razorpay.com`,
   `connect-src https://api.razorpay.com https://lumberjack.razorpay.com`. Re-check against Razorpay's current CSP list.
7. **`server/wrangler.jsonc`** — `"PAYMENTS_ADAPTER": "razorpay"` under `vars` (non-secret).

Nothing else changes: `initiateRegistration`, the webhook route, fees, exceptions and the
admin/organizer pages are provider-agnostic.

### 2.2 Environment

| Name | Where | Value |
|---|---|---|
| `PAYMENTS_ADAPTER` | var | `razorpay` |
| `RAZORPAY_KEY_ID` | var or secret | `rzp_test_…` / `rzp_live_…` |
| `RAZORPAY_KEY_SECRET` | **secret** (`wrangler secret put`) | API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | **secret** | the secret typed when creating the webhook in the Razorpay dashboard |
| `PLATFORM_FEE_BPS` | var | e.g. `250` = 2.5% (default `0`) |
| `PLATFORM_FEE_TAX_BPS` | var | GST on the fee, default `1800` = 18% |
| `MOCK_PAYMENTS_ENABLED` | — | **must be unset** in every deployed environment |
| `MOCK_PAYMENT_WEBHOOK_SECRET` | — | not needed once the mock is off |

A malformed `PLATFORM_FEE_BPS` makes checkout fail loudly (no seat is held) rather than charging no fee.

### 2.3 Creating an order

```ts
async createOrder({ amount, currency, registrationId }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amount * 100,          // rupees → paise (integer)
      currency,                      // 'INR'
      receipt: registrationId,       // ≤ 40 chars; a UUID is 36
      notes: { registrationId },
    }),
  })
  if (!res.ok) throw new Error(`Razorpay order failed: ${res.status}`)
  const order = (await res.json()) as { id: string }
  return { orderId: order.id }       // 'order_…' → payments.provider_order_id
}
```

If `createOrder` throws, `initiateRegistration` cancels the reservation straight away and the
delegate sees "We couldn't start your payment, so no seat was held" (`503`). Add a timeout
(`AbortSignal.timeout(10_000)`) so a hung gateway doesn't hold the request.

### 2.4 Checkout in the browser

```ts
new Razorpay({
  key: checkout.keyId,
  order_id: checkout.orderId,
  amount: checkout.amountPaise,
  currency: checkout.currency,
  name: 'MUN Hub',
  description: `${munName} · ${passName}`,
  prefill: { name, email, contact },
  handler: () => pollUntilSettled(),   // do NOT confirm from here
  modal: { ondismiss: () => {/* seat stays held until the countdown ends */} },
}).open()
```

The `handler` response (`razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`) is
only a hint. Poll `GET /registrations/:id` every ~2 s for up to ~30 s: `CONFIRMED` → go to the
confirmation page; still `PAYMENT_PENDING` → go there anyway (it already says "Payment still
processing — refresh"). Optional speed-up: a `POST /registrations/:id/payment-callback` that
verifies `HMAC_SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)` and then fetches the
payment from Razorpay before calling the same processor. The webhook stays the source of truth.

Turn on **automatic capture** in the Razorpay dashboard (Account & Settings → Payment capture).
Otherwise payments stop at `authorized` and nothing is captured.

### 2.5 Verifying and mapping the webhook

- **Webhook URL**: `https://api.munhub.in/webhooks/payments` (outside `/api/v1`, no CSRF, no
  session). Use a separate webhook for test mode, pointing at a staging API.
- **Events to enable**: `payment.captured`, `payment.failed`. Everything else Razorpay sends
  (`payment.authorized`, `order.paid`, `refund.*`, …) → return `null` (ignored).
- **Signature**: header `X-Razorpay-Signature` = hex `HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)`.
  Compare with `crypto.timingSafeEqual` on equal-length buffers (see the mock). Use the raw body
  exactly as received — the route already passes it before any JSON parse.
- **Mapping** (`body.payload.payment.entity` = `p`):

  | Normalized | Razorpay |
  |---|---|
  | `type` | `body.event` (`payment.captured` / `payment.failed`) |
  | `providerEventType` | `body.event` |
  | `providerOrderId` | `p.order_id` |
  | `providerPaymentId` | `p.id` |
  | `amount` | `p.amount / 100` — if `p.amount % 100 !== 0`, pass the fractional value through so the processor raises `AMOUNT_MISMATCH` |
  | `currency` | `p.currency` |
  | `occurredAt` | `new Date(body.created_at * 1000)` |
  | `eventId` | `` `${body.event}:${p.id}` `` (see below) |
  | `signedAt` | `null` |

- **Why `eventId` comes from the signed body**: Razorpay also sends `X-Razorpay-Event-Id`, but
  headers are not covered by the signature, so a replayed body with a new header would bypass
  dedupe. `event + payment id` is signed, and each payment is captured or failed at most once.
- **Why `signedAt` is null**: Razorpay signs no delivery timestamp. `created_at` stays the same on
  its own retries (which continue for many hours after failures), so using it as `signedAt` would
  reject legitimate retries as replays. Replay safety comes from dedupe plus the processor's
  "same capture again = duplicate" rule.
- **Retries of failed attempts**: Razorpay Checkout lets a delegate retry after a declined
  attempt, and sends `payment.failed` for each failed attempt. The processor treats
  `payment.failed` as final (the seat is released), so a later success in the same modal becomes
  a `PAYMENT_AFTER_HOLD_EXPIRED` exception. **Decide before go-live:**
  (a) keep it (simple; admins return those payments), or
  (b) have the adapter return `null` for `payment.failed` and let the 15-minute hold expire on its
  own, so an in-modal retry still confirms. (b) is recommended; `onPaymentFailed` then never fires
  for Razorpay, so failure emails would need another trigger.
- Respond fast: the processor does two short transactions. Hooks run after the response via
  `waitUntil`.

### 2.6 Test plan

Unit (`lib/payments/razorpay-adapter.test.ts`, no network):
- signature: valid, tampered body, wrong secret, missing header, different-length signature;
- mapping of recorded `payment.captured` / `payment.failed` payloads (paise → rupees, ids, event id);
- ignored events (`order.paid`, `payment.authorized`, `refund.processed`) → `null`;
- non-integer rupee amount → surfaces as `AMOUNT_MISMATCH` through `processPaymentWebhook`;
- `createOrder`: request body (paise, receipt, auth header) with a stubbed `fetch`; non-2xx → throws.

Integration (`server/integration/`, pattern of `payments.integration.test.ts`): sign a recorded
payload with a test secret and POST it to `/webhooks/payments` with `PAYMENTS_ADAPTER=razorpay`.

Test mode, end to end (test keys, staging API or a tunnel to a local API):
1. Paid pass → Checkout → test card / `success@razorpay` UPI → confirmation page, dashboard, receipt.
2. Declined attempt, then success in the same modal (verify the behaviour you chose in 2.5).
3. Open Checkout, wait for the hold to expire (temporarily shorten `RESERVATION_TTL_MS` on
   staging), start another registration on the same pass so the expiry sweep releases the seat,
   then complete the payment in the still-open modal → `PAYMENT_AFTER_HOLD_EXPIRED` in
   Admin → Payments; resolve it with a note.
4. Resend a delivered webhook from the Razorpay dashboard → `{duplicate: true}`, nothing changes.
5. POST a body with a wrong signature → `400`.
6. Early-bird pass: the order amount equals the early-bird price.
7. With `PLATFORM_FEE_BPS=250`: the payment row's fee split and the organizer Payments summary add up.
8. Free pass → confirmed with no order.
9. Unset the Razorpay vars → paid pass gives `503 PAYMENTS_UNAVAILABLE`, pay page shows the notice.

### 2.7 Go-live checklist

- [ ] Razorpay account activated (KYC done), settlement account verified.
- [ ] Auto-capture on; live keys generated.
- [ ] Live webhook created for `https://api.munhub.in/webhooks/payments` with `payment.captured` and
      `payment.failed`; its secret stored with `wrangler secret put RAZORPAY_WEBHOOK_SECRET`.
- [ ] `wrangler secret put RAZORPAY_KEY_SECRET` (and `RAZORPAY_KEY_ID`); `PAYMENTS_ADAPTER=razorpay`,
      `PLATFORM_FEE_BPS`, `PLATFORM_FEE_TAX_BPS` set as vars on `munhub-api`.
- [ ] `MOCK_PAYMENTS_ENABLED` is **not** set on any deployed Worker; `POST /api/v1/registrations/<id>/mock-payment`
      returns `404` in production.
- [ ] CSP on the web app allows Checkout (2.1 step 6).
- [ ] Decision in 2.5 ("retries of failed attempts") made and implemented.
- [ ] `POST https://api.munhub.in/webhooks/payments` with a forged signature returns `400`.
- [ ] One real low-value payment end to end: confirmation, receipt, organizer summary, Razorpay dashboard.
- [ ] Admin → Payments is empty (or every row is understood) and someone owns that queue.
- [ ] Refund/return procedure for exceptions agreed (Razorpay dashboard refund on the specific
      payment id, then Resolve with the reference in the note). The product still has no refund state.
- [ ] Organizer payouts: out of scope here (settlement is manual; `mun_payment_settings` is config
      only). If you use Razorpay Route for splits, that's a separate change.
