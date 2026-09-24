# Payments: Cashfree (the live gateway)

Cashfree is MUN Hub's real, live payment gateway, replacing GuruPay (removed
2026-09-24; `docs/payments/SPEC.md` is kept as historical reference only) and
the never-built Razorpay recipe (`docs/payments/INTEGRATION.md`). This
document describes what actually shipped.

Product rules that shape everything below (unchanged from before):

- **No refunds.** All payments are final (`/legal/refunds`). Money taken with
  no valid registration behind it is a **payment exception**, which an admin
  resolves by hand (Admin → Payments → Resolve, note required, audited).
- **Platform fee is additive.** The delegate pays the listed price PLUS the
  platform fee PLUS GST on the fee; the organizer receives the full listed
  price unchanged (`lib/payments/fees-additive.ts`).
- **Only the webhook (or the reconciliation job) confirms a registration.** A
  browser return-URL redirect never does.

## 1. How it fits together

| Piece | File | Job |
|---|---|---|
| Interface | `lib/payments/adapter.ts` | `PaymentsAdapter { provider, createOrder, verifyAndParseWebhook }`, normalized `PaymentWebhookEvent`, `WebhookVerificationError` |
| Registry | `lib/payments/registry.ts` | `getPaymentsAdapter()` picks the adapter from `PAYMENTS_ADAPTER` per request; returns `null` when none is usable |
| Cashfree adapter | `lib/payments/cashfree-adapter.ts` | `createCashfreeAdapter(config)`; `checkOrderPayments` exported for the reconciliation job |
| Mock | `lib/payments/mock-adapter.ts` | Dev/test provider (`mock_razorpay`) |
| Webhook processor | `lib/payments/webhook.ts` | `processPaymentWebhook(adapter, rawBody, headers)`: verify → replay window → dedupe → settle, all under row locks |
| Reconciliation | `lib/jobs/reconcile-cashfree-orders.ts` | Missed-webhook safety net, registered in `lib/jobs/registry.ts`'s `SCHEDULED_JOBS`, runs on the 5-minute cron |
| Fees | `lib/payments/fees.ts`, `lib/payments/fees-additive.ts` | `computeFeeBreakdownAdditive(passAmount, {feeBps, taxBps})`, `getPlatformFeeRates()` |
| Order creation | `lib/actions/registration.ts#initiateRegistration` (and the group variant) | Reserve seat → look up the user's `name`/`email`/`phone` → `createOrder` → payment row |
| HTTP | `server/routes/webhooks.ts` (`POST /webhooks/payments`), `server/routes/registrations.ts` | Webhook endpoint; registration read, receipt, mock checkout |
| Checkout | `web/src/lib/cashfree.ts`, `web/src/components/registration/cashfree-checkout.tsx`, `web/src/pages/register/register-pay-page.tsx` | Loads Cashfree's JS SDK and drives the redirect |

## 2. Four deviations from the Razorpay recipe (INTEGRATION.md §2), confirmed live 2026-09-24

