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
