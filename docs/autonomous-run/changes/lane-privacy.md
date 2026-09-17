# Lane privacy — data export, account deletion, auth-artifact purge

Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-7`, fast-forwarded to `main` at `73bcdf4` before starting, because the worktree was created at `3a4cc9e`, before this run's plan docs and migration 0031.

## What changed

### Data export: `GET /api/v1/account/export` (auth)
- `lib/actions/data-export.ts` → `exportAccountData(session)`. Returns one JSON document (`format: "munhub-account-export"`, `version: 1`, `exportedAt`) containing:
  - `account`
  - `studentProfile`, without the internal row id and user id
  - `consents`
  - `registrations`: the MUN (name, slug, dates, city), the pass (product name, price, currency), committee, portfolio, accommodation option and its answers, `formResponses`, status and timestamps
  - `payments`: amount, currency, platform fee and tax, status, provider, order and payment ids, and exception reason and dates
  - `supportTickets`, each with its `messages`
- Identity comes only from the session. Each select names its columns, except `student_profiles`, which holds only the delegate's own data.
- Left out on purpose:
  - password hashes, session tokens and reset tokens
  - which staff member wrote a support reply: a message has `fromYou` and `senderRole` only
  - the payment-exception resolver id and resolution note
  - the organizer's net payout share (`organizerNetAmount`)
- The route sends the JSON as an attachment (`munhub-data-<date>.json`) with `Cache-Control: no-store`.

### Account deletion: `POST /api/v1/account/delete` (auth), body `{confirmation: "DELETE", password}`
- `lib/actions/account-deletion.ts` → `deleteOwnAccount(input, session)`.
  - `confirmation` must be exactly `DELETE`.
  - The password is re-checked with `verifyPassword` from `lib/auth/password.ts`. That file is imported, not modified.
- **Only STUDENT accounts can delete themselves.** The role check uses the stored role, not the role cached on the session, and runs again under a row lock inside the transaction. ORGANIZER, OPERATIONS, ADMIN and SUPER_ADMIN accounts get a 403 telling them to email support@munhub.in.
- **The account is anonymized, not deleted.** `registrations.userId` is a NOT NULL foreign key, and registrations and payments are financial records we keep.
- One transaction does all of the following:
  - `users`:
    - name becomes `Deleted user`
    - email becomes `deleted+<userId>@deleted.invalid`
    - phone, institution, username, profile image and password hash become null
    - `emailNotificationsEnabled` becomes false
  - Deletes the `student_profiles` row, every `sessions` row and every `password_reset_tokens` row. Also deletes `email_login_codes` for the old address (case-insensitive match).
  - **Cancels unpaid seat holds** (`PENDING`/`PAYMENT_PENDING` → `CANCELLED`) so the seats are released.
    - Payment rows are not touched.
    - If a payment still completes afterwards, the payments lane's webhook treats it as a late payment and raises a payment exception for an admin. There are no refunds.
  - **Registration answers:**
    - `formResponses` and `accommodationAnswers` are set to null on every registration except CONFIRMED or ATTENDED seats at a conference that hasn't ended.
    - "Ended" is `endDate` (or `startDate` if there is no end date) plus a 24-hour grace period, because dates are often stored as the start of the day.
    - A conference with no dates at all counts as not ended.
    - Decision: the task said CONFIRMED only. I also kept ATTENDED, because a checked-in delegate is by definition at a conference that is still running, and those answers hold the emergency contact the organizer needs on the day. The rule is the pure function `retainsRegistrationAnswers`, which has its own unit tests.
  - **Kept as-is:**
    - registrations and payments, which stay linked to the anonymized user
    - `user_consents`, as proof of what was agreed; the Privacy Policy says consent records are kept
    - support tickets and their messages, which can concern payment exceptions an admin still has to resolve
- After the transaction commits, a **structured audit line** is logged: one JSON `console.info` line with `type: "audit"`, `event: "account.deleted"`, the user id, role, time and counts, and no email or name. `admin_actions` can't record this because its enum has no suitable value, and adding one needs a migration (see follow-ups).
- The route clears the session cookie, using the same `COOKIE_DOMAIN` (read via `getRuntimeEnv`) that sign-in uses. Status mapping:

  | Case | Status |
  |---|---|
  | Wrong confirmation word | 400 `VALIDATION_FAILED` |
  | Wrong password | 401 `UNAUTHORIZED` |
  | Organizer or staff account | 403 `FORBIDDEN` |
  | Malformed body | 400 (zod) |
  | Deleted | 204 |

- Decision: the route maps these errors itself instead of adding them to `server/middleware/error.ts`, which several lanes are editing right now. `ACCOUNT_DELETION_ERRORS` is exported, so the mapping can move there later if wanted.

### Purge job: `lib/jobs/purge-auth-artifacts.ts`
- `purgeExpiredAuthArtifacts(now: Date): Promise<{ sessions, passwordResetTokens, loginCodes }>` deletes:
  - sessions with `expiresAt < now`
  - password reset tokens whose `usedAt` or `expiresAt` is more than 7 days before `now`
  - `email_login_codes` (organizer sign-in codes) whose `expiresAt` is more than a day before `now`, used or not
- It is idempotent. The organizer OTP hourly resend cap only looks at the last hour, so it isn't affected.
- **For the DevOps scheduler:** import exactly this path and name, and call it inside the same per-request DB scope a fetch uses (`runWithHyperdriveConnectionString` from `lib/db/hyperdrive-bridge.ts`). Otherwise `db` has no Hyperdrive connection string on Workers.

### Web
- `web/src/api/account.ts`:
  - `downloadAccountData()` builds a pretty-printed JSON `Blob` and names the file client-side, because `Content-Disposition` isn't exposed cross-origin.
  - `deleteAccount(input)` calls the delete endpoint.
- `web/src/types/account.ts`: new `DeleteAccountInput`.
- New `web/src/components/account/privacy-data-section.tsx`, a "Privacy & data" section:
  - A "Download my data" card.
  - A "Delete your account" danger zone that says what deletion does and opens a dialog. The dialog needs the typed word `DELETE` and the password; its submit button stays disabled until both are filled.
  - On success it calls `signOut()` (harmless if the cookie is already gone), navigates to `/`, and only then clears the query cache. Doing it in that order means RequireAuth doesn't bounce to `/login` on the way out.
  - Organizer and staff sessions see a support-email notice instead of the form.
- `web/src/pages/profile-page.tsx`: only an import, a `<Separator />` and `<PrivacyDataSection />` at the bottom of `<main>`. The page is otherwise unchanged.

## Verification

- Tests, run with `npx vitest run <files> --no-file-parallelism` against local Docker: **10 files, 79 tests, all passing.**
  - New tests:
    - `lib/actions/data-export.test.ts`: export shape, no staff ids or tokens, no other users' rows, missing account
    - `lib/actions/account-deletion.test.ts`:
      - organizer and staff refusal, including when the session claims STUDENT
      - wrong confirmation or password, and an account with no password
      - anonymization; profile, sessions, reset tokens and codes gone; sign-in impossible
      - consents and tickets kept, and the audit line has no email in it
      - registrations and payments survive, and answers are kept or cleared by the rule above
      - holds cancelled; other delegates untouched
      - unit tests for `retainsRegistrationAnswers`
    - `lib/jobs/purge-auth-artifacts.test.ts`: runs at the real current time because the database is shared, and checks only its own rows
    - `server/integration/account-privacy.integration.test.ts`: status codes, headers, the cleared Set-Cookie, and every session signed out
    - Shared fixture: `lib/actions/privacy-test-helpers.ts`
  - Existing neighbours rerun: `lib/actions/account.test.ts`, `auth.test.ts`, `password-reset.test.ts`, `organizer-otp.test.ts`, `lib/auth/session.test.ts`, `server/integration/error-taxonomy.test.ts`
- Type checks:
  - `server`: `npx tsc --noEmit -p tsconfig.json` passes.
  - Root: `npx tsc --noEmit` passes. It covers the `lib/` files and their tests.
  - The new integration test also type-checks under a temporary config; `server/integration` isn't in any project config.
- Web:
  - `npx tsc -b --noEmit` passes.
  - `npx oxlint` reports nothing on the new and changed files. `profile-page.tsx` has two existing `set-state-in-effect` warnings on lines this lane didn't touch.
- Browser check in Chrome (local API on :3107, web on :5207, accounts seeded in local Docker):
  - The downloaded file has the right account, 4 registrations, 2 payments and 1 ticket.
  - The delete button stays disabled until both fields are filled.
  - A wrong password shows a toast and keeps the dialog open.
  - A successful delete lands on `/` signed out: no cookie left, `GET /auth/session` returns null, and `/profile` redirects to `/login`.
  - An organizer sees the guidance and no delete button.
  - No horizontal scroll at 375px.

## Env vars / bindings

None new. The existing `COOKIE_DOMAIN` is used when clearing the cookie.

## Follow-ups

- **Audit table:** add an `ACCOUNT_DELETED` value to `admin_action` (needs a migration slot), then write the deletion to `admin_actions` as well as the log line. `actorId` would be the user id, which still exists because the row is anonymized, not deleted.
- **Rate limiting (sec-auth lane):** add a per-session rule for `POST /account/delete`. Guessing the password there already requires a signed-in session, but the only limit today is the global per-IP one.
- **Privacy Policy page:** "Your rights" could point at the new self-service export and delete on `/profile`. The page currently says to email the privacy team.
- **Guardian consent UI** (listed under Privacy in PLAN.md) wasn't in this lane's task list and wasn't built.
- **Scheduler (DevOps lane):** wire `purgeExpiredAuthArtifacts` into the Worker `scheduled` handler inside the Hyperdrive request scope. Daily is enough.
- **Payments lane:** `registrations` for a deleted user can now go to CANCELLED from PAYMENT_PENDING outside the TTL path. A late `paid` webhook for such a row must raise a payment exception, which should be the same path as an expired hold.
- **Organizer roster:** a deleted delegate with an upcoming confirmed seat shows as "Deleted user", but their form answers are kept until the conference ends, as decided above.
