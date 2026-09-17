# Lane org-ops: organizer operations

Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-8`, fast-forwarded to `main` at `73bcdf4` before starting (the worktree was created 12 commits behind main).

## What changed

### Roster (Registrations section)
- **Search:** `GET /organizer/muns/:munId/delegates` searches the whole roster in SQL. It matches name, email or institution (case-insensitive substring) or the start of a registration id. LIKE wildcards are escaped, and the search is capped at 100 characters.
- **Filters:** `status=A,B` (a comma-separated list) and `registrationProductId` (the pass) sit alongside the existing committee and payment filters.
- **Response shape:**
  - The response now also carries `munStatus` and `attendanceOpen`.
  - Every column is listed explicitly. Form answers are no longer sent in the list, and neither is the registration's `idempotencyKey`, which the list used to leak.
- **Delegate detail (owner only):** `GET .../delegates/:registrationId` returns:
  - the delegate's contact details
  - pass, committee and portfolio
  - payment
  - check-in state
  - profile essentials: date of birth, grade/year, course, city/state/country, transport need, emergency contact
  - labelled form answers, in form order
  - accommodation answers
- **CSV export (owner only):** `GET .../delegates/export`.
  - Uses the same filters as the list, and adds a column per registration-form field.
  - Uses RFC 4180 quoting and adds a UTF-8 BOM.
  - `lib/csv.ts` puts an apostrophe in front of any cell starting with `=`, `+`, `-`, `@`, tab or CR. Numbers we generate ourselves stay numeric.
  - Rosters over 10,000 rows are refused (400) rather than silently cut off.
- **Attendance:** `PUT .../delegates/:registrationId/attendance {status: ATTENDED|NO_SHOW}`.
  - Allowed for the owning organizer or platform staff.
  - Only while the MUN is `CONFERENCE_ACTIVE` or `RESULTS_PENDING`.
  - Only for seat-holding registrations (CONFIRMED/ATTENDED/NO_SHOW). Setting the status a registration already has does nothing.
  - An award winner can't be marked a no-show.
- **UI:**
  - Debounced search box and status / pass / committee / payment filters. "Refunded" was dropped from the payment filter because the product has no refunds.
  - Pass and committee/portfolio columns.
  - A name link or "View" button opens a drawer (`components/organizer/delegate-detail-sheet.tsx`).
  - "Export CSV" button.
  - Attended / No-show actions sit under the status chip.

### Delegate messages (Communications section)
- **Library:** `lib/actions/organizer-communications.ts`.
  - **Who:** the owning organizer only.
  - **Message:** a subject (up to 150 characters, single line) and a plain-text body (up to 5,000 characters).
  - **Audience:** seat holders (CONFIRMED/ATTENDED/NO_SHOW), filtered by status, pass and committee. Recipients are counted once per account, and suspended accounts are skipped.
- **Routes:**
  - `GET /organizer/muns/:id/communications/audience` — recipient count and sends left this hour
  - `POST /organizer/muns/:id/communications` — send; returns `{recipientCount, sent, failed}`
  - `GET /organizer/muns/:id/communications` — recent history
- **Delivery:**
  - Goes through `getNotificationsAdapter()` from `lib/notifications/select-adapter.ts` (imported only; nothing in `lib/notifications` was edited).
  - Recipients are sent to one at a time, in order.
  - A failed delivery is counted and logged (with the user id, not the email address), and sending continues.
  - The HTML part is fully escaped and wrapped in a simple branded layout; the plain-text part is sent alongside it.
- **Limits:**
  - At most 500 recipients per message. A larger audience gets a 400, and the organizer must narrow it.
  - At most 5 messages per MUN per rolling hour (429).
  - The hourly count is taken under a `FOR UPDATE` lock on the MUN, from the audit rows below. So it holds across Worker isolates and concurrent requests; a test fires 7 sends in parallel.
- **Marketing preference:** operational conference messages deliberately ignore `users.emailNotificationsEnabled`. This is documented in the code and in the composer copy.
- **Audit:** one append-only `verification_logs` row per send, written before delivery starts:
  - `action = 'COMMUNICATION_SENT'`
  - `notes` = subject and recipient count
  - `internal_notes` = JSON of the audience
  - These rows appear in the admin audit history for the MUN. No new table was added.
- **UI:** composer with character counters, a recipient card with the live count and warnings (over the cap, out of sends), a confirm step, and a "Recently sent" list. The old read-only directory and "Copy emails" button were removed; the roster CSV export covers bulk contact lists.

### Check-in and the delegate pass
- **Code:** `lib/actions/check-in.ts`. The code is `HMAC-SHA256(key, "check-in:v1:" + registrationId)`, taking the first 50 bits as 10 Crockford base32 characters and showing them as `XXXXX-XXXXX`. There is no schema change.
  - **Input:** accepted in any case, with hyphens or spaces, and with O/I/L read as 0/1/1.
  - **Key:** `getRuntimeEnv('CHECKIN_CODE_SECRET')`, which must be at least 32 characters.
    - If it isn't set, the key is `HMAC-SHA256(PAYMENT_FIELD_KEY, "munhub:check-in-code-key:v1")`.
    - If neither is set, or the secret is too short, the server returns 503 "not configured".
    - **Rotating the key re-issues every code** (see follow-ups).
- **Pass:** `GET /me/registrations/:id/pass` is for the owning delegate only. Anyone else gets 404, including the MUN's organizer and staff. A pass exists only for seat-holding registrations; otherwise the API returns 409.
- **Check-in:** `POST /organizer/muns/:id/check-in {code}`, for the owner or platform staff (OPERATIONS/ADMIN/SUPER_ADMIN).
  - **When:** only while the MUN is `REGISTRATION_OPEN`, `REGISTRATION_CLOSED` or `CONFERENCE_ACTIVE`, and from 24 h before `startDate`. The check runs under a share lock on the MUN.
  - **Matching:** the code is compared against this MUN's seat-holding registrations. It moves CONFIRMED or NO_SHOW (a late arrival) to ATTENDED under a row lock.
  - **Repeats:** a repeat scan returns `ALREADY_CHECKED_IN` with the original time.
  - **Response:** the delegate's name, institution, pass, committee and portfolio.
- **Pass page:** `web/src/pages/dashboard/registration-pass-page.tsx` at `/dashboard/registrations/:registrationId/pass`.
  - Shows the MUN, dates, venue/address, delegate, pass, committee/portfolio, registration id and the code in large monospace text.
  - Printable (header and footer are hidden when printing).
  - **No QR code:** no QR library exists in `node_modules` (checked).
  - `registration-card.tsx` got one "View pass" link for CONFIRMED/ATTENDED/NO_SHOW seats.
- **Conference Day:** `components/organizer/check-in-panel.tsx` sits above the unchanged schedule. It offers:
  - typing or pasting a code
  - camera scanning via `BarcodeDetector`, shown only where supported (QR, Code 128 and Code 39 formats)
  - a success, already-checked-in or error notice
  - a list of this device's check-ins
  - a roster refresh after each check-in

### Results
- **Awards:** `lib/actions/results.ts`.
  - An award must reference a CONFIRMED or ATTENDED registration of the MUN; the registration is share-locked while the award is written.
  - The award name is trimmed and required.
  - Committee and portfolio default to the delegate's own assignment.
  - Awards can't be added or removed in `RESULTS_UNDER_REVIEW`, `COMPLETED`, `ARCHIVED` or `CANCELLED`.
  - The award list now includes `delegateName` and `delegateEmail`.
- **Results state:** `GET /organizer/muns/:id/results` returns the MUN status, award count, whether awards are editable, whether results can be submitted, `submittedAt`, and `returnNote` (the staff note from the latest return).
- **Submit:** `POST /organizer/muns/:id/results/submit`, for the owner or an admin. It moves `CONFERENCE_ACTIVE → RESULTS_PENDING → RESULTS_UNDER_REVIEW` in one transaction through `transitionMun`, with two audited steps. It needs at least one award.
- **Staff review:** `POST /admin/muns/:id/results/review {decision: APPROVE|RETURN, note}`, for OPERATIONS/ADMIN/SUPER_ADMIN.
  - APPROVE moves the MUN to `COMPLETED` and marks its awards `verified`.
  - RETURN moves it back to `RESULTS_PENDING` and requires a note.
  - There is no staff UI yet (see follow-ups).
- **Results page UI:**
  - A status card for each state (before the conference, ready, returned with MUNHub's note, under review, approved, cancelled) and the submit button.
  - The delegate picker searches confirmed and attended delegates on the server.
  - **Bug fixed:** the picker used to request `limit=200`, which is over the API's limit of 100, so it was always empty.
  - **Bug fixed:** blank committee/portfolio overrides were sent as `""`, which the API rejected with a 400; they are now sent as `null`.
  - Add and delete controls are hidden once results are locked.

### Shared plumbing
- `lib/actions/mun-access.ts`: two helpers.
  - `assertMunOwner`: owner only. Used for the detail drawer, the export and messages, the most PII-heavy or outward-facing actions. This addresses the audit's finding that staff reads of delegate PII aren't logged.
  - `assertMunOwnerOrStaff`: used for conference-day operations.
  - `assertOwnsOrAdmin` is unchanged and still covers the roster list and results.
- `lib/actions/organizer-ops-errors.ts`: every user-facing message and limit for this lane. `server/middleware/error.ts` maps them through one additive `ORGANIZER_OPS_ERROR_STATUS` lookup.
- `web/src/hooks/use-debounced-value.ts`: a new shared hook.

## Decisions
- **Attendance windows:**
  - Hand-marking attendance is allowed while the conference is active or awaiting results (`CONFERENCE_ACTIVE`, `RESULTS_PENDING`) and freezes once results are submitted, because awards and future certificates build on it.
  - Door check-in is allowed from registration opening through `CONFERENCE_ACTIVE`, and only from 24 h before the start date.
- **Check-in accepts NO_SHOW:** a late arrival on day 2 should still get in.
- **Owner-only vs. owner-or-staff:** followed the brief. The detail drawer, export and messages are owner-only; check-in and attendance also allow OPERATIONS/ADMIN/SUPER_ADMIN.
- **Oversized audiences and exports are refused,** not truncated, so organizers never believe everyone was reached.
- **Where sends are audited:** `verification_logs`, the MUN audit trail that `getAuditHistory` already merges. `admin_actions` would have needed a new enum value, which means a migration.
- **Browser check:** the web typecheck was run as `npx tsc -p tsconfig.app.json --noEmit` rather than `tsc -b`. The app project is the same, but this form doesn't write `tsbuildinfo` into the main checkout's `node_modules/.tmp` through the junction.

## Env vars and bindings needed at deploy
- **`CHECKIN_CODE_SECRET`** (API Worker secret): a random string of at least 32 characters. Set it before the first conference, for example with `openssl rand -base64 48`.
  - It is optional: without it, codes derive from `PAYMENT_FIELD_KEY`.
  - Once passes have been shown to delegates, changing it (or changing `PAYMENT_FIELD_KEY` while it's unset) invalidates every code.
  - Not added to `.env.example`, which belongs to the DevOps lane. Please add `CHECKIN_CODE_SECRET=` there with this note.
- **Real delegate email:** the existing `ZEPTOMAIL_TOKEN` / `ZEPTOMAIL_FROM_ADDRESS`. Without them, messages go to the console adapter.
- **Worker subrequest limit:** a 500-recipient send makes about 500 ZeptoMail subrequests plus database queries. That fits the paid Workers limit (1,000) but **not the free plan (50)**.
- No migrations were added.

## Verification
- **Tests:** `npx vitest run lib/csv.test.ts lib/actions/check-in.test.ts lib/actions/organizer-communications.test.ts lib/actions/organizer-roster.test.ts lib/actions/organizer-dashboard.test.ts lib/actions/results.test.ts server/integration/organizer-ops.integration.test.ts server/integration/error-taxonomy.test.ts --no-file-parallelism` passed: 8 files, 75 tests.
- **Typechecks:**
  - `server`: `npx tsc --noEmit -p tsconfig.json` is clean.
  - Root `tsc` shows no errors in the new or changed `lib` files. The legacy Next.js errors are pre-existing.
  - `web`: `npx tsc -p tsconfig.app.json --noEmit` is clean.
- **Lint:** `npx oxlint` on every changed web path is clean. The only warnings are pre-existing ones in `settings-page.tsx`, `setup-page.tsx` and `finance-page.tsx`, which this lane doesn't own.
- **Browser check (Playwright + Chrome):** API on :3108 and web on :5208, against a MUN seeded locally in `CONFERENCE_ACTIVE` with 32 delegates. Checked:
  - roster search and filters, the drawer, CSV download (formula neutralised) and attendance marking
  - sending a message and the history list
  - check-in: success, repeat scan, and an unknown code
  - awards: add, then submit for review (awards lock and the attendance actions disappear)
  - the pass page (desktop and 375 px) and the dashboard "View pass" link
  - no horizontal overflow at 375 px on the pass, communications and conference-day pages
  - The only other console errors were Vite refusing font files through the `node_modules` junction, an artifact of the worktree setup.

## Notes for the tests lane (E2E specs that assert the old UI)
- **`registrations.spec.ts`:** "Search this page" is now "Search delegates", and it searches the server. The fixme "roster shows portfolio and pass…" can now be partly written: pass and portfolio columns, the view drawer and export all exist. There are still no assign/cancel actions, and no refund action by design.
- **Communications tests** (`registrations.spec.ts` and `operations.spec.ts`):
  - Removed: the "Payment status" filter, the "Copy N emails" button, and the PAID column. Empty state: the "No delegates match these filters" heading is still shown in the recipient card.
  - The fixme "compose and send announcements" can now be implemented.
- **`operations.spec.ts` › Results:** "Add award" appears once the results state loads (only while editable). The delegate `<select>` is still labelled "Delegate", and the search box is labelled "Search roster". The API now also refuses awards for delegates who aren't CONFIRMED or ATTENDED (409).
- **`conference-day.spec.ts`:** a check-in form now sits above the schedule, so `main.locator('form')` matches two forms. The chained label and button lookups still resolve uniquely inside the schedule form.

## Follow-ups
1. **Delivery at scale:**
   - Move delegate sends to a queue (Cloudflare Queues) or ZeptoMail batch sending. The email lane owns `lib/notifications`.
   - A send-history table (`mun_communications` with per-recipient status) would allow retries and show delivery results; today only the audit row and the counts returned at send time exist.
2. **QR code on the pass:** once a QR library is approved, encode the check-in code as the payload. The scanner already accepts QR codes, and a bare code in the payload is enough.
3. **Check-in time and actor:** a dedicated `registrations.checked_in_at/checked_in_by` column (needs a migration slot) would replace today's use of `updatedAt` as the check-in time and record who checked each delegate in.
4. **Staff review UI** for submitted results (admin lane): call `POST /admin/muns/:munId/results/review`. Also a queue listing MUNs in `RESULTS_UNDER_REVIEW`.
5. **Results notifications** (email lane): tell staff when results are submitted and tell the organizer when they're approved or returned. There is no `PipelineEvent` for this yet.
6. **Timeline displays:** `COMMUNICATION_SENT` rows now appear in the MUN's `verification_logs` (the admin "History" list shows them as audit entries). Any view that treats every `verification_logs.action` as a MUN status should filter by known statuses.
7. **Wording overlap with the lifecycle lane:** its "end conference" action (`CONFERENCE_ACTIVE → RESULTS_PENDING`) is compatible with submit-for-review, which also accepts `RESULTS_PENDING`. The organizer may want copy that makes this ordering clear.
8. **Env docs:** add `CHECKIN_CODE_SECRET` to `.env.example` and the operations docs (DevOps lane).
