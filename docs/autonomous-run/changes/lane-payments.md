# Lane `payments` — gateway-ready payments, no refunds

Lead: mun-hub-62. Worktree branch `worktree-wf_a8625366-3be-1` (fast-forwarded to `main` at
`73bcdf4` first: the worktree had been cut before migration 0031 and the run docs).
Razorpay how-to: `docs/payments/INTEGRATION.md`.

## What changed

### Adapter seam and the mock (task 1)
- `lib/payments/adapter.ts`: `PaymentsAdapter { provider, createOrder({amount, currency, registrationId}), verifyAndParseWebhook(rawBody, headers) }`,
  normalized `PaymentWebhookEvent` (`eventId, providerEventType, type, providerOrderId, providerPaymentId, amount, currency, occurredAt, signedAt`),
  `WebhookVerificationError`.
- `lib/payments/registry.ts`: `getPaymentsAdapter()` reads `PAYMENTS_ADAPTER` (default `mock`) per request. The mock is returned
  only when `MOCK_PAYMENTS_ENABLED === 'true'` and its webhook secret is set; otherwise `null`.
- `lib/payments/mock-adapter.ts`: signs `x-webhook-timestamp` + `x-webhook-signature = HMAC(secret, "ts.body")`; new payload
  shape (`id, type, orderId, providerPaymentId, amount, currency, createdAt`). `simulatePaymentOutcome(order, outcome, options)`
  returns `{rawBody, headers}`.
- With no usable adapter: `POST /registrations` for a paid total → `503 {code: PAYMENTS_UNAVAILABLE}` and no seat is held;
  a free total (price 0, incl. a free early-bird) is `CONFIRMED` immediately with no order/payment row;
  `POST /registrations/:id/mock-payment` → `404`; `POST /webhooks/payments` → `404`; the pay page shows
  "Online payments aren't available yet" (driven by `paymentProvider` on `GET /registrations/:id`).
- `.env.test` gains `MOCK_PAYMENTS_ENABLED="true"`; `.env.example` documents it plus the fee vars and the Razorpay vars.
- `E2E/playwright.config.ts`: the E2E API server now gets `MOCK_PAYMENTS_ENABLED: 'true'` (one additive line).

### Webhook hardening (task 2)
- All settlement logic moved to `lib/payments/webhook.ts#processPaymentWebhook`; `server/routes/webhooks.ts` is a thin wrapper.
  The mock checkout calls the same processor directly (the old HTTP self-call to `/webhooks/payments` is gone — it would not
  have worked on Workers anyway).
- Every verified event is claimed in `payment_webhook_events` inside the settlement transaction
  (`INSERT … ON CONFLICT (provider, event_id) DO UPDATE … WHERE processed_at IS NULL`): processed → `{duplicate: true}`;
  concurrent duplicates serialize on the claim; a rolled-back/unknown-order/stale delivery stays re-processable.
- Replay window: a signed delivery timestamp more than 5 minutes off → `400 STALE_EVENT` (logged as `REJECTED_STALE`).
- Amount and currency must match the payment row, else exception `AMOUNT_MISMATCH` (payment stays `PENDING`, not confirmed).
- Late payment → payment `PAID` + `PAYMENT_AFTER_HOLD_EXPIRED` + `exceptionRaisedAt`, `{exception: true}`. `refundOwed` and the
  REFUNDED write are gone. A second distinct capture on a paid order → `DUPLICATE_PAYMENT`. The same capture again → duplicate.
- Row locks kept: payment row then registration row (`FOR UPDATE`). A payment is only settled by the adapter whose
  `provider` created it.
- `lib/payments/events.ts`: `onRegistrationConfirmed(registrationId)` / `onPaymentFailed(registrationId)` — no-ops, called after
  commit through `runPaymentHook` (never rejects, logs errors). The webhook and mock routes hand the promise to
  `executionCtx.waitUntil` when running on Workers. The free-pass confirmation also fires `onRegistrationConfirmed`.

### Idempotency (task 3)
- `initiateRegistration(input, session, { idempotencyKey })`. A repeat by the same user returns the original registration with
  `replayed: true` (route answers `200` instead of `201`). The key is re-checked after the pass row lock (concurrent retries) and a
  unique-index violation from a cross-pass race is caught and turned into the replay. Same key for a different MUN/pass → `409`.
  Keys over 255 chars → `400`.