| Aspect | Razorpay recipe | Cashfree (shipped) |
|---|---|---|
| Order id | Provider generates it | **Caller (MUN Hub) generates it**: `mh_<uuid>` (Cashfree requires ≤45 chars, alphanumeric/underscore/hyphen — no registrationId embedded, unlike the old GuruPay scheme, since it isn't needed: `payments.provider_order_id` already links back to the registration) |
| Checkout | Embedded Checkout.js widget | **SDK-driven redirect**: `createOrder` returns `payment_session_id`; the browser loads `https://sdk.cashfree.com/js/v3/cashfree.js` and calls `cashfree.checkout({ paymentSessionId, redirectTarget: "_self" })`, which performs the actual full-page redirect. There is no plain URL to `window.location.assign()` to. |
| Customer details | Optional (`prefill`) | **Required**: `customer_details.customer_id/name/email/phone` must be sent on every `create-order` call. `lib/actions/registration.ts` looks up the paying user's `name`/`email`/`phone` from `users` right before calling `createOrder` (`CreateOrderInput.customer`, optional on the shared interface). `customer_id` strips non-alphanumeric characters from our UUID `users.id`. |
| Webhook trust | `X-Razorpay-Signature` HMAC | **Real signature, but a different key**: `x-webhook-signature` = base64(HMAC-SHA256(`x-webhook-timestamp` + rawBody, **the client secret** — there is no separate webhook secret to generate)). `x-webhook-timestamp` is a genuine signed delivery time, so the processor's 5-minute replay window is a real defense (unlike GuruPay, which signed nothing). |

## 3. API contract (verified against the live API, 2026-09-24)

- **Base URL**: `https://api.cashfree.com/pg` (production) or
  `https://sandbox.cashfree.com/pg` (sandbox) — `CASHFREE_ENV`.
- **Headers**: `x-client-id`, `x-client-secret`, `x-api-version: 2023-08-01`
  (pinned; re-verify against a live call before bumping).
- **`POST /orders`** body: `{ order_id, order_amount, order_currency,
  customer_details: { customer_id, customer_name, customer_email,
  customer_phone }, order_meta: { return_url, notify_url } }`. `order_amount`
  is whole/decimal rupees, sent as-is (matches this codebase's whole-rupee
  convention throughout). `notify_url` is Cashfree's webhook target, sent
  **per order** — there is no separate dashboard step to configure it.
  Response: `{ order_id, order_status, payment_session_id, ... }`.
- **Webhook body** (`POST /webhooks/payments`, mounted outside `/api/v1` and
  CSRF): `{ type: "PAYMENT_SUCCESS_WEBHOOK" | "PAYMENT_FAILED_WEBHOOK" |
  "PAYMENT_USER_DROPPED_WEBHOOK", data: { order: { order_id }, payment: {
  cf_payment_id, payment_status, payment_amount, payment_currency,
  payment_time } } }`. `PAYMENT_SUCCESS_WEBHOOK` maps to `payment.captured`;
  the other two both map to `payment.failed` (an abandoned checkout releases
  the seat exactly like an explicit failure — no separate state needed).
  Anything else Cashfree might send is ignored (`null`). `eventId` is
  `cf_payment_id` (stable per attempt, present on both success and failure).
- **`GET /orders/{order_id}/payments`**: array of payment attempts, used only
  by the reconciliation job. Picks any `SUCCESS` attempt over `FAILED` ones,
  else the most recent `FAILED`, else `null` (still pending).

## 4. Environment

| Name | Where | Value |
|---|---|---|
| `PAYMENTS_ADAPTER` | var | `cashfree` |
| `CASHFREE_CLIENT_ID` | secret (`wrangler secret put`) | Cashfree App ID |
| `CASHFREE_CLIENT_SECRET` | **secret** | Cashfree Secret Key — also the webhook signing key |
| `CASHFREE_ENV` | var | `production` or `sandbox` (default `production`) |
| `PLATFORM_FEE_BPS` | var | e.g. `650` = 6.5% |
| `PLATFORM_FEE_TAX_BPS` | var | GST on the fee, default `1800` = 18% |
| `MOCK_PAYMENTS_ENABLED` | — | **must be unset** in every deployed environment |
| `VITE_CASHFREE_ENV` | web build var | `production` or `sandbox` — must match the server's `CASHFREE_ENV` |

A malformed `PLATFORM_FEE_BPS` makes checkout fail loudly (no seat is held)
rather than charging no fee. `CASHFREE_CLIENT_ID`/`CASHFREE_CLIENT_SECRET`
are read exclusively via `getRuntimeEnv` — never `process.env` — anywhere in
`/server` or a `/lib` module it depends on.

## 5. CSP

`web/public/_headers` and `web/vercel.json` (kept in sync) allow
`script-src https://sdk.cashfree.com` (to load the SDK) and
`connect-src`/`frame-src https://payments.cashfree.com` (defensive — the SDK
performs a top-level navigation on `redirectTarget: "_self"`, not an embedded
frame, so this isn't strictly required for the redirect itself, but is kept
in case the SDK's own internals need it).

## 6. What the webhook processor guarantees (unchanged, provider-agnostic)

See `lib/payments/webhook.ts`'s own header comment — signature-first
verification, a 5-minute replay window, `(provider, eventId)` dedupe,
provider isolation (a payment row is only settled by the adapter whose
`provider` created it), amount/currency must match exactly, and the full set
of outcomes (`CONFIRMED`, `DUPLICATE_CAPTURE`, `FAILED`,
`IGNORED_FAILURE_AFTER_CAPTURE`, `EXCEPTION_*`, `UNKNOWN_ORDER`,
`REJECTED_STALE`). None of this changed for Cashfree — only the adapter that
feeds it normalized events changed.

## 7. Go-live checklist

- [ ] Cashfree account activated (KYC done), settlement account verified.
- [ ] `wrangler secret put CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET` on
      `munhub-api` (production); `PAYMENTS_ADAPTER=cashfree`, `CASHFREE_ENV`,
      `PLATFORM_FEE_BPS`, `PLATFORM_FEE_TAX_BPS` set as vars.
- [ ] `MOCK_PAYMENTS_ENABLED` is **not** set on any deployed Worker.
- [ ] CSP on the web app allows the Cashfree SDK (§5).
- [ ] `POST https://api.munhub.in/webhooks/payments` with a forged signature
      returns `400`.
- [ ] One real low-value payment end to end: confirmation, receipt, organizer
      summary, Cashfree dashboard.
- [ ] Admin → Payments is empty (or every row is understood) and someone owns
      that queue.
- [ ] The product still has no refund state; a Cashfree-side refund for a
      payment exception is done in the Cashfree dashboard directly, then
      Resolve with the reference in the note.
- [ ] Organizer payouts: out of scope here (settlement is manual;
      `mun_payment_settings` is config only).
