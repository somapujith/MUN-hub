# lane-admin — admin console

Lane: `web/src/pages/admin/**` (not payments-page), `web/src/lib/admin/**`, the admin layout, admin API clients, `server/routes/admin-*.ts`, `lib/actions/admin-*.ts` (not payment exceptions), `lib/actions/organizer-admin.ts`, `scripts/create-admin.ts`. Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-4`, fast-forwarded to `main` at `73bcdf4` before starting, so it includes migration 0031 and the run docs.

## What changed

### 1. Go-live queue (`/admin/go-live-queue`)
- New `GET /admin/go-live-queue/details` (`getGoLiveQueueDetails` in `lib/actions/admin-muns.ts`). It returns `getGoLiveQueue`'s rows unchanged, plus the organizer name, the submission's reviewer, and the MUN's payment-account verification state. That takes one extra query for the rows on the page. `lib/lifecycle/go-live.ts` is not touched.
- Each row shows:
  - the lifecycle status and the submission status;
  - the SLA state and its deadline;
  - the reviewer ("Unassigned" if there isn't one);
  - the payment-account state.
- Row actions depend on the MUN's status:
  - **VERIFICATION:** a **Review** button (any staff role) opens the Gate 2 dialog (`components/admin/gate2-review-dialog.tsx`). It posts to `POST /muns/:id/submission/actions/review` (`reviewSubmission`). Approve, Request changes and Reject are the choices. Request changes and Reject need a reason; for REJECTED it is sent as both `notes` and `reason`.
  - **VERIFIED:** "Queue for go-live" (admins only).
  - **GO_LIVE_QUEUE:** "Publish" (admins only). It uses the existing idempotency-key flow and stays disabled until the payment account is VERIFIED, because `publishFromQueue` would refuse anyway.
- **Payment account:** admins get Verify and Reject buttons, which post to `POST /muns/:id/payment-settings/actions/set-verification-state` with VERIFIED or FAILED.

### 2. Conferences (`/admin/muns`, `/admin/muns/:munId`)
- `listAdminMuns`:
  - Search matches MUN name, slug, organizer name or organizer email (ILIKE, with wildcards escaped). There is also a status filter.
  - Each row carries a seated count (CONFIRMED/ATTENDED/NO_SHOW) and a pending count (PENDING/PAYMENT_PENDING).
- `getAdminMunDetail` returns:
  - the MUN, its organizer and its Gate 1 application;
  - registration counts by status;
  - the 15 registry modules, in registry order, with defaults for modules that have no row yet;
  - the latest submission, with its SLA state computed on read and the reviewer's name;
  - the payment-account state. Columns are listed explicitly, so no ciphertext is read.
  - a merged history of `verification_logs` and the `admin_actions` rows that reference the MUN (`target_type` mun or mun_payment_settings, or `metadata.munId`).
- Both are staff-only (`GET /admin/muns`, `GET /admin/muns/:munId`, `no-store`).
- Page:
  - Search and status live in the URL.
  - The detail page covers:
    - overview, Gate 2 review;
    - visibility: Publish / Queue for go-live / Unpublish / Suspend (reason required) / Reinstate, via the existing `/admin/muns/:id/*` routes;
    - lifecycle: Open registration / Close registration / Start conference / Mark completed / Archive / Cancel conference (reason required), via `runLifecycleAction` in `web/src/api/mun-lifecycle.ts`. That client implements the agreed contract `POST /muns/:munId/lifecycle/:action` with `{reason?}` → `{munId, status}`; the endpoint itself comes from the lifecycle lane.
    - admins also see the masked payout details (existing `GET /muns/:id/payment-settings`) with Verify/Reject buttons;
    - module requirement checkboxes (existing `PATCH …/requirement`; FINAL_REVIEW is disabled);
    - history.
  - Which buttons appear depends on the current status (it mirrors `ALLOWED_TRANSITIONS`). The server stays authoritative, and its errors show as toasts.

### 3. Staff (`/admin/staff`)
- `lib/actions/admin-staff.ts` + `server/routes/admin-staff.ts`:

  | Endpoint | Who | What |
  |---|---|---|
  | `GET /admin/staff` | any staff role | Search and role filter. Returns a `passwordSet` flag, never the hash. |
  | `POST /admin/staff` | SUPER_ADMIN | Creates the account. 201 with the account, `setPasswordUrl` and `expiresAt`. |
  | `PATCH /admin/staff/:id/role` | SUPER_ADMIN | Changes the role. |
  | `POST /admin/staff/:id/suspend` | SUPER_ADMIN | Needs a reason. Also deletes the account's sessions. |
  | `POST /admin/staff/:id/reinstate` | SUPER_ADMIN | Lifts a suspension. |
  | `POST /admin/staff/:id/set-password-link` | SUPER_ADMIN | Issues a new set-password link. |

- Safety rules:
  - A staff member can't act on their own account (409).
  - Non-staff targets get 404, and a duplicate email gets 409.
  - Every write first row-locks all SUPER_ADMIN rows and re-checks, under that lock, that the actor is still an active SUPER_ADMIN. Two super admins demoting each other at once therefore can't leave nobody in charge; there is a regression test for this.
- Set-password links:
  - `password-reset.ts` exports no function that returns a token, so `mintSetPasswordLink` writes a `password_reset_tokens` row itself. It uses the same shape as `requestPasswordReset`, with a 24h TTL, and retires older unused links for that user.
  - The ordinary `/reset-password` page and `resetPassword()` consume it; the browser check covered this end to end.
  - The link base is `APP_URL` from `getRuntimeEnv`. The request Origin is only a local fallback.
  - The link is returned to the super admin once (`no-store`) and never written to the audit log.
- **Audit (no migration):** each write stores the closest existing enum value, with the precise event name in `metadata.event`:

  | Event | Stored value |
  |---|---|
  | Suspend | `USER_SUSPENDED` |
  | Create, role change, reinstate, link issued | `ORGANIZER_REINSTATED` |

  The metadata also carries the event details, such as fromRole and toRole. `listAdminActions` (global feed) and `getAuditHistory` (per target) now show `coalesce(metadata->>'event', action)`, so the console shows STAFF_CREATED, STAFF_ROLE_CHANGED and the other precise names.
- `scripts/create-admin.ts` (`npx tsx scripts/create-admin.ts --email … [--name …] [--app-url …]`):
  - Creates or promotes a SUPER_ADMIN (and reinstates the account if it was suspended), then prints a set-password link.
  - Refuses any database host other than localhost/127.0.0.1/::1 unless `ALLOW_REMOTE_ADMIN_BOOTSTRAP=true` is set.
  - A remote run needs `--app-url` or `APP_URL`.
  - The DB client is imported only after that guard passes.
  - The audit row names the account itself as the actor (`SUPER_ADMIN_BOOTSTRAPPED`).
- Page:
  - Everyone sees the directory; OPERATIONS and ADMIN see it read-only, with a note.
  - Super admins get Add staff member, which shows the link once with a Copy button, plus role select, New password link, and Suspend/Reinstate.

### 4. `suspendOrganizer` fix
- `suspendOrganizer` and `reinstateOrganizer` now row-lock the target and only act on `role = ORGANIZER`. Anything else throws `Organizer not found` (404), so staff ids can't be probed this way. The update is also scoped to ORGANIZER.
- Before this, OPERATIONS could suspend an ADMIN or SUPER_ADMIN. Lib and HTTP tests cover it.

### 5. OPERATIONS UI boundaries
- `useAdminPermissions()` (`web/src/lib/admin/permissions.ts`) decides what each role sees:
  - `canPublish` is ADMIN or SUPER_ADMIN;
  - `canManageStaff` is SUPER_ADMIN.
- OPERATIONS never sees publish, unpublish, suspend, reinstate, queue for go-live, payment verify/reject, lifecycle actions or requirement toggles. The browser check confirmed this.
- OPERATIONS keeps the organizer-account Suspend/Reinstate buttons on `/admin/organizers`, because the server allows those for organizer accounts (now organizer accounts only). OPERATIONS also keeps the Gate 2 content decision.

### 6. Overview analytics
- `GET /admin/analytics` (`lib/actions/admin-analytics.ts`, staff only) returns:
  - GMV: the sum of PAID `payments.amount`, grouped by currency. This includes PAID payments flagged as exceptions, because the money was taken.
  - Platform fee total: the sum of `platformFeeAmount`. Rows with a null fee are counted separately and flagged in the UI.
  - Registrations by status.
  - Live MUNs (PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED, CONFERENCE_ACTIVE).
  - Organizers created in the 7 days up to `now`.
- The overview page keeps the five queue tiles unchanged (the E2E spec depends on them) and adds a "Platform activity" KPI row with compact values, plus a registrations-by-status strip.
- Fixed a missing token: the queue tiles used `text-display-sm`, which doesn't exist.

### 7. Staff reads of delegate personal data
- No `admin_action` value fits a read, so `GET /admin/registrations` and `GET /admin/search/registrations` emit one structured log line per request:

  ```
  {event:'pii_read', actorId, route, targetType, targetId, targetIds, count, hasQuery, at}
  ```

  This comes from `lib/actions/admin-pii-read.ts`.
- The search text is never logged; it is often a name or an email.
- Refused requests log nothing.
- A dedicated audit enum is a follow-up.

### 8. Nav and routes
- `nav-config.ts` gains Conferences and Staff.
- `routes.tsx` gains `muns`, `muns/:munId` and `staff` under the admin layout.
- Both edits are additive only.
- The new server routes mount inside `server/routes/admin.ts`, so `server/src/app.ts` and `protected.ts` are unchanged.
- Admin nav: `cn()` was dropping `text-body-md` next to a text colour. The nav now uses plain concatenation, so it renders at 14px.

## Decisions
- `error.ts` is untouched: staff-specific errors are mapped to 400/409 inside `admin-staff.ts` (the same pattern as `registrations.ts`).
- The staff console refuses to create an account for an email that already belongs to a delegate or organizer. Only the bootstrap script promotes an existing account.
- Staff role changes leave sessions alone, because the role is re-read on every request. Suspension deletes sessions.
- The Publish button on the conference detail page requires a VERIFIED payment account even on the legacy direct-publish path. This is deliberately stricter than the server's legacy path.
- My own test junk was removed from the shared local DB: 5 synthetic-currency payments and 12 future-dated users, all created by this lane's analytics test. The test now cleans up after itself.
- A local SUPER_ADMIN `lane-admin-bootstrap-check@munhub.test` and an OPERATIONS account `lane-admin-ops-*@munhub.test` were created in the local DB for the browser check. They are local only.

## Env vars / bindings at deploy
- No new vars. Staff set-password links use the existing `APP_URL` (already `https://munhub.in` in `server/wrangler.jsonc`).
- `scripts/create-admin.ts` needs `DATABASE_URL`, `ALLOW_REMOTE_ADMIN_BOOTSTRAP=true` for Neon, and `--app-url https://munhub.in`, run from a trusted machine.
- No migrations.

## Follow-ups
- **Tests lane (E2E):**
  - `E2E/specs/admin/go-live-queue.spec.ts` asserts the old columns (`Lifecycle status`, `Submission`, `Submitted`, `SLA deadline`, `SLA state`, `Queued`) and action texts. The new columns are `MUN`, `Status`, `SLA`, `Reviewer`, `Payment account`, `Actions`:
    - the SLA badge is in cell 2;
    - the action cell (5) shows `Review`, `Queue for go-live`, `Publish`, or a waiting message.
  - `role-boundaries.spec.ts` should add `/admin/muns`, `/admin/staff` and the new reads (`admin/muns`, `admin/staff`, `admin/analytics`, `admin/go-live-queue/details`).
- **Schema (needs a migration slot):**
  - admin_action values `STAFF_CREATED`, `STAFF_ROLE_CHANGED`, `USER_REINSTATED`, `STAFF_SET_PASSWORD_LINK_ISSUED`, `SUPER_ADMIN_BOOTSTRAPPED`, plus a data migration that rewrites rows carrying `metadata.event`;
  - a `PII_READ` value, or an access-log table, to replace the `pii_read` log line.
- **sec-auth:** if reset tokens become hashed at rest, `mintSetPasswordLink` in `lib/actions/admin-staff.ts` must hash the same way. Better: export a token-minting helper from `password-reset.ts` and call it.
- **Lifecycle gap:** an UNPUBLISHED MUN can't be published again. `UNPUBLISHED → PUBLISHED` isn't allowed, and there is no active submission to enqueue.
- **Payments lane:** the admin payments page shows delegate names without a `pii_read` log. It could call `recordPiiRead`.
- The conference detail page's lifecycle buttons assume the lifecycle lane's `from` states. Adjust `LIFECYCLE_STEPS` in `conference-detail-page.tsx` if that lane's rules differ.
