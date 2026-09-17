# Autonomous run — working context (lead: mun-hub-62)

Read this before touching anything in this run. `PLAN.md` has lanes and gates; this file has
the facts every lane needs and the audit the work list came from.

## Environment facts

- One shared working tree at `A:\Coding\Projects\Mun-hub\MUN-hub`, branch `main`, remote
  `origin` (GitHub `somapujith/MUN-hub`). Several Claude sessions edit it concurrently.
  **Commit only your own paths**: `git commit -m "..." -- <paths>`; check `git diff <file>`
  first. Never `git add -A`, `git commit -a`, bare `git commit`, `git stash`, `git checkout --`.
- `.env` points at **production Neon**. Never run migrate/seed with it. Local Docker Postgres:
  `postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub` (container `mun-hub-db-1`).
  Vitest loads `.env.test` automatically. Run targeted tests with
  `npx vitest run <files> --no-file-parallelism`.
- Dev servers on :5174 (web) and :3001 (API) are shared — don't kill or restart them.
- Web: Vite + React Router v7 + TanStack Query (`web/`), checks: `npx tsc -b --noEmit`,
  `npx oxlint <paths>`. Server: Hono (`server/`), check: `npx tsc --noEmit -p tsconfig.json`.
- Workers never populate custom vars into `process.env`: in `/server` and any `lib/` module it
  imports, read custom vars only via `getRuntimeEnv('X')` (`lib/runtime-env.ts`).
- Never cache an I/O resource at module scope (Workers request isolation) — see CLAUDE.md.
- `cn()` (the `cn` package) drops custom `text-*` size tokens when a text colour follows; don't
  combine a custom size token and a colour through `cn`.
- Seeded demo accounts share password `munhub-demo` (`admin@munhub.test`,
  `student@munhub.test`, `organizer@munhub.test`, …) — local only.

## Audit summary (what this run fixes)

Launch blockers: mock checkout live in prod (free seats); nothing moves a MUN to
REGISTRATION_OPEN; organizers can't finish go-live (missing setup fields, portfolios UI,
branding UI, accommodation toggle, admin Gate-2 buttons); uploads discarded by mock storage;
security gaps (below); no delegate emails.

Security findings to close (severity from the scout):
- Critical: mock payment endpoint live; demo admin password public (prod DB unverified).
- High: in-memory per-isolate rate limiting (ineffective on Workers; login key allows password
  spraying across accounts); signup has no abuse controls.
- Medium: unpublished MUN data public (status param + by-id reads incl. contact person PII;
  unauthenticated write on GET form-fields); API trusts every `*.munhub.in` origin with
  credentials (confirmed live); no security headers; OPERATIONS can suspend admins; reset links
  built from request Origin + localhost trusted in prod + no per-email throttle; guardian
  consent optional, no deletion/export, staff PII reads not logged.
- Low: plaintext session/reset tokens, 30-day sessions, password change keeps other sessions;
  no admin 2FA; enumeration (signup 409, login timing); scrypt cost; latent open redirect
  (`/.//evil.com`); no URL/length validation on organizer fields; uploads trust declared type;
  AES-GCM tag length; NODE_ENV-dependent Secure cookie; console adapter logs OTP/reset links;
  unused Idempotency-Key; webhook has no amount check/replay window.

Out of scope for this run (Phase 2): MUN Passport, certificate issuance + verification page,
reviews, recommendations, saved MUNs, featured listings, team roles & permissions,
delegation/group registration, waitlist, bulk import, SSR/prerendering, two-person approval,
payout execution.

## Log

- 08:23 Run started. Legal/about pages committed (`39a6157`). Lanes assigned; f1 holds
  migration slot 0030. mun-hub-67 declined a lane (no direct user instruction) — payments
  moved to a lead agent.
- 08:40 Payments schema landed (`3b122be`, migration 0031). Nine lead lanes launched as the
  `munhub-launch-lanes` workflow (worktree per lane, serialized merge, then wire + verify).
  A separate `storage` lane agent builds real uploads (KV interim store; R2 not enabled).