- If `createOrder` throws, the reservation is cancelled at once and its key cleared (so the same key can retry) →
  `503 "We couldn't start your payment, so no seat was held"`.
- Result shape is now `{ registrationId, orderId: string | null, status, replayed }`.

### Platform fee (task 4)
- `lib/payments/fees.ts#computeFeeBreakdown(amount, {feeBps, taxBps})`: `fee = roundHalfUp(amount×feeBps/10000)`,
  `tax = roundHalfUp(fee×taxBps/10000)`, `net = amount − fee − tax` (integer arithmetic; net absorbs rounding; throws if the fee and
  tax exceed the amount). `getPlatformFeeRates()` reads `PLATFORM_FEE_BPS` (default `0`) and `PLATFORM_FEE_TAX_BPS` (default `1800`)
  and throws on malformed values (inside the reservation transaction, so nothing is held).
- The payment row now stores `provider`, `currency`, `platformFeeAmount`, `platformFeeTaxAmount`, `organizerNetAmount`.

### Early-bird (task 5)
- `lib/payments/pricing.ts#effectivePassPrice` decides the price inside the locked registration transaction:
  `earlyBirdPrice` applies when set, the deadline is in the future **and it is lower than the regular price**.
- Web mirror `web/src/components/registration/pricing.ts` (display only). Pass cards on the MUN page and in the register
  flow show the early-bird price, the struck-through regular price and "Early-bird price until <date>"; the review step shows the
  price. `web/src/api/marketplace.ts` now converts `earlyBirdDeadline` to a `Date` (the public API already returned both fields).

### Admin payments (task 6)
- `lib/payments/exceptions.ts`: `listOpenPaymentExceptions` (open = reason set and not resolved; legacy `REFUNDED` rows from the
  old webhook are surfaced as `PAYMENT_AFTER_HOLD_EXPIRED`), `resolvePaymentException(paymentId, note, session)`
  (OPERATIONS/ADMIN/SUPER_ADMIN, note 1–2000 chars, row lock, admin audit entry in the same transaction).
  `lib/actions/admin-search.ts` re-exports them (`listPaymentExceptions` keeps its name for `admin-audit.ts`).
- **A failed payment is no longer listed** (no money was taken).
- Route `POST /admin/payment-exceptions/:paymentId/resolve` (`404` unknown / no exception, `409` already resolved, `400` no note).
- Audit: `recordAdminAction(tx, actor, 'PAYMENT_DETAILS_CHANGED', 'payment', paymentId, note, {kind: 'PAYMENT_EXCEPTION_RESOLVED', …})`
  — the closest existing enum value.
- `web/src/pages/admin/payments-page.tsx`: table (registration + payment id, delegate + email, MUN, amount, reason, raised at) and a
  Resolve dialog with a required note.

### Organizer finance (task 7)
- `refundPolicy` removed from the web form, the web types, the route's strict input schema (an old client sending it gets `400`),
  the lib input type and the masked read. `upsertPaymentSettings` no longer writes the column, so existing values are left as they
  are. Column kept.
- `getMunPaymentsSummary(munId, session)` (owner or ADMIN/SUPER_ADMIN) + `GET /muns/:munId/payments-summary` → `{ totals: [...] }`
  per currency: gross, platform fee, fee tax, net, paid registrations — from `PAID` payments whose registration still stands
  (`CONFIRMED`/`ATTENDED`/`NO_SHOW`). Legacy rows without a split count as zero fee. "Payments summary" card on the finance page.

### Support form (task 8)
- The "Refund" option is gone from `web/src/components/support/support-form.tsx` (enum value kept).

### Delegate (task 9)
- Dashboard cards: "Complete payment" (→ `/register/<slug>/pay?registrationId=…`) for `PAYMENT_PENDING` with an unexpired hold;
  "Receipt" link for `CONFIRMED`/`ATTENDED`/`NO_SHOW`; "Free" instead of "No payment yet" for a free confirmed pass.
- `GET /registrations/:id/receipt` (owner-only; everyone else, organizers and admins included, gets `404`) backed by
  `getRegistrationReceipt`; page `/dashboard/registrations/:registrationId/receipt` (route added in `web/src/routes.tsx`) with
  "Includes MUN Hub's platform fee and applicable GST on that fee", payment and order reference, paid-on date (from the webhook
  log, falling back to the payment row), print button. Linked from the confirmation page ("View receipt").
