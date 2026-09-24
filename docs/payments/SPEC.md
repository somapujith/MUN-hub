# SPEC: GuruPay Payment Gateway Integration + Additive Platform Fee

> **Status (2026-09-24): superseded and retired.** GuruPay was fully removed
> from the codebase and replaced with **Cashfree** as the live payment
> gateway — `docs/payments/CASHFREE.md` is the authoritative doc for the
> real, currently-shipped implementation (`lib/payments/cashfree-adapter.ts`,
> `lib/jobs/reconcile-cashfree-orders.ts`). No GuruPay code remains in the
> repository; this document is kept only as historical reference for the
> design decisions of the integration it once described (the additive
> platform fee model it introduced is unchanged and still shipped — see
> `lib/payments/fees-additive.ts`). Do not follow anything below as a recipe
> for new work.

**Status:** Draft
**Created:** 2026-09-18
**Author:** spec-interviewer agent
**Complexity:** High

---

## 0. Relationship to existing docs (read this first)

This spec **extends and partially supersedes** `docs/payments/INTEGRATION.md`, which is a
pre-written, unimplemented recipe for adding **Razorpay** as a second `PaymentsAdapter`. GuruPay
replaces Razorpay as the target provider. Most of INTEGRATION.md's architecture (the interface
seam, the webhook processor, the registry pattern, the fee module) is REUSED UNCHANGED. This
spec calls out every point where GuruPay's actual API forces a deviation from that recipe. Once
this ships, `docs/payments/INTEGRATION.md` should be re-titled/archived or rewritten to describe
GuruPay instead of the hypothetical Razorpay plan — that housekeeping is listed in §7 but the
content changes described here take priority.

**Four deviations from the INTEGRATION.md Razorpay recipe, decided this session (do not
re-litigate):**

| Aspect | Razorpay recipe (docs) | GuruPay (this spec) |
|---|---|---|
| Order id | Provider generates it, returned in the response | **Caller (MUN Hub) generates it** and sends it in the request |
| Webhook signature | `X-Razorpay-Signature` HMAC, verified before trusting the event | **No signature available.** Trust comes from a synchronous server-to-server `check-status` call the adapter makes internally |
| Payout routing | N/A (also collect-all-to-platform already, no per-order split) | Confirmed: **no per-order payout routing is possible** — fixed merchant account wired to the API key |
| Fee model | Included in listed price, organizer absorbs it (current shipped behavior) | **Additive**: student pays listed price + fee at checkout; organizer receives the full listed price |

---

## 1. Problem Statement

MUN Hub currently has no real payment gateway — `PAYMENTS_ADAPTER` defaults to `mock`, and with
`MOCK_PAYMENTS_ENABLED` unset (as it must be in production), every paid registration is refused
with `PAYMENTS_UNAVAILABLE`. Organizers cannot actually collect money for paid MUN registrations
in production today. This spec replaces the mock with GuruPay as a real, live payment gateway,
and introduces a platform commission (6.5% + 18% GST on the commission) charged to the student
on top of the organizer's listed price, so MUN Hub has a real, accounted-for revenue mechanism.

## 2. Success Criteria

The feature is complete when:
- [ ] A student can complete a real paid registration through GuruPay's hosted payment page and
      land on the existing confirmation flow, with the registration `CONFIRMED` only after
      server-side reconciliation (never from an unverified webhook body or a browser redirect).
- [ ] The student is charged `listed price + platform fee + GST on the fee`, computed and
      rounded exactly as specified in §4.4; the organizer's `organizerNetAmount` equals the full
      listed price (organizer bears none of the fee).
- [ ] `PAYMENTS_ADAPTER=gurupay` is a fully usable, production-ready adapter selectable by the
      exact same registry mechanism `mock`/the never-built `razorpay` used — no call site outside
      `lib/payments/` changes.
- [ ] A GuruPay webhook delivery NEVER directly confirms or fails a payment; `verifyAndParseWebhook`
      always calls GuruPay's `check-status` server-to-server first and only a `payment_status`
      from that response is trusted.
- [ ] An order whose webhook never arrives is still reconciled: the existing 5-minute scheduled-job
      mechanism (`lib/jobs/registry.ts`) polls `check-status` for orders left in `PENDING`/
      `PAYMENT_PENDING` past a defined age, per §4.5/§6.
- [ ] The `GURUPAY_API_KEY` is read exclusively via `getRuntimeEnv`, never `process.env` directly,
      anywhere in `/server` or a `/lib` module it depends on.
- [ ] No test run, local or CI, ever calls GuruPay's real API — the entire existing mock-adapter
      test/E2E surface keeps working unchanged with `PAYMENTS_ADAPTER=mock`.
- [ ] Checkout UI copy and the `/legal/refunds` page are rewritten to accurately describe the
      additive fee (no more "Includes MUN Hub's platform fee").
- [ ] All edge cases in §6 are handled per their specified behavior.

## 3. Scope

### In Scope
- `GuruPayAdapter` implementing the existing `PaymentsAdapter` interface (`lib/payments/gurupay-adapter.ts`).
- Registry wiring (`lib/payments/registry.ts`) for `PAYMENTS_ADAPTER=gurupay`.
- Fee model change: platform fee becomes additive (student-borne), computed at the same point in
  `initiateRegistration`/`initiateGroupRegistration` fee computation already happens.
- GuruPay order-id generation scheme (caller-generated, unique, idempotent).
- `check-status`-backed webhook trust (folded into `verifyAndParseWebhook`, per decision #3).
- A new scheduled reconciliation job that polls `check-status` for stuck/un-webhooked orders,
  registered in the existing `SCHEDULED_JOBS` array.
- Checkout UI changes: fee line-item display, GuruPay hosted-page redirect flow (GuruPay returns
  a `payment_url` — this is a redirect-based checkout, not an embedded widget like Razorpay
  Checkout.js), CSP allowlist for GuruPay's domain(s).
- `/legal/refunds` and checkout-page copy rewritten for the additive fee.
- Env var wiring (`GURUPAY_API_KEY`, `PLATFORM_FEE_BPS` default change, etc.) via `getRuntimeEnv`.
- Test coverage: unit tests (adapter, fee math), integration tests (webhook route with
  `PAYMENTS_ADAPTER=gurupay`, mocked GuruPay HTTP calls), no changes to existing mock-adapter
  E2E specs.
- Rotation flag for the API key pasted in this session's chat (operational task, not code, but
  called out explicitly as a blocking pre-production step).

