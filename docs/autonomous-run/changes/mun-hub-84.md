# mun-hub-84: tests lane

Owns `E2E/**` and any new `*.test.ts` written for other lanes. This file is the running change log for the autonomous run.

## Before the run (already on main)

- Playwright E2E suite in `E2E/` covering every role and module (1b90b72), plus follow-ups for passwordless organizer sign-in, onboarding fixtures and fixture portfolio seats (6e27b57, ca4e361, 3a4cc9e, a7b460e).
- E2E-found bug fixes: delegate roster hash leak (10c49f5), `X-Forwarded-For` trust (6c715bd), registration eligibility (f292f40), organizer workspace on real data (a32f442, 0410659, 2aac202), student/public UI (67d439f), Gate 1 approval, audit and search (a5c2609), signed-out `/admin` redirect (07b3dce), and 500 → 4xx error mappings (271f4bd; not yet pushed).

## Where to report product bugs (from mun-hub-62)

- **mun-hub-f1:**
  - organizer setup fields
  - portfolios UI
  - accommodation
  - branding and media upload
  - module confirm, progress and lock banner
  - reviewer notes
  - draft preview
  - multi-MUN organizers
- **mun-hub-67 (or mun-hub-62):**
  - payments and the adapter seam
  - webhook hardening and idempotency
  - payment exceptions (there are no refunds)
  - platform fee and GST
  - finance figures
  - early-bird pricing
  - resume payment and receipts
- **mun-hub-4b:**
  - all email
  - email verification
  - notification preferences
- **mun-hub-62:**
  - security headers, CORS and CSRF
  - admin console: Gate 2, publish, unpublish, staff, analytics
  - registration lifecycle
  - MUN detail page and search filters
  - privacy: deletion, export, guardian consent
  - organizer operations: communications, roster, check-in, results
  - DevOps

mun-hub-62 does not run E2E itself. This session is the only one that runs the suite, and it reports pass/fail counts after every full run.

## Log

| Time | Commit | Change |
|---|---|---|
| run 1 | a2e88f0 | Change log started. Every E2E project except organizer, at 271f4bd: 297 passed, 8 skipped, 0 failed |
| run 1 | 6699007 | E2E API now starts with `MOCK_PAYMENTS_ENABLED=true` and `ALLOW_LOCALHOST_ORIGINS=true` |
| run 1 | f63f54d | Organizer subagent: onboarding-wizard spec, journey through the wizard, and marker cleanup. The organizer project passes 148 tests with 0 bug markers |
| run 1 | b24846a | New `organizer/multi-mun.spec.ts`, 13 tests covering multi-MUN hosting (57943d3) |
| run 1 | 50b19db | Accommodation "offered?" question (73bcdf4), and `/organizer/apply` as the host-another-MUN page, in the onboarding and workspace specs |
| run 1 | full run | Fresh prepare: 437 passed, 16 skipped, 5 failed. All 5 were test drift, now fixed |
| run 1 | 422fb55 | New `public/content-pages.spec.ts` for About, Curation, Contact and Legal; phone overflow checks for those 7 pages. Known bug: a legal deep link overshoots its section (reported to mun-hub-62) |
| run 1 | 34ff901 | Setup address, map and registration-window API tests. Known bug: a deadline earlier than the opening date is accepted (reported to mun-hub-f1) |
| run 1 | (none) | Asked mun-hub-4b for a dev-only email outbox, so E2E can check emails |
| run 1 | e3bacdd | Legal deep links land correctly after 31a5058; content pages must carry the "\| MUN Hub" title |
| run 1 | e999ae2 | New `student/account-privacy.spec.ts`, 11 tests covering data export and account deletion. README notes that skip-prepare runs need a manual migrate |
| run 1 | 2da635c | Email outbox wired in (`fixtures/outbox.ts`, `EMAIL_OUTBOX_FILE`, `APP_URL`). New `security/email-delivery.spec.ts`, 10 tests |
| run 1 | 33782ae | New `organizer/lifecycle.spec.ts`, 10 tests. New `e2e-lifecycle-mun` fixture with a verified payment account |
| run 1 | ff45aeb | New `auth/email-verification.spec.ts`, 6 tests |
| run 1 | 0949420 | New `admin/content-review.spec.ts`, 17 tests covering Gate 2, publish, unpublish and suspension, on the recreated `e2e-review-mun` and `e2e-suspend-mun`. prepare-db now resets the seeded logins. Drift fixes for f6fcb7b, the setup checklist, the documents label and the home row. Known issue: an unpublished MUN can't be queued again (reported to mun-hub-62) |
| run 1 | (ci) | CI e2e job: failure artifacts now include `E2E/.outbox`; removed the duplicate mock-payments env line |
| run 1 | 71a0cd2 | Branding upload UI tests replace the fixme, with `STORAGE_ADAPTER=local`. Documents page: heading, required documents, no refund type. Unpublished MUN media and documents return 404 to anonymous callers |
| run 1 | 986bf2a | New `organizer/submission.spec.ts`, 9 tests on the new `e2e-confirm-mun` fixture. Setup page address and registration-window UI |
| run 1 | 0b20c79 | New `public/mun-detail-content.spec.ts`, 7 tests. Adopted the sec-auth merge's E2E edits: `RATE_LIMIT_IP_MULTIPLIER`, and reset tokens read from the email outbox |
| run 1 | bb7f729 | Fixture helpers moved to `E2E/fixtures/fixture-db.ts`, with `recreateReadyMun()`. New `e2e-admin-console-mun` fixture. prepare-db deletes REFUND_POLICY documents |
| run 1 | bf8b12c | New `organizer/preview.spec.ts`. Portfolios UI tests replace the fixme. Republish test passes after fc05d9e. Stateful specs now reset their own fixtures |
| run 1 | (agents) | Three test agents are covering the admin console, org-ops, and support + payments lanes |