- 08:58 Production check (read-only, Neon via server/.dev.vars; `.env` now points at local
  Docker): 30/33 migrations applied (0030–0032 pending); demo accounts incl. the only admin
  still have the public password. Rotation was blocked by the permission classifier →
  `USER_ACTIONS.md` §1.
- f1 committed migrations 0030 (`ba44e79`) and 0032 (`f523604`); 4b wired four pipeline events
  (`21b6c9c`); 84 added MOCK_PAYMENTS_ENABLED/ALLOW_LOCALHOST_ORIGINS to the E2E API env
  (`6699007`) and reports E2E 297+148 passed, 0 failed.
- 09:20 User reported the support chat is buggy → new `support` lane agent (audit in browser, then fix end to end). E2E full suite green at 50b19db (84).
- 09:25 Notification functions committed by 4b (`5559c00`) — wire at merge (each takes one id;
  adapter defaults to getNotificationsAdapter(); lookup failures throw `Registration not found`,
  so wrap call sites in try/catch, fire-and-forget after the transaction commits):
  - `notifyRegistrationConfirmed(registrationId)` → call from `lib/payments/events.ts#onRegistrationConfirmed` (only after CONFIRMED).
  - `notifyPaymentFailed(registrationId)` → `lib/payments/events.ts#onPaymentFailed`.
  - `notifySeatHoldExpired(registrationId)` → from the release-expired-holds job for each released PAYMENT_PENDING registration.
  - `notifyWelcome(userId)` → after a successful delegate signUp (auth route / lib/actions/auth.ts).
  - `notifySupportReply(ticketId)` → already called in `lib/actions/support.ts#sendMessage` after commit when the sender is staff; the support lane must keep exactly this call when it reworks the file.
