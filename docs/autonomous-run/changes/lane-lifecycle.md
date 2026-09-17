# Lane `lifecycle` — registration and conference lifecycle controls

Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-5` (fast-forwarded to `main` at `73bcdf4` before
starting, because the worktree had been created 12 commits behind and did not include migration
0031 or this run's docs).

## What changed

Before this lane, nothing moved a MUN past `PUBLISHED`, so a live conference could never take
registrations (`initiateRegistration` requires `REGISTRATION_OPEN`).

| File | Change |
|---|---|
| `lib/lifecycle/registration-lifecycle.ts` (new) | `runLifecycleAction`, `getLifecycleOverview`, `runScheduledLifecycleTransitions`, and the shared rules (`planAction`). |
| `lib/lifecycle/lifecycle-events.ts` (new) | `notifyConferenceCancelled(munId)`: a no-op hook for the notifications lane to fill in. |
| `lib/lifecycle/mun-state-machine.ts` | One new edge, `CONFERENCE_ACTIVE -> COMPLETED`, plus a header comment explaining it. |
| `server/routes/mun-lifecycle.ts` (new) | `POST /api/v1/muns/:munId/lifecycle/:action` and `GET /api/v1/muns/:munId/lifecycle`. |
| `server/src/app.ts` | Two lines: import the route and mount it with `app.route('/api/v1', munLifecycleRoutes)`. |
| `web/src/api/mun-lifecycle.ts` (new) | `runLifecycleAction(munId, action, reason?)`, the `LifecycleAction` type, `getMunLifecycle`, `munLifecycleQueryKey`. |
| `web/src/pages/organizer/dashboard/sections/settings-page.tsx` | New "Registration & lifecycle" card above the contact form, which is unchanged. |
| Tests | `lib/lifecycle/registration-lifecycle.test.ts` (53 tests), `server/integration/mun-lifecycle.integration.test.ts` (13 tests). |

## API contract (the admin lane codes against this)

`POST /api/v1/muns/:munId/lifecycle/:action`

- `action` is one of: `open-registration`, `close-registration`, `start-conference`, `complete`,
  `archive`, `cancel`.
- Body is `{reason?: string}` (at most 1000 characters). The body may be empty for every action
  except `cancel`.
- `200` returns `{munId, status}`.
- `400 VALIDATION_FAILED`: unknown action, invalid JSON or unknown field, missing or blank reason
  on cancel, or a reason that is too long.
- `401`: no session. `403 FORBIDDEN`: the caller isn't allowed to run this action. `404`: no such MUN.
- `409 CONFLICT_STATE`: the MUN's current status doesn't allow the action, or a precondition
  failed. The `message` is written so the organizer can read it as-is.

`GET /api/v1/muns/:munId/lifecycle` returns `{munId, name, status, startDate, endDate,
registrationOpensAt, registrationDeadline, confirmedRegistrations, actions: [{action,
targetStatus, available, blockedReason, requiresReason}]}`.

- Only the owning organizer and staff may call it. Responses are sent with `no-store`.
- `actions` lists only the actions this caller may take from the current status.
- Actions that fit the status but fail a precondition are included with `available: false` and a
  `blockedReason`.

## Rules and decisions

**Permissions**

- Staff means `OPERATIONS`, `ADMIN` and `SUPER_ADMIN`.
- `open-registration`, `close-registration`, `start-conference` and `complete`: the owning
  organizer or staff.
- `archive`: staff only.
- `cancel`: the owning organizer, `ADMIN` or `SUPER_ADMIN` (not `OPERATIONS`), and a reason is
  always required.
- Decision: an organizer can't cancel a `SUSPENDED` MUN; that call belongs to MUNHub while the MUN
  is suspended.

**Timing**

- All timing rules use IST calendar days. The setup form stores dates as bare dates at UTC
  midnight, and IST is a fixed +05:30.
- `start-conference` is allowed from the IST day before `startDate`. There is no staff override.
- `complete` is allowed once the IST day of `endDate` is over, falling back to `startDate` if
  `endDate` is empty.
- Decision: "after endDate" means the day after the end date, so check-in isn't cut off on the
  final day. Staff may complete at any time.

**open-registration preconditions**

The MUN must be `PUBLISHED`, and all of these must hold:

- At least one pass is active and still purchasable (`status = 'active'`, and its deadline is
  empty or in the future).
- If any of those passes is paid (`price` or `earlyBirdPrice` above 0), `mun_payment_settings` is
  `VERIFIED`.
- `registrationDeadline` is set and hasn't passed. Publishing already requires a deadline, so this
  requirement matches it.
- The conference start day hasn't begun.
- `registrationOpensAt` is empty or in the past. Decision: a manual open before the scheduled time
  is rejected with a message pointing to Setup. Otherwise the MUN would show "Registration open"
  while `initiateRegistration` still rejects every delegate with "hasn't opened yet".

**start-conference from `REGISTRATION_OPEN`**

- The MUN moves through two audited transitions, `REGISTRATION_CLOSED` then `CONFERENCE_ACTIVE`,
  in one transaction.
- I did not add a shortcut edge.

**`CONFERENCE_ACTIVE -> COMPLETED` (new edge)**

- Results publishing is optional in the MVP: awards are plain `achievements` rows that don't
  depend on MUN status. Without this edge, a conference that never enters `RESULTS_PENDING` could
  never be completed.
- Once a MUN is in the results flow, it can only complete through
  `RESULTS_UNDER_REVIEW -> COMPLETED`. That step is staff-only, because it is the results-review
  decision.
- `RESULTS_PENDING -> COMPLETED` stays forbidden.

**cancel**

- The MUN moves to `CANCELLED`.
- The reason is stored as the `verification_logs.notes` of the `CANCELLED` row. No schema change
  was needed.
- In the same transaction:
  - `CONFIRMED` registrations stay as they are (there are no refunds).
  - `PENDING` and `PAYMENT_PENDING` seat holds become `CANCELLED`. A checkout that completes later
    is then treated as a late payment and becomes an admin-resolved payment exception, rather than
    a confirmed seat at a cancelled conference.
  - Any active `mun_submissions` row becomes `WITHDRAWN`, so the MUN leaves the review and go-live
    queues.
- After commit, `notifyConferenceCancelled(munId)` is called and awaited. Its errors are logged,
  never thrown. It is awaited rather than fire-and-forget because Workers can drop promises that
  are still pending after the response is sent.

**close-registration**

- In-flight seat holds are left alone. A delegate who took a seat before the close can still
  finish paying within the 15-minute hold.

**Audit and errors**

- Every transition goes through `transitionMun`, which takes a row lock and writes a
  `verification_logs` row. I added no `admin_actions` rows, because `admin_action` has no
  lifecycle values and adding them would need a migration.
- Lifecycle errors (`LifecycleActionError`, with a status of 400 or 409) are mapped inside the
  route, so `server/middleware/error.ts` is untouched.

## Scheduler hook

`runScheduledLifecycleTransitions(now, actorId, {munIds?, batchSize?})` returns
`{opened, closed, started, skipped[]}`. It runs three steps in order:

1. `PUBLISHED` MUNs with `registrationOpensAt <= now` move to `REGISTRATION_OPEN`, if the
   preconditions pass. A MUN whose preconditions fail is listed in `skipped` with the reason and
   retried on the next run. MUNs whose deadline has passed or whose conference day has started
   are excluded from the query, so they don't show up in `skipped` on every run.
2. `REGISTRATION_OPEN` MUNs whose deadline has passed, or whose IST start day has begun, move to
   `REGISTRATION_CLOSED`.
3. `REGISTRATION_CLOSED` MUNs whose IST start day has begun move to `CONFERENCE_ACTIVE`.

Properties:

- It never completes, archives or cancels a MUN.
- Each MUN is handled in its own transaction, which re-checks under a row lock that the MUN is
  still due. The hook is therefore idempotent and safe to run concurrently; a test covers two
  concurrent runs. A failure on one MUN is reported in `skipped` and does not stop the others.
- `munIds` limits the run to specific MUNs. The tests rely on it so they never touch other lanes'
  rows in the shared local database.

## Env vars and bindings needed at deploy

- `SYSTEM_ACTOR_USER_ID` is a new `munhub-api` Worker var. It must be the `users.id` of a
  dedicated staff account, because `verification_logs.reviewer_id` is a NOT NULL foreign key.
  - The DevOps scheduled handler should read it with `getRuntimeEnv('SYSTEM_ACTOR_USER_ID')`.
  - The handler should call `runScheduledLifecycleTransitions(new Date(), actorId)` inside the
    same scope the HTTP middleware sets up, since the hook uses `db` directly: first
    `setRuntimeEnv(env)`, then
    `runWithHyperdriveConnectionString(env.HYPERDRIVE.connectionString, ...)`.
  - The handler should log the summary.
  - A cron of `*/5 * * * *` is fine.
- No new bindings and no migrations.

## Verification

- `npx vitest run lib/lifecycle/registration-lifecycle.test.ts --no-file-parallelism`: 53 passed.
- `npx vitest run server/integration/mun-lifecycle.integration.test.ts --no-file-parallelism`:
  13 passed.
- `npx vitest run lib/lifecycle/mun-state-machine.test.ts server/src/app.test.ts server/integration/error-taxonomy.test.ts --no-file-parallelism`:
  all passed (38 + 7).
- `server`: `npx tsc --noEmit -p tsconfig.json` is clean.
- `web`: `npx tsc -b --noEmit` is clean.
- `npx oxlint` on the two changed web files reports one warning (`set-state-in-effect`). It comes
  from the existing contact form's `useEffect`, which I didn't change.
- Browser check (API on :3105, web on :5205, Chrome through Playwright), using a throwaway
  organizer and two MUNs created in the local database; the seeded demo MUNs were not touched:
  - With the payment account unverified, "Open registration" is disabled and shows the reason.
  - With it verified, "Open registration" opens a confirmation dialog, and after confirming the
    status becomes "Registration open".
  - The card then shows "Close registration" and a disabled "Start conference" with its date.
  - In the cancel dialog, the confirm button stays disabled until a reason is entered and the
    exact MUN name is typed. After confirming, the status becomes "Cancelled" and the card shows
    the cancelled message.
  - At 390px width there is no horizontal overflow, and dark mode renders correctly.
  - The only console errors were 403s from Vite's `fs.allow` on font files. They are caused by the
    `node_modules` junction and are not a code issue.

## Follow-ups

- **Reopening registration.** `REGISTRATION_CLOSED -> REGISTRATION_OPEN` isn't in the documented
  path, so I didn't add it. As a result, an organizer who extends the deadline after the scheduler
  has closed registration can't reopen it.
  - Recommended fix: add the edge and a `reopen-registration` action with the same preconditions
    as `open-registration`.
- **Delegate-facing cancelled state.** Cancelled MUNs disappear from the marketplace and public
  detail page (`PUBLIC_DETAIL_STATUSES` excludes `CANCELLED`). Delegates who hold confirmed
  registrations need to see "Cancelled" on their dashboard and pass. This belongs to the
  notifications lane (email), the marketplace lane or org-ops.
- **Notifications lane.** Implement `notifyConferenceCancelled`: email confirmed delegates, and
  the organizer when an admin cancelled. Read the reason from the latest `verification_logs` row
  with `action = 'CANCELLED'`. Don't promise refunds.
- **DevOps lane.** Wire the cron as described above and create the system actor account.
- **Admin lane.** Staff can also call `GET /muns/:munId/lifecycle` to render the available actions,
  including `archive` and early `complete`.
- **Shared dialog title (pre-existing).** `web/src/components/ui/dialog.tsx`'s `DialogTitle` passes
  `text-title-sm` and `text-ink` through `cn()`, which drops the size token, so every dialog title
  renders at the inherited large size. This affects the admin dialogs too. I didn't change it
  because it's a shared primitive.
- **Results-flow edges.** Nothing moves `CONFERENCE_ACTIVE -> RESULTS_PENDING -> RESULTS_UNDER_REVIEW`
  yet. If org-ops builds results publishing, the staff `complete` action already handles the last
  step.
- **E2E (mun-hub-84).** An organizer spec for open, close and cancel from Settings would cover
  this lane end to end.