### Out of Scope (explicitly deferred — do not build)
- Any payout/settlement execution to organizers (`mun_payment_settings` stays config-only; no
  payout-initiating code is added).
- Any admin-facing "amount owed to organizer" ledger/reconciliation view (confirmed out of scope
  this session — existing `organizerNetAmount`/`mun-analytics.ts` fields already carry the data;
  a future slice can build a view on top without further backend changes).
- Retroactive migration or reclassification of in-flight/already-settled registrations to the new
  fee model. Registrations created before cutover keep whatever fee semantics they were created
  under; no backfill.
- Per-MUN or per-organizer gating/rollout — this is a global, all-MUNs cutover via one env var.
- Refunds (there are none in this product; unchanged).
- GuruPay webhook signature verification (no secret exists; explicitly compensated for by
  `check-status`, not by adding signature verification later in this slice).
- Any change to `mun_payment_settings`, `field-encryption.ts`, or the payout UPI capture flow.
- Rewriting `docs/payments/INTEGRATION.md` in full (a follow-up doc cleanup, noted in §7, not a
  blocking deliverable of this spec).

## 4. Functional Requirements

### 4.1 Happy Path

1. A student reaches `/register/:slug/pay` with a `PENDING`→`PAYMENT_PENDING` registration
   already held (unchanged — `initiateRegistration` already reserves the seat and computes the
   fee-inclusive total before calling `createOrder`).
2. `initiateRegistration` calls `getPlatformFeeRates()` and `computeFeeBreakdownAdditive(...)`
   (see §4.4 — a new function, not a change to the existing `computeFeeBreakdown`'s signature/
   semantics, to avoid silently breaking any other caller — see §12) to get
   `{ passAmount, platformFee, platformFeeTax, totalCharge }`. The registration/payment row's
   `amount` becomes `totalCharge` (what GuruPay actually charges); `organizerNetAmount` becomes
   `passAmount` (the full listed price, unchanged from what the organizer configured).
3. `initiateRegistration` calls `adapter.createOrder({ amount: totalCharge, currency, registrationId })`.
   `GuruPayAdapter.createOrder` generates a unique `order_id` (§4.4 "Order ID generation"), calls
   `POST /api/create-order` with `X-Guru-Key`, and returns `{ orderId }` — the generated id, NOT
   anything read back from GuruPay's response body (GuruPay's `data.order_id` echoes what was
   sent; MUN Hub's own generated value is authoritative either way).
4. The existing second transaction in `initiateRegistration` flips the registration to
   `PAYMENT_PENDING` and inserts the `payments` row exactly as today, with the new amount/fee
   values. **Unchanged code path.**
5. The pay page (`register-pay-page.tsx`) sees `paymentProvider === 'gurupay'` and, instead of
   the mock buttons, redirects the browser to GuruPay's `payment_url` (returned by `createOrder`
   — the checkout payload from `GET /registrations/:id` must include it, see §4.4 endpoint
   contract). This is a full-page redirect flow, not an embedded modal.
6. GuruPay's hosted page collects payment. On completion GuruPay redirects the browser back to
   `callback_url` (a MUN Hub URL, e.g. `https://app.munhub.in/register/:slug/pay?registrationId=…`)
   — **this redirect is never trusted to confirm anything**, it only returns the student to a page
   that polls `GET /registrations/:id` (existing pattern from the Razorpay recipe, §2.4 of
   INTEGRATION.md — reused verbatim).
7. Independently, GuruPay POSTs a webhook to `/webhooks/payments` with
   `{event, order_id, amount, utr, status}`. `processPaymentWebhook` calls
   `adapter.verifyAndParseWebhook(rawBody, headers)`. For GuruPay, this method (a) parses
   `order_id` out of the body (format validation only — this is not trusted data), (b) calls
   `POST /api/check-status` with that `order_id`, (c) builds the normalized `PaymentWebhookEvent`
   **entirely from the `check-status` response**, never from the webhook body's own
   `amount`/`status` fields. If `check-status` itself fails (network error, non-2xx, malformed
   response), `verifyAndParseWebhook` throws `WebhookVerificationError('INVALID_PAYLOAD')` — the
   webhook delivery is NOT acknowledged as processed, so a retry (either GuruPay's own retry, or
   the reconciliation job below) can succeed later.
8. `processPaymentWebhook`'s existing row-lock/dedupe/replay/amount-match logic runs completely
   unchanged and confirms the registration.
9. If no webhook ever arrives, the scheduled reconciliation job (§4.5) independently calls
   `check-status` on any order still unresolved past its age threshold and feeds the same
   normalized event through the same `processPaymentWebhook` path — so a registration is never
   permanently stuck on "we're still waiting for GuruPay."

### 4.2 User Roles and Permissions

No new roles. Unchanged from existing registration/payment permission model:

| Role | Can do | Cannot do |
|------|--------|-----------|
| STUDENT (registrant) | Initiate own registration, pay via GuruPay, view own receipt | See fee breakdown internals beyond the checkout total; access another user's registration |
| ORGANIZER | View aggregate `organizerNet`/`revenue` for their own MUN | See individual student payment provider details beyond what's already exposed; initiate/resolve payment exceptions |
| ADMIN/SUPER_ADMIN/OPERATIONS | View/resolve payment exceptions (unchanged `lib/payments/exceptions.ts`), view platform fee summary reports | Initiate a payout (out of scope) |

### 4.3 Data Model

**No new tables.** All required fields already exist (`payments.amount`,
`payments.platformFeeAmount`, `payments.platformFeeTaxAmount`, `payments.organizerNetAmount`,
`payments.providerOrderId`, `payments.providerPaymentId`, `payments.provider`,
`payment_webhook_events`). Confirm during implementation whether any GuruPay-specific reference
needs a home:

- `utr` (GuruPay's UPI transaction reference, in both `check-status` and the webhook body) has
  no existing column. **Decision needed at implementation time** (flagged in §11, not blocking):
  either (a) store it in `payments.providerPaymentId` (repurposing that column — it's currently
  populated from Razorpay/mock's own payment id, and `utr` serves the same "this is the specific
  charge we settled" role), or (b) add a new nullable `payments.provider_reference` column via a
  migration. **Recommendation: (a), no migration** — `providerPaymentId` is already documented
  generically as "Provider's unique event id" and every consumer (`getRegistrationReceipt`,
  exception listing, receipts) already treats it as an opaque provider reference string, so UTR
  fits without a schema change or call-site updates.

Enum `paymentStatusEnum` values are unchanged (`CREATED`/`PENDING`/`PAID`/`FAILED`/`REFUNDED`).
GuruPay's `payment_status` (`success|pending|failed`) maps to the existing
`PaymentWebhookEventType` (`payment.captured`/`payment.failed`) exactly as described in §4.4.

### 4.4 API Contracts

#### 4.4.1 `GuruPayAdapter` (implements `lib/payments/adapter.ts#PaymentsAdapter`)

```ts
// lib/payments/gurupay-adapter.ts
export const GURUPAY_PROVIDER = 'gurupay'

export function createGuruPayAdapter(config: {
  apiKey: string
  webhookCallbackUrl: string  // e.g. `${API_ORIGIN}/webhooks/payments`
}): PaymentsAdapter
```

- **`createOrder({ amount, currency, registrationId })`:**
  - Generate `order_id` = `mh_${registrationId}_${crypto.randomUUID()}` (or equivalent — must be
    unique per attempt, not per registration, since a failed `createOrder` call followed by a
    retry with the same registration must not collide on GuruPay's side; see §6 "createOrder
    called twice"). Recommendation: reuse the exact random-suffix pattern `mock-adapter.ts`
    already uses (`mock_order_${registrationId}_${Date.now()}`), swapping `Date.now()` for
    `crypto.randomUUID()` to avoid a same-millisecond collision under retry.
  - `POST /api/create-order` with header `X-Guru-Key: <apiKey>`, body:
    `{ amount, order_id, customer_name, callback_url, description, customer_mobile? }`.
    `amount` is GuruPay's float INR value — pass `amount` (whole rupees) directly; confirm
    with GuruPay docs/sandbox whether it expects `149900` (paise-like) or `1499.00` (rupees as
    float) — **this is a real ambiguity in the task's own API description ("amount: float, INR")
    that must be resolved against GuruPay's actual sandbox before writing the adapter**, flagged
    in §11.
  - Timeout: `AbortSignal.timeout(10_000)`, matching the existing Razorpay recipe's stated
    recommendation (no prior fetch-with-timeout convention exists elsewhere in this codebase to
    follow exactly, so this introduces the pattern here).
  - On non-2xx or network failure: throw. `initiateRegistration`'s existing catch block already
    cancels the reservation and returns `PAYMENT_STARTED_FAILED` — no change needed there.
  - Return `{ orderId }` = the generated `order_id` (not `data.order_id` from the response, though
    they should always be equal — GuruPay echoes what was sent).
  - **Additionally returns `paymentUrl`** for the checkout page to redirect to. This is NOT part
    of the existing `PaymentOrder` interface (`{ orderId: string }` only) — see §12 for the
    interface extension this requires (`PaymentOrder.checkoutUrl?: string`, optional so the mock
    adapter and any future embedded-widget adapter aren't forced to supply it).

- **`verifyAndParseWebhook(rawBody, headers)`:**
  1. Parse `rawBody` as JSON; validate it has at minimum a non-empty string `order_id` (reject
     with `WebhookVerificationError('INVALID_PAYLOAD')` if not — this is the only structural
     check performed on the webhook body itself, since nothing in it is trusted for the actual
     outcome).
  2. Call `POST /api/check-status` with `{ order_id }` and the same `X-Guru-Key` header.
  3. On a non-2xx/network/timeout error from `check-status`: throw
     `WebhookVerificationError('INVALID_PAYLOAD')` — NOT `INVALID_SIGNATURE` (there is no
     signature to be invalid; this reads as "we can't yet verify this," which correctly leaves
     the event unprocessed, per `processPaymentWebhook`'s "not found"/error handling that never
     marks unresolved deliveries as processed).
  4. Map `check-status`'s `data.payment_status` to `PaymentWebhookEventType`:
     `success → 'payment.captured'`, `failed → 'payment.failed'`, `pending → return null`
     (authentic, but not an event that changes anything yet — matches `processPaymentWebhook`'s
     existing "ignored" contract for events that aren't ready to settle).
  5. Build the normalized event from **`check-status`'s response fields only**:
     `providerOrderId: data.order_id`, `providerPaymentId: data.utr ?? null`,
     `amount: data.amount` (GuruPay's `check-status` amount — same rupee-vs-paise ambiguity as
     `createOrder`, must be resolved consistently), `currency: data.currency`,
     `occurredAt: data.paid_at ? new Date(data.paid_at) : new Date()`, `eventId`: see below,
     `signedAt: null` (no signed delivery timestamp exists at all for GuruPay — replay protection
     rests entirely on `(provider, eventId)` dedupe, exactly like the documented Razorpay
     rationale in INTEGRATION.md §2.5 "Why signedAt is null").
  6. **`eventId` derivation** — GuruPay's webhook body has no explicit unique event id, and
     `check-status` is not itself an "event," it's a snapshot. Use
     `` `${data.order_id}:${data.payment_status}:${data.utr ?? 'none'}` `` as the dedupe key.
     This means: a `pending`→`success` transition is a distinct event from any prior `pending`
     state (fine, `pending` returns `null` and is never dedup-claimed), and a `check-status` call
     from the reconciliation job that returns the same `success`+`utr` as an already-processed
     webhook naturally dedupes as `DUPLICATE_CAPTURE`/already-processed — which is exactly the
     desired idempotency between webhook delivery and the reconciliation poll racing each other.

#### 4.4.2 `check-status` reconciliation job

```ts
// lib/jobs/reconcile-gurupay-orders.ts
export const reconcileGuruPayOrdersJob: ScheduledJob = {
  name: 'reconcileGuruPayOrders',
  async run({ now }) { ... }
}
```

- Selects `payments` rows where `provider = 'gurupay'`, `status IN ('PENDING')`, and
  `createdAt < now - RECONCILE_MIN_AGE_MS` (see §6 for the exact age threshold decision — must be
  long enough that a webhook has had a fair chance to arrive, short enough that a stuck order is
  caught within the same 15-minute reservation TTL it's racing against).
- For each such row (bounded batch size, e.g. 50 per run, to keep one job run fast under the
  5-minute cron), builds a synthetic webhook-shaped call: invokes the exact same
  `adapter.verifyAndParseWebhook`-equivalent logic (recommend factoring GuruPay's
  `checkOrderStatus(orderId)` as its own exported function that both `verifyAndParseWebhook` and
  this job call, rather than the job fabricating a fake `rawBody`/`Headers` pair to hand to
  `verifyAndParseWebhook` — cleaner, avoids serialization round-tripping for no reason) and, if it
  yields a non-null `PaymentWebhookEvent`, calls `processPaymentWebhook`'s core apply-event logic.
  **This requires exporting a slightly lower-level entry point from `lib/payments/webhook.ts`**
  (see §7/§12) since `processPaymentWebhook`'s public signature takes `(adapter, rawBody, headers)`
  and re-parses — the job already has a normalized event, not raw bytes. Recommend adding
  `processNormalizedPaymentEvent(adapter, event, now)` as an internal export, with
  `processPaymentWebhook` becoming a thin wrapper that parses/verifies and delegates to it. This
  is the one non-additive (refactor-shaped) change touching the existing webhook module — kept
  deliberately minimal (extract, don't rewrite).
- Registered in `SCHEDULED_JOBS` (`lib/jobs/registry.ts`), runs on the existing 5-minute cron —
  no new cron trigger, no new wrangler config.
- Idempotent by construction (same guarantee every `ScheduledJob` already requires): running it
  twice, or overlapping with a webhook delivery for the same order, converges to the same end
  state via the existing dedupe/row-lock logic.

#### 4.4.3 `GET /registrations/:id` (existing route, extended payload)

```
Response 200 (existing shape, extended):
{
  ...,
  paymentProvider: "gurupay" | "mock" | null,
  checkout: {
    // Only present when paymentProvider === "gurupay" and status is PAYMENT_PENDING
    paymentUrl: string,
    orderId: string,
    amount: number,       // whole rupees, includes fee
    currency: string,
    expiresAt: string     // ISO — GuruPay's own order expiry, see §4.5/§6
  } | null
}
```

### 4.5 GuruPay order expiry vs. MUN Hub's reservation TTL

GuruPay's `create-order` response includes `expires_at`. MUN Hub's own seat hold
(`RESERVATION_TTL_MS = 15 minutes`) is independent and already enforced entirely server-side
(`registrations.expiresAt`, swept by `releaseExpiredHoldsJob`/the lazy sweep). **Decision:
MUN Hub's own TTL is authoritative; GuruPay's `expires_at` is informational only, not
synchronized or set as a request parameter** (the documented `create-order` request has no field
to configure it — it appears to be GuruPay's own fixed/default policy). This is confirmed
sufficient without changes because `processPaymentWebhook`'s existing `holdExpired` check already
handles "payment captured after our own hold expired" as `PAYMENT_AFTER_HOLD_EXPIRED` regardless
of what GuruPay's own expiry says — the two TTLs never need to agree, they're independently
correct. If GuruPay's page expires BEFORE MUN Hub's 15-minute hold, the student simply can't pay
on a dead GuruPay page and must restart (existing "seat hold expired" UI already covers this if
the student navigates back).

## 5. UX Specification

### Loading States
- Checkout page: while `createOrder` is in flight (part of the existing `initiateRegistration`
  call, already synchronous with registration creation) — no new loading state beyond what
  exists today for "reserving your seat."
- After redirect to GuruPay: entirely GuruPay's own hosted-page UX, out of MUN Hub's control.
- On return from GuruPay (`callback_url`): the existing pay-page polling pattern from
  INTEGRATION.md §2.4 (poll `GET /registrations/:id` every ~2s for up to ~30s) — reused verbatim,
  replacing the current mock-buttons branch.

### Success States
- `CONFIRMED` within the poll window → navigate to `/register/:slug/confirmation` (existing route,
  unchanged).
- Still `PAYMENT_PENDING` after the poll window → land on the confirmation page anyway, showing
  "Payment still processing — refresh" (existing copy per INTEGRATION.md's documented pattern;
  confirm this exact copy exists already in `register-confirmation-page.tsx` or needs adding).

### Error States
- GuruPay redirect returns to `callback_url` with no clear success signal (GuruPay's docs don't
  specify redirect query params) → treat identically to "still PAYMENT_PENDING," i.e. always poll,
  never parse redirect query params as a trust signal.
- `check-status` unreachable when a webhook arrives → webhook left unprocessed (§4.4.1 step 3);
  student sees "still processing" until the reconciliation job or a GuruPay webhook retry
  succeeds; **no distinct user-facing error state is needed** since this is designed to
  self-heal within minutes.
- Checkout total display: replace "Includes MUN Hub's platform fee" with an itemized breakdown —
  **exact copy needed, see §11 open question** (e.g. "Registration: ₹1,499 · Platform fee (incl.
  GST): ₹114 · Total: ₹1,613") so a student isn't confused about why the charge exceeds the
  MUN's listed price.

### Empty States
- Not applicable (no list views introduced).

## 6. Edge Cases and Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Webhook arrives before `check-status` would return anything meaningful (race with GuruPay's own settlement) | `check-status` returns `pending` → adapter returns `null` → webhook acknowledged as ignored (200), nothing changes. The reconciliation job or a later webhook retry catches the eventual `success`/`failed`. |
| `check-status` itself times out or 5xxs | Webhook delivery is NOT marked processed (`WebhookVerificationError`), so GuruPay's own retry (if any) or the reconciliation job resolves it later. No registration is confirmed or failed on missing information. |
| GuruPay sends a webhook for an `order_id` MUN Hub never created (foreign/garbage data) | `check-status` for an unknown `order_id` presumably 404s/errors at GuruPay — treat as `INVALID_PAYLOAD` (not found), never processed, logged. If `check-status` DOES return data for it, `processPaymentWebhook`'s existing `UNKNOWN_ORDER` path (payment row not found by `providerOrderId`) still protects against it. |
| Two webhook deliveries for the same order (GuruPay's own retry behavior, undocumented but assumed to exist) | Both trigger independent `check-status` calls (no caching) — wasteful but safe: the second normalized event dedupes via `(provider, eventId)` from the same `order_id:status:utr` triple, existing `DUPLICATE_CAPTURE`/duplicate handling applies unchanged. |
| Reconciliation job and an inbound webhook fire concurrently for the same order | Both resolve to the same `eventId` (deterministic from `check-status`'s own response) and the same row lock in `applyEvent` — whichever claims the `payment_webhook_events` row first wins; the second sees it already processed and returns duplicate. No double-confirm possible (same guarantee the existing dedupe already provides for any two concurrent webhook deliveries). |
| Order stuck in `PENDING` (GuruPay never responds success/fail/pending — e.g. student abandoned the hosted page) past the registration's 15-minute hold | The existing `releaseExpiredHoldsJob` cancels the registration at 15 minutes regardless of GuruPay's status. If GuruPay later reports `success` for a now-cancelled/expired hold, existing `holdExpired`/`PAYMENT_AFTER_HOLD_EXPIRED` exception logic applies unchanged — money is accounted for, seat is not resurrected, admin resolves manually. |
| `createOrder` succeeds at GuruPay but MUN Hub's own network call to record the response fails/times out (partial failure) | Existing `initiateRegistration` try/catch treats any `createOrder` failure (including a timeout where GuruPay may have actually created the order) as a hard failure: registration is cancelled, student is told to retry. **This can create an orphaned GuruPay order with no MUN Hub registration behind it** — acceptable per the existing "no refunds" model IF no money was actually charged (an order alone, unpaid, is inert); if the student then somehow pays that orphaned order anyway (unlikely — they were never given the `payment_url`), the reconciliation job would never poll it (no `payments` row exists to key off), and the webhook would land as `UNKNOWN_ORDER`/404 with no possible resolution besides a manual admin lookup at GuruPay directly. Documented as an accepted small residual risk, not fixed in this slice (fixing it would require a webhook-independent "unclaimed order" table, out of scope). |
| GuruPay's `amount` in `check-status`/webhook doesn't match `payments.amount` (rupee/paise unit mismatch bug, or a genuine gateway-side discrepancy) | Existing `amountMatches` check in `applyEvent` catches this and raises `AMOUNT_MISMATCH` — critically, **this is also the safety net if the rupee-vs-paise ambiguity in §4.4.1 is resolved incorrectly during implementation**: a systematic unit-scale bug would make EVERY GuruPay payment raise `AMOUNT_MISMATCH` rather than silently mis-charging, which is the intended fail-safe (must be caught in the integration test plan, §9). |
| Student's session expires mid-checkout (after redirect to GuruPay, before returning) | Unaffected — the registration and payment rows are keyed by `registrationId`/`userId`, not session state. On return, `GET /registrations/:id` requires `requireAuth`; if the session expired, the student is redirected to log in, then can view the registration again (ownership check unchanged). Payment confirmation itself never depends on an active browser session — the webhook/reconciliation path is fully server-to-server. |
| Multiple browser tabs open on the same pay page | No new risk — `initiateRegistration`'s existing idempotency-key + unique-active-registration-per-user checks already prevent a duplicate order from a second `POST /registrations`; a second tab merely re-polls the same registration id. |
| Double-submit: student clicks "Pay" twice before the first redirect completes | The redirect happens client-side after `initiateRegistration`/`createOrder` already succeeded server-side (order+payment row exist); a second click on the same already-`PAYMENT_PENDING` registration should be a no-op re-render, not a second `createOrder` call — **implementation must ensure the pay page does not call `initiateRegistration` again on a re-render/re-click; it only ever redirects to the already-stored `checkout.paymentUrl`**. Flagged as an implementation-must-verify item, not a new backend guard (the backend idempotency key already prevents a second registration; this is purely a frontend double-call risk). |
| Zero/empty: a free pass (`total === 0`) | Unchanged — `free` path in `initiateRegistration` bypasses the payments adapter entirely, confirms immediately. GuruPay is never invoked for a ₹0 total. |
| Maximum: a very large registration total (e.g. a big group/delegation registration) | No currency ceiling is documented by GuruPay in the task brief — **flagged as an open question for GuruPay's own transaction limits** (§11); the existing `computeFeeBreakdown`-family functions already guard against `amount` overflow/non-integer input, so the only new risk is an unknown GuruPay-side cap silently rejecting the `create-order` call, which surfaces as an ordinary `createOrder` failure (existing "couldn't start your payment" error), not a new failure mode. |
| Platform fee rate misconfigured (e.g. `PLATFORM_FEE_BPS` not set, or `getPlatformFeeRates()` throws) | Existing behavior preserved: `computeFeeBreakdown*`-family throws before any seat is reserved — "a bad deploy config should fail loudly at checkout, before any seat is held." Default `PLATFORM_FEE_BPS` must be updated from `0` to `650` in `.env.example` and every deployed Worker's vars as part of this rollout (§7) — an unset default would silently charge the student nothing, which is a correctness bug for a "full immediate replacement" rollout, not a safe fallback. |
| Rounding: fee/tax computation lands on a value where `organizerNet` (in the additive model, the full listed price with no subtraction) needs to reconcile against `totalCharge` | Additive model rounding rule (§4.4/§0 differs from the existing subtractive one): `platformFee = roundHalfUp(passAmount × feeBps / 10000)`, `platformFeeTax = roundHalfUp(platformFee × taxBps / 10000)`, `totalCharge = passAmount + platformFee + platformFeeTax` (addition, not subtraction — no remainder-absorption ambiguity exists in the additive direction: `organizerNetAmount = passAmount` exactly, always, by construction, never derived by subtracting from `totalCharge`). This is a cleaner invariant than the current subtractive model and should be called out as intentional in the code comment replacing `fees.ts`'s current header doc. |
| Test suite accidentally hitting real GuruPay | Structurally prevented the same way Razorpay would have been: `PAYMENTS_ADAPTER=gurupay` requires `GURUPAY_API_KEY` to be set via `getRuntimeEnv`/`process.env`; `.env.test` (committed, mock-only values) never sets it, so `getPaymentsAdapter()` returns `null` for `gurupay` in every test run unless a test explicitly stubs `fetch`/the adapter module. All GuruPay-specific unit tests must stub `fetch` (or an injected HTTP client) — never make a real network call, per this codebase's existing `razorpay-adapter.test.ts` plan in INTEGRATION.md §2.6 ("stubbed fetch"). Integration tests use a recorded/stubbed `check-status` response, not live GuruPay. |

## 7. Files to Modify

### New Files to Create
| File path | Purpose |
|-----------|---------|
| `lib/payments/gurupay-adapter.ts` | `createGuruPayAdapter()` implementing `PaymentsAdapter`; `createOrder`, `verifyAndParseWebhook`, exported `checkOrderStatus(orderId)` helper reused by the reconciliation job |
| `lib/payments/gurupay-adapter.test.ts` | Unit tests: order-id generation/uniqueness, `createOrder` request shape with stubbed fetch, `check-status` mapping (success/pending/failed), timeout/error handling, amount-unit assumption test (see §11) |
| `lib/jobs/reconcile-gurupay-orders.ts` | `reconcileGuruPayOrdersJob: ScheduledJob` — polls `check-status` for stale `gurupay` `PENDING` payments |
| `lib/jobs/reconcile-gurupay-orders.test.ts` | Job tests, following `release-expired-holds.test.ts`'s pattern (idempotency, age threshold, batch bound) |
| `lib/payments/fees-additive.ts` (or extend `fees.ts` — see §12) | `computeFeeBreakdownAdditive(passAmount, rates)` — new function, additive semantics, does not change `computeFeeBreakdown`'s existing signature/behavior |
| `lib/payments/fees-additive.test.ts` | Unit tests: exact worked examples (e.g. the ₹1,499 → fee 97 → tax 17 → total ₹1,613 case from this spec's math verification), boundary (₹0 — never reached in practice since free path bypasses this, but should not throw), large amounts |
| `server/integration/gurupay-webhook.integration.test.ts` | Full webhook route test with `PAYMENTS_ADAPTER=gurupay`, stubbed `check-status`, following `payments.integration.test.ts`'s pattern |
| `web/src/components/registration/gurupay-checkout-redirect.tsx` | Replaces the mock buttons branch in `register-pay-page.tsx` when `paymentProvider === 'gurupay'`: shows the fee-itemized total, then redirects to `checkout.paymentUrl` |

### Existing Files to Modify
| File path | Change required |
|-----------|----------------|
| `lib/payments/registry.ts` | Add `case 'gurupay':` returning `createGuruPayAdapter(...)` only when `GURUPAY_API_KEY` is present (via `getRuntimeEnv`), else `null` |
| `lib/payments/adapter.ts` | Extend `PaymentOrder` with optional `checkoutUrl?: string` (see §12) |
| `lib/payments/webhook.ts` | Extract `processNormalizedPaymentEvent(adapter, event, now)` from `processPaymentWebhook` so the reconciliation job can call it directly without re-serializing a fake webhook body (see §4.4.2, §12) |
| `lib/actions/registration.ts` | Swap `computeFeeBreakdown` call for `computeFeeBreakdownAdditive` in both `reserveAndStartPayment` and `reserveGroupAndStartPayment`; `payments.amount`/registration `total` becomes `totalCharge` instead of the pass price alone |
| `lib/jobs/registry.ts` | Add `reconcileGuruPayOrdersJob` to the `SCHEDULED_JOBS` array |
| `server/routes/registrations.ts` | `GET /registrations/:id` — add the `checkout` object (§4.4.3) to the response when `paymentProvider === 'gurupay'` and status is `PAYMENT_PENDING` |
| `web/src/api/registration.ts` | Extend the registration response type with `checkout: {...} | null`; export a `GURUPAY_PROVIDER` constant mirroring `MOCK_PAYMENT_PROVIDER` |
| `web/src/pages/register/register-pay-page.tsx` | Branch on `provider === 'gurupay'` to render the new redirect component instead of falling into the "not available" branch; update the "Includes MUN Hub's platform fee" copy to an itemized breakdown for both mock and gurupay (or gate old copy to mock only — see §11) |
| `web/src/pages/legal/refund-policy-page.tsx` | Rewrite "Our platform fee" section: fee is additive and shown at checkout, not included in the listed price |
| `.env.example` | Add `GURUPAY_API_KEY`, change `PAYMENTS_ADAPTER` default guidance to mention `gurupay`, update `PLATFORM_FEE_BPS` default from `0` to `650`, remove or repurpose the unused Razorpay placeholder block |
| `server/wrangler.jsonc` | `PAYMENTS_ADAPTER: "gurupay"` under `vars`; document `GURUPAY_API_KEY` as a `wrangler secret put` value (never in `vars`) |
| CSP/security-headers config (wherever Razorpay's domains would have been added per INTEGRATION.md §2.1 step 6 — locate the actual file, likely under `server/middleware/` or a web security-headers module) | Allow `frame-src`/`connect-src`/redirect to GuruPay's checkout domain(s) — **exact domain(s) needed from GuruPay's docs, flagged in §11** |
| `docs/payments/INTEGRATION.md` | Add a header note pointing to this spec/GuruPay as the actual shipped provider; the Razorpay content can stay as historical reference or be removed — user's call, not blocking |

### Files to Read for Context (do not modify)
| File path | Why it's relevant |
|-----------|------------------|
| `lib/payments/mock-adapter.ts` | Pattern to mirror for order-id generation, webhook body shape, `simulatePaymentOutcome`-style test helper conventions |
| `lib/jobs/release-expired-holds.ts` | Pattern for a `ScheduledJob` implementation, idempotency, batch-safe design |
| `lib/actions/mun-analytics.ts`, `lib/actions/organizer-dashboard.ts` | Confirms organizer-facing revenue/net fields already correctly separate gross from net — no changes needed there once `organizerNetAmount` is populated correctly |
| `lib/actions/admin-reporting.ts` | `getGeographyBreakdown`/`getPlatformFeeSummary` — "revenue" here will now mean gross-including-fee for new rows; documented as an accepted semantic shift in §11, not a code change |
| `web/src/pages/organizer/dashboard/sections/analytics-page.tsx` | Confirmed already labeled safely ("Net to you" / "Collected") — verify no copy change needed here specifically |

## 8. Wiring Checklist

- [ ] `lib/payments/registry.ts` — add the `gurupay` case, reading `GURUPAY_API_KEY` via `getRuntimeEnv`
- [ ] `lib/jobs/registry.ts` — add `reconcileGuruPayOrdersJob` to `SCHEDULED_JOBS`
- [ ] `lib/actions/registration.ts` — import and call `computeFeeBreakdownAdditive` instead of `computeFeeBreakdown` in both solo and group reservation paths
- [ ] `server/routes/registrations.ts` — include `checkout` in the `GET /registrations/:id` response shape when applicable
- [ ] `web/src/api/registration.ts` — extend the parsed response type and export the new provider constant
- [ ] `web/src/pages/register/register-pay-page.tsx` — import and render the new GuruPay redirect component; branch logic updated
- [ ] `.env.example` — `GURUPAY_API_KEY="REPLACE_WITH_LIVE_KEY"` documented as **must be set via secret manager/Workers secret, never committed**; `PLATFORM_FEE_BPS="650"` as the new default
- [ ] `server/wrangler.jsonc` — `vars.PAYMENTS_ADAPTER = "gurupay"`; a comment directing to `wrangler secret put GURUPAY_API_KEY`
- [ ] CSP/security headers — GuruPay checkout domain(s) allowlisted (domain TBD, §11)
- [ ] `docs/payments/INTEGRATION.md` — header note added pointing to this spec as the shipped implementation
- [ ] **Operational, not code:** rotate the GuruPay API key that was pasted in plaintext in this session's chat transcript before go-live — it must be treated as compromised. The rotated key is the one that goes into the Workers secret, never the one from this transcript. (Redacted from this doc — do not re-paste the literal key value into any committed file.)

## 9. Testing Requirements

### Unit Tests
- [ ] `computeFeeBreakdownAdditive`: exact worked example (₹1,499 → 97/17/1613), zero amount, large amount, misconfigured rates throw
- [ ] `GuruPayAdapter.createOrder`: correct request shape/headers with stubbed `fetch`, unique order-id generation across repeated calls for the same `registrationId`, non-2xx response throws, timeout throws
- [ ] `GuruPayAdapter.verifyAndParseWebhook`: `pending` → `null`; `success` → correctly mapped captured event with `check-status` fields only (webhook body's own `amount`/`status` deliberately NOT used even if they differ from `check-status` — write a test that a forged webhook body with a fake `amount`/`success` status is IGNORED in favor of what `check-status` actually returns); `failed` → mapped failed event; `check-status` network/5xx error → `WebhookVerificationError('INVALID_PAYLOAD')`; malformed webhook body (no `order_id`) → `WebhookVerificationError('INVALID_PAYLOAD')` without ever calling `check-status`
- [ ] `reconcileGuruPayOrdersJob`: only polls `gurupay` payments past the age threshold; caps batch size; running twice back-to-back doesn't double-process; a payment resolved by a webhook mid-run is skipped/no-ops safely

### Integration Tests
- [ ] `POST /webhooks/payments` with `PAYMENTS_ADAPTER=gurupay`, stubbed `check-status` returning `success` → registration `CONFIRMED`, payment `PAID`, `organizerNetAmount` equals the listed price exactly, `amount` equals `totalCharge`
- [ ] Same, `check-status` returning `failed` → registration `CANCELLED`, seat released
- [ ] `check-status` returning an amount mismatched from the stored payment row → `AMOUNT_MISMATCH` exception, registration untouched
- [ ] Duplicate webhook delivery for an already-confirmed order → `{duplicate: true}`, no state change
- [ ] `POST /registrations` with a paid pass under `PAYMENTS_ADAPTER=gurupay` (stubbed `createOrder`) → registration `PAYMENT_PENDING`, payment row has correct fee split, `GET /registrations/:id` returns the `checkout` object
- [ ] Unset `GURUPAY_API_KEY` → paid registration refused with `503 PAYMENTS_UNAVAILABLE` (existing behavior, must still hold)
- [ ] Free pass under `PAYMENTS_ADAPTER=gurupay` → confirmed immediately, GuruPay never called (assert on the stubbed fetch mock never being invoked)

### E2E Tests (if applicable)
- [ ] Existing mock-adapter E2E specs (`E2E/specs/student/payments.spec.ts`, `E2E/specs/admin/registrations-payments.spec.ts`, `E2E/specs/security/payments.spec.ts`) continue to pass unchanged with `PAYMENTS_ADAPTER=mock` — explicit regression check, not new tests
- [ ] No new E2E spec drives a real GuruPay checkout (would require real money/sandbox credentials in CI — out of scope; a manual go-live checklist item instead, §10)

### Coverage Target
80% minimum on new files (`gurupay-adapter.ts`, `reconcile-gurupay-orders.ts`, `fees-additive.ts`).

## 10. Non-Functional Requirements

- **Performance:** `createOrder`/`check-status` calls must have a hard timeout (10s recommended,
  matching the documented Razorpay recipe) so a hung GuruPay endpoint never hangs a registration
  request or a webhook response beyond what the provider's own retry tolerance expects.
- **Security:** `GURUPAY_API_KEY` via `getRuntimeEnv` only, stored as a Workers secret
  (`wrangler secret put`), never in `wrangler.jsonc` vars, never in `.env.example` beyond a
  placeholder. No webhook signature exists — this is a known, accepted reduction in cryptographic
  trust for this provider, compensated for entirely by the mandatory `check-status` call; this
  tradeoff must be stated explicitly in `docs/payments/INTEGRATION.md`'s (or its GuruPay
  replacement's) security notes so a future reviewer doesn't mistake the missing signature check
  for an oversight.
- **Accessibility:** No new interactive UI beyond a redirect and a fee-breakdown text block —
  standard semantic HTML/existing design-system components suffice, no dedicated a11y audit
  beyond what the existing pay page already passed.
- **Feature flag:** None — `PAYMENTS_ADAPTER=gurupay` itself is the flag (existing mechanism).
- **Observability:** Log every `createOrder` failure, every `check-status` failure (with
  `order_id`, never the API key), every reconciliation job run's summary counts
  (`{polled, resolved, stillPending}`), following the existing `[payments]`-prefixed console log
  convention used throughout `lib/payments/webhook.ts`.

## 11. Open Questions

These need an answer before or during implementation — flagged rather than blocking spec
completion, since none of them changes the architecture above, only specific values/copy:

1. **GuruPay amount units** — is `amount` in `create-order`/`check-status` whole rupees (float,
   e.g. `1499.00`) or paise-like minor units? The task's own API description says "amount (float,
   INR)" which reads as rupees, but this MUST be confirmed against GuruPay's actual sandbox
   response before writing `gurupay-adapter.ts` — a wrong assumption here is exactly the scenario
   the `AMOUNT_MISMATCH` safety net (§6) exists to catch, but it's better resolved before ship.
   *Who decides: implementer, verified against GuruPay's sandbox/docs directly.*
2. **GuruPay's checkout domain(s)** for CSP `frame-src`/`connect-src`/redirect allowlisting — not
   in the API docs excerpt given to this session. *Who decides: implementer, from GuruPay's full
   docs or a sandbox test.*
3. **Exact checkout fee-breakdown copy** ("Registration: ₹X · Platform fee (incl. GST): ₹Y ·
   Total: ₹Z" is a placeholder in this spec, not final UX copy). *Who decides: user/product,
   possibly delegate to a design-critic pass once implemented, per this project's CLAUDE.md
   review-agent conventions.*
4. **`utr` storage** — confirmed recommendation is repurposing `payments.providerPaymentId`
   (§4.3), no migration. *Who decides: implementer; flag for a quick user confirmation since it's
   a judgment call, not purely mechanical.*
5. **GuruPay transaction limits** (max amount per order) — unknown; only matters for very large
   group/delegation registrations. *Who decides: confirm with GuruPay's docs; not blocking since
   failure mode is an ordinary "couldn't start payment" error either way.*
6. **`RECONCILE_MIN_AGE_MS` exact value** for the reconciliation job (§4.4.2) — recommend 3
   minutes (comfortably inside the 5-minute cron cadence and the 15-minute reservation TTL, while
   giving a normal webhook delivery time to arrive first so the job isn't racing every single
   payment). *Who decides: implementer default is fine; revisit if reconciliation load/GuruPay
   rate limits become a concern.*
7. **Should the mock adapter's own checkout copy also switch to itemized fee display**, or does
   only GuruPay show the new breakdown (leaving the mock's simplified "no real card charged"
   messaging as-is since it's dev/test-only)? Recommendation: update both for consistency (the
   fee math is identical regardless of provider), but confirm — this affects whether
   `fees-additive.ts`'s function is called for the mock path too. *Who decides: user; low-stakes,
   pick a default and move on if not answered.*

## 12. Implementation Notes

- **Do not modify `computeFeeBreakdown`'s existing signature or subtractive semantics.** It may
  still be referenced by historical data/tests and its doc comment is precise about the
  subtractive model. Add `computeFeeBreakdownAdditive` as a new, separate, clearly-named function
  in the same file or a sibling file (`lib/payments/fees-additive.ts`) — the implementer should
  decide which based on how much the two functions can share (likely just `applyBps`/`assertBps`,
  which should be exported/shared rather than duplicated).
- **`PaymentOrder` interface extension is additive, not breaking.** Adding an optional
  `checkoutUrl?: string` field means the mock adapter's existing `{ orderId }` return value stays
  valid without any change to `mock-adapter.ts`.
- **The `processPaymentWebhook`/`processNormalizedPaymentEvent` extraction (§4.4.2) is the one
  place this spec asks for a refactor of already-shipped, well-tested code.** Do this
  conservatively: extract the existing transaction body into the new function with no logic
  changes, then make `processPaymentWebhook` call it after the existing verify/replay-window
  steps. Run the full existing `webhook.test.ts` suite unchanged afterward as the regression
  check — if any existing test needs to change to make this pass, that's a signal the extraction
  altered behavior and must be reverted and redone.
- **Follow `docs/payments/INTEGRATION.md`'s structure for whatever replaces/supplements it** —
  its file-by-file, environment-variable-table, go-live-checklist format is a good template;
  this spec deliberately mirrors that structure's information architecture even though the
  content deviates in the four ways listed in §0.
- **Never read `GURUPAY_API_KEY` via `process.env` anywhere in `/server` or `/lib`** — this is
  the single most-repeated, most-costly mistake pattern in this codebase's own history
  (`CLAUDE.md`'s "Cloudflare Hyperdrive bridge"/"runtime-env" sections document two prior
  production incidents from exactly this mistake with other env vars). `getRuntimeEnv` only.
- **Do not cache the GuruPay adapter instance or any HTTP client at module scope** — same
  Workers-request-scoping rule that caused the `lib/db/client.ts` production incident documented
  in `CLAUDE.md`. `createGuruPayAdapter(config)` should be called fresh per `getPaymentsAdapter()`
  invocation (which is already called per-request, per the existing registry doc comment), or at
  minimum must not hold any request-scoped state.
- **API key handling for this session specifically:** the key that appeared in chat must never be
  committed to any file in this repo (including `.env.example`, which should only ever contain a
  placeholder). Treat it as already compromised; the real key used in any deployed environment
  must be a freshly rotated one, set only via `wrangler secret put GURUPAY_API_KEY` (production)
  or a local, gitignored `.env`/`server/.env` (development).
