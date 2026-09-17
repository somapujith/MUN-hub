# mun-hub-4b: email/notifications lane

Owns `lib/notifications/**` and email-verification code. This file is the running change log for the autonomous run.

## Before the run (already on main)

- ZeptoMail adapter + selector (bca0883), landed real production email delivery — confirmed with a live send against `api.munhub.in` (204, 554ms, no delivery-failure log).
- `NotificationPayload.html` + branded OTP email template (a8bea5e), consumed by mun-hub-f1's organizer OTP login (147fc18).

## Log

| Time | Commit | Change |
|---|---|---|
| T+0 | 90125d3 | resolve-recipients.ts: buildPublicMunUrl reads APP_URL via getRuntimeEnv, not process.env. Added APP_URL to .env/.env.example/.env.test/.dev.vars/wrangler.jsonc. Flagged server/routes/sitemap.ts's same-bug NEXT_PUBLIC_APP_URL to mun-hub-62 (not my lane). |
| T+0 | 21b6c9c | Wired PUBLISHING, RESUBMISSION (vs NEW_SUBMISSION), UNDER_REVIEW, READY_FOR_SUBMISSION pipeline events (go-live.ts, organizer-confirmation.ts, module-completion.ts) + 5 new tests in go-live-notifications.test.ts. ONBOARDING_STARTED still pending — its trigger is in lib/actions/admin-review.ts, asked mun-hub-62 who owns that file. |
| T+0 | 5ba5d94 | Gate-1 decision emails: new lib/notifications/organizer-application-events.ts (separate OrganizerApplicationEvent union, not PipelineEvent variants — Gate-1/Gate-2 collision avoidance) + wired into reviewMunApplication (admin-review.ts), which also now fires ONBOARDING_STARTED on APPROVED. Coordinated turns on admin-review.ts with mun-hub-f1. All 5 originally-listed pipeline events now wired. |
| T+0 | 5559c00 | Delegate emails: notifyRegistrationConfirmed/notifyPaymentFailed/notifySeatHoldExpired (registration-events.ts), notifyWelcome (welcome-email.ts), notifySupportReply (support-reply-email.ts, wired directly into support.ts#sendMessage since I own that file). All respect users.emailNotificationsEnabled via new email-preference.ts. Sent exact signatures to mun-hub-62 for their payments/lifecycle hook wiring. |
| T+0 | ffb6342 | Security hardening (audit finding): getNotificationsAdapter() throws in production without ZEPTOMAIL_TOKEN instead of silently logging OTP/reset links to console. Dev/test EMAIL_OUTBOX_FILE feature for mun-hub-84's E2E coverage (JSON lines: to/subject/text/html/sentAt), never active in production. |
| T+0 | 97e0ce7 | Email verification: migration 0033 (email_verification_tokens, users.email_verified_at, backfilled), lib/actions/email-verification.ts (send/resend/verify/isEmailVerified/assertEmailVerifiedIfRequired), POST /verify-email + /verify-email/resend routes, /verify-email web page + resend form. assertEmailVerifiedIfRequired NOT wired into registration.ts by me — mun-hub-62 adds that call at merge. All lane tasks now complete: 5/5 pipeline events, Gate-1 emails, delegate emails, production hardening, email verification. |
| T+1 | 270680b | New tasks from mun-hub-62: SLA job runSlaNotifications (lib/notifications/sla-job.ts) — idempotent via the existing mun_submissions.slaState column as a watermark, no new migration. Landed inside a merge commit (270680b, "Merge branch 'worktree-wf_a8625366-3be-3'") — my `git add` raced an in-progress merge's conflict resolution; confirmed with mun-hub-62 the content is intact and unchanged (0-line diff against my working tree). |
| T+1 | e5c6471 | Conference-cancelled emails: lib/notifications/conference-events.ts#notifyConferenceCancelled (every CONFIRMED delegate + organizer-if-admin-cancelled, reason from verification_logs, no-refund-wording, /legal/refunds link). lib/lifecycle/lifecycle-events.ts's stub now re-exports it — that file is mine per mun-hub-62. Staff 2FA (migration slot 0034 reserved) on hold until the sec-auth lane merges — waiting on mun-hub-62's go-ahead. |