- Pay and confirmation pages show the amount actually on the order (early-bird and extras included).
- `lib/actions/student-dashboard.ts`: the delegate dashboard read now returns only `id, amount, currency, status` of the payment —
  it used to return the whole row, which now includes the fee split and admin exception notes.

## Decisions (made without the user)
- Free passes are confirmed immediately without a payment row (a gateway can't take a ₹0 order).
- Early-bird only applies when it is cheaper than the regular price.
- Failed payments are not exceptions; the admin queue shows only money taken without a valid registration.
- `payment.failed` stays terminal (seat released). For Razorpay this matters (in-modal retries) — documented as a decision for the
  user in INTEGRATION.md §2.5, with a recommendation.
- `signedAt` is separate from `occurredAt` so a provider whose own timestamp survives retries (Razorpay) doesn't trip the replay
  window.
- A resolved exception can be superseded by a new one on the same payment; an open one is never overwritten.
- Amounts stay in whole rupees; adapters convert to/from minor units.

## Env vars and bindings at deploy
- `munhub-api`: **do not set** `MOCK_PAYMENTS_ENABLED` (paid registrations will answer `503 PAYMENTS_UNAVAILABLE` until a real
  gateway is added — intended). Optional vars: `PAYMENTS_ADAPTER` (default `mock`), `PLATFORM_FEE_BPS` (default `0`),
  `PLATFORM_FEE_TAX_BPS` (default `1800`).
- Local dev: add `MOCK_PAYMENTS_ENABLED=true` to `server/.env` (the shared dev server on :3001 reads it) or the mock checkout
  disappears.
- No new bindings, no migration (uses 0031).

## Verification
- `npx vitest run lib/payments lib/actions/registration.test.ts lib/actions/admin-search.test.ts lib/actions/payment-settlement.test.ts lib/actions/student-dashboard.test.ts server/integration/payments.integration.test.ts server/integration/registration-eligibility.integration.test.ts server/integration/error-taxonomy.test.ts server/src/app.test.ts lib/lifecycle/validators/commerce.test.ts --no-file-parallelism`
  → 14 files, 192 tests passed. Also passed: `lib/actions/organizer-dashboard.test.ts`, `lib/lifecycle/go-live.test.ts`,
  `module-locking`, `organizer-confirmation`, `reverification`, `validation`, `lib/db/pipeline-schema.test.ts` (7 files, 100 tests).
- `server`: `npx tsc --noEmit -p tsconfig.json`; root `npx tsc --noEmit -p tsconfig.json` (0 errors); `web`:
  `npx tsc -b --noEmit`, `npx oxlint <changed files>` (4 warnings, all pre-existing on `HEAD`); `npx tsc --noEmit -p E2E/tsconfig.json`.
  The E2E suite itself was not run (tests lane).
- Browser (own API :3101 / web :5201, local DB, Playwright): early-bird cards, register → pay ₹1,199 → confirmation → receipt;
  free pass → confirmation; dashboard "Complete payment" / "Receipt" (desktop + 390px); admin list + resolve dialog; organizer
  summary (fee 250 bps) and no refund field; support categories without Refund; with the mock disabled, the pay page notice and the
  503 message in the form.

## Follow-ups
- Notifications lane: implement `onRegistrationConfirmed` / `onPaymentFailed` in `lib/payments/events.ts`.
- Tests lane: `E2E/specs/admin/registrations-payments.spec.ts` was updated here (failed payment is not an exception; new
  late-payment + resolve test) — run it. Any other spec relying on the mock needs `MOCK_PAYMENTS_ENABLED` (added to the E2E API env).
- Migration (next slot): a dedicated `admin_action` value `PAYMENT_EXCEPTION_RESOLVED` instead of `PAYMENT_DETAILS_CHANGED` + metadata.
- `lib/db/seed-go-live-modules.ts` still seeds a refund policy text ("Full refund up to 14 days…") into `mun_payment_settings` —
  contradicts the no-refunds policy (seed owner: sec-auth lane).
- `lib/actions/organizer-dashboard.ts` "revenue" and `lib/actions/mun-analytics.ts` still sum gross `payments.amount` and include
  late-payment rows that are owed back; consider the net/standing-registration rules used by `getMunPaymentsSummary`.
- `web/src/components/dashboard/registration-status.ts`, the confirmation page and organizer filters still have "Refunded" labels
  for the legacy enum values.
- A scheduled expiry sweep (devops lane jobs) would make hold expiry independent of the next registration attempt.
- Razorpay itself: see `docs/payments/INTEGRATION.md`.
