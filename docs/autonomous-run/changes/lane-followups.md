# Lane: followups (migration slot 0035)

Post-merge follow-ups picked up after every launch lane landed. Branch
`worktree-agent-a37c90ae83b30df3e`, 11 commits + one merge of `main`.

## What landed

### 1. Audit actions — migration 0035 (`24d7876`)

`drizzle/0035_audit_actions_and_refund_doc_cleanup.sql` adds ten
`admin_action` values and, in the same transaction (no new value is used
there), deletes the seeded demo refund-policy documents:
`DELETE FROM mun_documents WHERE kind = 'REFUND_POLICY' AND storage_key LIKE 'seed/%'`
— seeded rows only, never an organizer's own upload.

New values and their call sites, all of which used to store the closest
older value with the real name in `metadata`:

| Value | Call site | Was |
|---|---|---|
| `PAYMENT_EXCEPTION_RESOLVED` | `lib/payments/exceptions.ts#resolvePaymentException` | `PAYMENT_DETAILS_CHANGED` + `metadata.kind` |
| `STAFF_CREATED`, `STAFF_ROLE_CHANGED`, `STAFF_SUSPENDED`, `STAFF_REINSTATED`, `STAFF_SET_PASSWORD_LINK_ISSUED`, `SUPER_ADMIN_BOOTSTRAPPED` | `lib/actions/admin-staff.ts` | `USER_SUSPENDED` / `ORGANIZER_REINSTATED` + `metadata.event` |
| `STAFF_MFA_RESET` | `lib/actions/staff-mfa.ts#resetStaffMfa` | `ORGANIZER_REINSTATED` + `metadata.event` |
| `PII_READ` | `lib/actions/admin-pii-read.ts` | a `console.info` line only |
| `ACCOUNT_DELETED` | `lib/actions/account-deletion.ts` | a `console.info` line only |

`metadata.event` is still written (now repeating the action name), because
rows from before 0035 carry the precise name only there, and both audit
feeds read `coalesce(metadata->>'event', action)`. Rewriting those old rows
would need a second migration (a new enum value can't be used in the
transaction that adds it) — not done; noted below.

Self-service account deletion now writes its audit row inside the deletion
transaction, with the deleted account itself as the actor (its anonymized
`users` row stays, so the FK holds) and counts only, no personal data.

### 2. PII reads are audit rows, not log lines (`ae6a748`)

`recordPiiRead` writes one `admin_actions` row per staff read of delegate
data, awaited before the response so the row exists before the data leaves,
and never throwing (a failed insert falls back to an error log line).

- one record read → `targetType` = the record type, `targetId` = its id, so
  it shows in that record's audit trail;
- list read → `targetType` = `<type>_list`, `targetId` = the route pattern,
  ids in `metadata.targetIds`;
- a read that returned nothing writes nothing.

`GET /admin/payment-exceptions` is recorded too (it returns delegate names
and emails) — the gap the admin lane flagged. `lib/audit/log.ts` now accepts
`db` as well as a transaction, for rows that record a read.

The platform feed leaves `PII_READ` out unless `?includeDataAccess=true`
(a checkbox on `/admin/audit`), so one row per list page load can't bury the
changes. Audit links now encode their target, since a list read's id is a
route pattern.

### 3. Seat-hold-expired email from the lazy sweep (`1d64be4`)

`lib/actions/registration.ts`'s per-product/per-MUN sweeps and the
availability read share one helper that reads the expired holds, releases
them with a status/expiry re-check (so a hold confirmed or released
concurrently is left alone and never emailed twice), and emails the released
`PAYMENT_PENDING` holds that expired within the last hour — the same rule
and sender (`notifyExpiredCheckouts`, now exported) as the five-minute cron
job, so a hold gets the email from whichever releases it first.

New `lib/runtime-background.ts#runInBackground`: starts post-commit work
that never rejects, logs failures, and hands the promise to the request's
`waitUntil` through an `AsyncLocalStorage` bridge
(`server/middleware/wait-until.ts`, registered after the hyperdrive
middleware). Workers therefore doesn't drop the send, and a page load
doesn't wait for mail. Outside a request (Node dev, tests, cron) the work
simply runs; the returned promise makes it awaitable in tests.

### 4. Welcome email — **not done, by instruction**

The lead reassigned `notifyWelcome` to the delegate-UX agent mid-run. No
signup code was touched here.

### 5. Organizer revenue is net, with gross beside it (`5752996`)

`getMunAnalytics` and `getMunOverview` return the organizer's net
(`coalesce(payments.organizer_net_amount, payments.amount)`) next to gross,
and count money only from PAID payments on standing registrations
(`CONFIRMED`/`ATTENDED`/`NO_SHOW`) — a late payment on a released seat is a
payment exception, not revenue. That matches the finance page's summary, so
the two pages agree. (At the merge this was combined with main's new
`countedPaymentsFilter()`, which drops mock-checkout rows; the two filters
are orthogonal and both apply.)

The analytics page leads with **Net to you** and keeps gross as
**Collected**, in the totals and per pass, with a caption explaining both.

### 6. Admin results review (`7528b7d`)

- `GET /admin/muns/:munId/results` → `getResultsForReview` (results state +
  every award, `OPERATIONS`/`ADMIN`/`SUPER_ADMIN`, recorded as a PII read;
  the organizer-facing reads use `assertOwnsOrAdmin`, which excludes
  OPERATIONS).
- A **Results review** section on `/admin/muns/:munId` while the MUN is
  `RESULTS_PENDING` or `RESULTS_UNDER_REVIEW`: the awards with their
  winners, when they were submitted, the last return note, and an approve /
  request-changes dialog (a note is required to request changes) on the
  existing `POST .../results/review`.