- 09:55 Merged: lifecycle (`677362f`), org lane 7 = privacy (`7d70683`), storage (`777f48d`).
  4b landed email verification (`97e0ce7`, migration 0033; `assertEmailVerifiedIfRequired(userId)`
  in lib/actions/email-verification.ts → call from the registration path when payments merges).
  f1 landed the go-live backend (`f6fcb7b`): submit-final-confirmation now requires
  `{attested:true}`. Uploads KV binding commented out (token can't create namespaces) →
  USER_ACTIONS §5. Migrations for Neon at deploy: 0030–0033 (+0034 reserved for 4b staff 2FA).
  Test tip: add `--exclude ".claude/**"` when filtering vitest by file name.
- 10:25 Cron jobs exported by 4b (all `(now: Date, adapter?) => Promise<{sent:number}>`), to be
  registered in lib/jobs/registry.ts: `runSlaNotifications` (lib/notifications/sla-job.ts),
  `runConferenceReminders` (lib/notifications/reminder-job.ts), `runOrganizerDigest`
  (lib/notifications/organizer-digest-job.ts). Conference-cancelled emails wired (`e5c6471`).
  sec-edge merged (`270680b`).
- 10:45 From 84: (a) republish after unpublish is impossible (409 no active submission) → routed to
  f1. (b) sec-auth worktree tests rehashed `student@munhub.test` in the shared local DB with the new
  `scrypt$N$r$p$…` format that main can't verify yet — resolves when sec-auth merges; at that merge,
  make seed.ts reset seeded demo hashes that don't verify against munhub-demo (local only).
  devops merged (`0e5b00a`); root `tsc --noEmit` clean at `e99a78f`.
- 11:05 marketplace merged (`186b22b`). f1: republish fix (`fc05d9e`; enqueue works for
  UNPUBLISHED MUNs published before), portfolios UI (`f73ce26`, `6f3d74f`).
  POST-MERGE TODO (lead): admin UI "Queue again" button for UNPUBLISHED MUNs → same enqueue
  endpoint; register 4b's cron jobs; wire assertEmailVerifiedIfRequired + payments/notification
  hooks + notifyWelcome; seed.ts resets demo hashes that don't verify (local only).
  POST-MERGE TODO (lead): data migration deleting seeded REFUND_POLICY mun_documents (storage_key like 'seed/%') — take a slot after 4b's 0034.
- 09:40 All lanes merged: admin `84442fa`, sec-auth `1fabca7`, org-ops `9291296`, payments
  `57b7629`, support `6cce29a` (23 defects fixed; support-form conflict resolved to the support
  version). f1 finished all 7 items (preview `aa85127`) and is on the organizer UX walkthrough.
  Workflow now in wire & verify.
- 09:55 4b: staff TOTP 2FA server side (`900f476`, `e6a0db9`, migration 0034), support-reply deep
  link (`35cd296`). DEPLOY: `munhub-api` needs secret TOTP_FIELD_KEY (fresh 32-byte base64, not
  PAYMENT_FIELD_KEY); REQUIRE_STAFF_2FA stays unset until the user enrolls. New ratelimit
  bindings RL_MFA_VERIFY_IP/TOKEN (namespace ids 1015/1016). 4b now on MFA web UI + admin UX pass.
- 10:05 Lanes workflow finished: wiring commits `f8ea0a9` `9942dc7` `69c7664` `2dfca00`; unit suite
  1,556/1,556, all typechecks/lints/build/dry-run clean. Launched: `followups` agent (slot 0035 +
  wiring leftovers), `munhub-integrated-review` workflow (9 areas, verify, fix, merge), and the
  delegate/visitor UX walkthrough agent. f1 = organizer UX pass, 4b = MFA web UI + admin UX pass.
  Deploy-time vars/secrets list: see the wiring report section in lane change logs + RUNBOOK.
- 10:20 Fixed from 84's E2E: webhook hold-expiry timing + confirmation-page wording (`1d86713`);
  seeded student has a complete profile (`edb7b83`); dev-only cron trigger (`042a436`,
  ENABLE_DEV_ENDPOINTS). f1 organizer UX pass done (`4e62a1d`, log `5888df1`), now on preview
  labels, toaster position, organization name (slot 0036 after 0035). QUEUED (lead): payout
  settings rework — UPI-first, optional bank, no PAN/GST, verificationState PENDING on save
  (needs slot 0037: pan/bank columns NOT NULL today, no UPI column).
- ~11:00–14:36 Usage limit hit ("session limit, resets 11:30") — review fix agents, the followups
  agent and the delegate UX agent stopped mid-work. 14:40 resumed: followups + UX agents continued
  from their transcripts; review workflow resumed from `.claude/workflows/munhub-integrated-review.js`
  with a SKIP filter so re-run fixers don't duplicate fixes already merged (edge `046649c`/`bc7d217`
  pending merge; notifications `1cab522…67fc63f` merged; payments `7dd1c47` `bb65b07` `5014559`
  merged). Review confirmed 43 findings (2 high: staff TOTP brute force; bank-detail change leaves
  payout VERIFIED). Workflow scripts saved under `.claude/workflows/`.

## RECOVERY NOTE (if usage limit hits mid-merge)

If you're reading this because everything stopped: `main` may be sitting mid-merge
(`.git/MERGE_HEAD` exists) from the `munhub-integrated-review` workflow's serialized
merge step. To resume safely:
1. `git status` — if `.git/MERGE_HEAD` exists and there are `<<<<<<<` conflict markers
   in any file, resolve them by hand (check both sides' intent — usually one side is a
   newer/superseding version, see the pattern used to resolve the admin-search.ts
   conflict in commit `6cc3f7d` as an example) then `git add <file> && git commit --no-edit`.
2. If it looks abandoned with NO conflict markers (clean auto-merge, just uncommitted):
   `git commit --no-edit` to finish it.
3. Only use `git merge --abort` as a last resort if the merge looks corrupted — this
   discards the incoming branch's changes, so check `git worktree list` first for the
   branch name and re-merge it fresh instead if possible.
4. Then re-invoke the review workflow with `resumeFromRunId` (see the tool result from
   when it was launched, or search this file for `wf_9c79e016-ace`) — completed
   agents/merges replay from cache, only the interrupted step re-runs.