- "Mark completed" is no longer offered from `RESULTS_UNDER_REVIEW` in the
  UI: approving the results completes the MUN *and* verifies its awards,
  where the lifecycle action only completes it. The server still allows the
  lifecycle move.
- Overview gains a **Results to review** tile (`RESULTS_UNDER_REVIEW` count)
  linking to the conferences list filtered to that status.

### 7. No "Refunded" wording (`7428825`, adjusted at the merge)

The `REFUNDED` enum values stay; the labels don't say refund:

| Where | Now |
|---|---|
| payment status `REFUNDED` | "Payment exception" (a capture with no valid registration behind it, stored that way before payment exceptions existed) |
| registration status `REFUNDED` | "Payment exception" — main had already used this wording on the confirmation page, so the shared status meta was aligned to it rather than the "Payment returned" this lane first used. The app can't know whether money went back, so "exception" is the honest word. |
| organizer documents list, `REFUND_POLICY` uploads | "Fee policy", same as the public MUN page |
| organizer agreement (onboarding) | settlement is "less MUN Hub's platform fee"; the refund-policy promise is replaced by "registrations are final: you won't promise delegates refunds". The agreement version (`2026-09-17`) was not bumped — same day, pre-launch. |

The `/legal/refunds` page keeps its name: it is the legal document that
states payments are final, and E2E asserts it.

### 8. Cancelled conferences stay on the delegate dashboard (`401eca2`)

`getPastRegistrations` includes every registration whose MUN is `CANCELLED`
(whatever its dates), and `getUpcomingRegistrations` excludes them, so a
confirmed seat at a cancelled conference no longer sits under Upcoming and a
hold the cancellation released no longer disappears from both lists. The
card shows a "Conference cancelled" chip, drops the link to the (no longer
public) MUN page and the pass link, and keeps the receipt.

### 9. Wrangler: staging parity, canonical APP_URL (`9893ff9`)

`env.staging` inherits neither vars nor bindings, so it now repeats every
`ratelimit` binding with its own namespace ids (2001+), `COOKIE_SECURE`, and
`PUBLIC_API_URL` (wrangler warned that one was missing; staging's own API
origin). Top-level `APP_URL` is `https://www.munhub.in` — the apex only
redirects, so email links point straight at the canonical host. The binding
parity test now checks the staging list, that its ids don't overlap
production's, and `COOKIE_SECURE`. Verified with
`wrangler deploy --dry-run` for both environments (no warnings).

### 10. Unhandled errors are reported (`99fcb8f`)

The 500 branch of `server/middleware/error.ts` calls `reportRequestError`
once, with the request id (structured log, plus Sentry when `SENTRY_DSN` is
set, kept alive with `waitUntil`). Every existing mapping and log line is
unchanged; mapped 4xx errors are not reported.

### 11. Per-user rate limits (`3447261`)

| Limiter | Binding (prod / staging) | Limit | Routes |
|---|---|---|---|
| `supportTicketUser` | `RL_SUPPORT_TICKET_USER` 1017 / 2017 | 10/min | `POST /support/tickets`, `POST /support/conversations` (shared budget) |
| `supportMessageUser` | `RL_SUPPORT_MESSAGE_USER` 1018 / 2018 | 30/min | `POST /support/conversations/:ticketId/messages` |
| `accountDeleteUser` | `RL_ACCOUNT_DELETE_USER` 1019 / 2019 | 5/min | `POST /account/delete` (also bounds password guessing there) |

Rules can now match a path pattern, not only an exact path. Anonymous calls
aren't counted by these rules — the routes answer 401 without doing work,
the global per-IP cap still applies, and counting them would make every
anonymous 401 in the E2E suite share one `127.0.0.1` bucket. The ticket
limit is 10 rather than 5 for the same reason: the seeded E2E organizer
files six ticket requests (four of them deliberately invalid) inside a
minute, and per-user limits are deliberately not scaled by
`RATE_LIMIT_IP_MULTIPLIER`.

## Verification

- `npx vitest run --no-file-parallelism --exclude ".claude/**"` → 135 files,
  1617 tests, all passing (after merging `main`).
- Root `npx tsc --noEmit`, `server/ npx tsc --noEmit`, `web/ npx tsc -b
  --noEmit`, `web/ npx oxlint <changed paths>` → clean.
- Migration applied to local Docker Postgres
  (`DATABASE_URL=postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub npx tsx lib/db/migrate.ts`);
  enum verified with `enum_range`, and the seeded refund-policy rows are gone
  (2 → 0).
- `wrangler deploy --dry-run` for the top level and `--env staging`: both
  exit 0, all 19 rate-limit bindings listed, no configuration warnings.

## Deploy notes

- **Migration 0035 must be applied to Neon** with the rest of the pending
  ones. It adds enum values and deletes seeded demo documents only.
- No new secrets or vars. New bindings: the three `RL_*` above (the deploy
  token needs Workers rate-limit permission, same as the existing ones).
- `APP_URL` changes to `https://www.munhub.in`; staging gains
  `PUBLIC_API_URL` and `COOKIE_SECURE`.

## Left undone / for whoever picks this up

- **Welcome email** (task 4) — owned by the delegate-UX agent.
- **Old audit rows still carry the pre-0035 action values** (their precise
  name is in `metadata.event`, which both feeds prefer). A data migration
  rewriting them needs its own slot, because Postgres can't use a new enum
  value in the transaction that adds it.
- **Signup sends no verification email**: `sendVerificationEmail` exists and
  `/auth/users` never calls it, so an account can only verify by asking for
  a resend. Flagged to the lead; in the delegate-UX agent's area.
- `PII_READ` rows are written per request; a very busy admin console will
  add rows quickly. If that becomes noisy, sample them or move reads to
  their own table.
- Organizer analytics still sums across currencies; everything is INR today.
