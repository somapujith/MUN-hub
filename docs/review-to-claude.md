# Review to Claude — honest state assessment (2026-09-18)

Written after the user asked "so everything is clear and the whole workflow is perfect
right" at the end of the autonomous 6-hour build run + the follow-up "check if everything
is properly done" audit. The answer given was **not** an unqualified yes. This file exists
so a future Claude session reads the same honest boundary instead of inheriting an
inflated sense of confidence from chat history alone. Read this before telling the user
anything is "done" or "perfect."

Detailed narrative of the run itself lives in `docs/autonomous-run/{PLAN,CONTEXT,USER_ACTIONS}.md`
and `docs/autonomous-run/changes/lane-*.md` — this file does not repeat that, only summarizes
what's actually verified vs. not.

## What is genuinely verified (not just claimed)

- Git/deploy/migration state: `main` at `0e88dc6`, 0 ahead/behind origin, no MERGE_HEAD,
  38 migrations applied to production Neon matching git exactly.
- Full test suite: 1868/1868 passing (`npx vitest run --no-file-parallelism` from repo root).
  Root/`server`/`web` `tsc --noEmit` all exit 0. `oxlint` on `web` clean.
- `api.munhub.in` and the other 4 hosts return 200 post-deploy; a DB-backed endpoint
  (`GET /api/v1/muns`) confirmed returning real, current-schema data — not just "deploy
  succeeded", the actual data path was exercised.
- The 5 user-requested features (platform fee, delegation/group registration, admin
  analytics, local load testing, R2 file storage) are live and each was proven end-to-end
  against production, not just deployed — see `USER_ACTIONS.md` items 11-14 for exactly
  what was exercised (real upload/download/byte-compare for R2, a real concurrency test
  for delegation, etc).
- A real, previously-undetected production bug was found and fixed this session: a
  high-impact edit to a `REGISTRATION_CLOSED` mun sent it to `VERIFICATION` for re-review,
  but nothing downstream of `VERIFICATION` has a state-machine edge back to
  `REGISTRATION_CLOSED` (only `CONFERENCE_ACTIVE` can reach it, and only from
  `REGISTRATION_CLOSED` itself) — so the mun was permanently stranded short of
  `CONFERENCE_ACTIVE`/`COMPLETED`/`ARCHIVED`. Fixed in `lib/lifecycle/reverification.ts`
  (removed `REGISTRATION_CLOSED` from `POST_VERIFICATION_STATUSES`, kept the state-machine
  edge itself since admin-only `reinstateMun` still legitimately uses it). Also found and
  fixed while in that code: `lib/actions/mun-documents.ts` had **zero** re-verification
  wiring at all — uploading or deleting a RULES/CODE_OF_CONDUCT/REFUND_POLICY document on an
  already-verified mun triggered no re-review. Both fixed, tested, committed (`0e88dc6`),
  pushed, deployed, verified. This was found by investigating a leftover git worktree
  (`wf_9c79e016-ace-72`) that turned out not to be a duplicate — see git log for detail if
  the reasoning needs re-checking.
- 17 leftover git worktrees from the parallel-agent run were individually checked (not
  bulk-assumed) for unique uncommitted work before removal; all confirmed either fully
  merged already or genuine duplicates of already-merged fixes from a different branch.
  `git worktree list` now shows only `main`. (A handful of empty `server`/`web` subfolders
  under old worktree paths may still be un-deletable on disk due to a lingering Node
  process holding a Windows file lock — harmless, not tracked by git, safe to ignore or
  clean up later once nothing has them open.)

## Known, disclosed gap — now moot (2026-09-19)

Superseded: re-verification was removed on the user's decision (verified MUNs can be edited freely,
see CLAUDE.md "No re-verification after VERIFIED"), so the atomicity gap described in this section
no longer exists — there is no re-verification trigger to run outside the transaction. The text is
kept for history.

Several actions call the re-verification trigger **after** their own DB write completes,
not inside the same transaction: `lib/actions/mun-config.ts` (`updateCommittee`,
`updatePortfolio`, `updateRegistrationProduct`, `updateMunDetails`),
`lib/actions/accommodation.ts`, `lib/actions/executive-board.ts`, `lib/actions/mun-contact.ts`,
`lib/actions/mun-schedule.ts`. If `triggerReverificationIfNeeded`'s internal `transitionMun`
call throws (e.g. an unexpected state), the edit is already committed but the module never
flips to `PENDING_REVIEW` and the mun never moves to `VERIFICATION` — a real but narrow
atomicity gap (only reachable on an error path, not the common case). `lib/actions/payment-settlement.ts`
already does this correctly (write + trigger share one `tx`). Fixing the rest means wrapping
each call site's update + trigger in one `db.transaction(...)`, threading `tx` through to
`triggerReverificationIfNeeded`. Not done this session — flagged, not fixed, because it
touches 5 files of live lifecycle code near the end of a long session; do it carefully with
full test coverage if picked up, not rushed.

## Outstanding, user-facing (unchanged, tracked in `docs/autonomous-run/USER_ACTIONS.md`)

Don't re-derive these — they're already fully written up there with exact steps:
1. Demo credentials (`admin@munhub.test` / `munhub-demo`) still live in production —
   rotation blocked earlier by the auto-mode permission classifier, still not done.
2. `.github/workflows/{ci,deploy}.yml` still missing from `main` (git token lacks
   `workflow` scope) — restore commands are in USER_ACTIONS.md item 8.
3. Organizer team/co-organizer roles — deliberately not built (CLAUDE.md says don't,
   without asking first). A design is ready if the user asks for it.
4. Real Razorpay integration — explicitly the user's own task, not Claude's, per standing
   instruction ("no refunds anywhere in the product; I will integrate the payment gateway
   in the end").

## Scope boundary — what this review did NOT cover

Be honest about this if asked again later, don't imply broader coverage than actually happened:

- This was a targeted audit of git/deploy/migration state plus leftover-worktree triage —
  **not** a fresh full adversarial security/correctness sweep. The last full adversarial
  review (which found and fixed 40+ real issues across auth/edge/payments/authz/lifecycle/
  storage) happened earlier in the same session, **before** the 5 newest features
  (delegation, R2, platform fee, admin analytics, load testing) were built. Nothing has
  re-swept the codebase specifically looking for new issues in that newer code beyond the
  targeted fixes each feature's own build pass made.
- No manual browser QA was performed on the fixes in this review pass, or on the 5 features
  from the prior pass, beyond the specific end-to-end proofs already logged in
  `USER_ACTIONS.md`. The user said they intend to do their own manual testing pass — that
  has not happened yet as far as this file's author knows.
- A green test suite and clean `tsc` prove the absence of the specific bugs being tested
  for, not the absence of bugs generally. Treat "1868/1868 passing" as meaningful evidence,
  not as proof of correctness.
- Local load testing proved no oversell under concurrency locally; it says nothing about
  real production traffic patterns, Workers cold-start behavior under load, or Hyperdrive
  connection-pool limits at scale (see CLAUDE.md's own "Workers-only failure modes" lesson —
  a clean local/test run has been wrong before in this exact codebase).

## Additional flow gaps found (2026-09-18, second pass)

The user asked to specifically go looking for more flow gaps beyond the atomicity issue
above. Found by tracing 5 end-to-end journeys through the actual code (5 parallel research
passes, then the two most severe claims independently re-verified by direct grep before
writing them here — see git history for the exact commit if the citations below ever drift).
None of this has been fixed — this is a findings list, not a changelog. Ranked by severity.

### High severity — real dead ends / silent data-integrity gaps

1. **A Gate-1 `CHANGES_REQUESTED` organizer application has no resubmission path — a
   permanent dead end.** `mun-state-machine.ts:123` declares `CHANGES_REQUESTED: ['SUBMITTED', 'CANCELLED']`
   as a legal transition ("Gate 1 loop"), but a repo-wide grep for every
   `transitionMun(..., 'SUBMITTED', ...)` call site turns up exactly one
   (`lib/actions/organizer-application.ts:127`), and it only fires inside
   `submitOrganizerApplication` for a **brand-new** DRAFT mun. Nothing transitions an
   *existing* `CHANGES_REQUESTED` mun back to `SUBMITTED`. The UI can't paper over this
   either: `organizer-apply-page.tsx`'s "Update your MUN" link goes to `setup-page.tsx`,
   whose `SUBMITTABLE_STATUSES` (line 39) is Gate-2-only and excludes
   `CHANGES_REQUESTED`/`SUBMITTED`/`UNDER_REVIEW`, so no submit action renders there either.
   Calling `submitOrganizerApplication` again doesn't help — it creates an unrelated *second*
   MUN + application row, leaving the original stuck in `CHANGES_REQUESTED` forever. Net
   effect: any organizer whose first-ever application gets "changes requested" instead of an
   outright approve/reject can never get re-reviewed. Re-verified directly (not just trusting
   the research agent): the grep above was re-run and confirms the single call site.
2. **Delegation seats can permanently squat capacity.** `registration-group.ts`'s
   `expireStaleInvitations` (line 68) only flips the *invitation* row PENDING→EXPIRED after
   its 7-day TTL — it never touches the underlying `registrations` row. The placeholder seat
   (`status='CONFIRMED'`, `userId=headUserId`, created in `registration.ts:840-852`) is never
   released, and `CONFIRMED` is one of the `ACTIVE_REGISTRATION_STATUSES` (`registration.ts:44-49`)
   that the capacity check counts against a product. Re-verified directly: confirmed
   `expireStaleInvitations`'s `UPDATE` targets only `registrationGroupInvitations`, and
   confirmed `CONFIRMED` is in `ACTIVE_REGISTRATION_STATUSES`. Net effect: a head delegate who
   registers a team the size of (or larger than) the remaining capacity, and whose teammates
   never accept, permanently occupies those seats — locking out real solo delegates — with no
   job or action anywhere that reclaims them. The head's only lever is re-inviting a
   *different* email into the same still-open slot, never surrendering it.
3. **A `CONFIRMED`+`PAID` registration on a cancelled MUN leaves zero admin-facing trace.**
   `runLifecycleAction('cancel', ...)` (`lib/lifecycle/registration-lifecycle.ts:449-461`)
   deliberately leaves `CONFIRMED` registrations untouched (documented, correct, given "no
   refunds"), and delegates on those rows do get a one-time cancellation email
   (`notifyConferenceCancelled`, `lib/notifications/conference-events.ts:54-106`). But nothing
   ever touches `payments.exceptionReason`/`exceptionRaisedAt` for those payments —
   `PAYMENT_EXCEPTION_REASONS` (`lib/payments/exception-reasons.ts:7-14`) has no
   cancellation-related reason, and `listPaymentExceptions`
   (`lib/payments/exceptions.ts:81-158`) filters on `exceptionReason IS NOT NULL OR
   status='REFUNDED'`, which a cancelled-mun payment never satisfies. So a delegate who paid
   for a now-cancelled conference has a payment that looks completely normal (`PAID`,
   registration `CONFIRMED`) anywhere an admin would look for problems — the only signal
   anywhere is the mun's own `CANCELLED` status and the one email already sent. If the "no
   refunds, but admin can resolve exceptions manually" model is supposed to apply to
   cancellations too, there's currently no queue entry for an admin to act on.

### Medium severity — real gaps, narrower blast radius

4. **No organizer payout ledger of any kind.** `payments.organizerNetAmount` accrues per
   payment (`lib/payments/webhook.ts`) but nothing ever reads it back to mark money "sent" —
   grepped every action/job file for payout/disburse/settlement-as-a-verb, zero hits.
   `getMunPaymentsSummary` (`lib/actions/payment-settlement.ts:289-324`) is a lifetime
   cumulative total scoped to one MUN, not a real "currently owed, net of what's already been
   wired" balance, and there's no cross-MUN per-organizer rollup anywhere in
   `admin-reporting.ts`. This is a known, explicitly-deferred product area (CLAUDE.md: "real
   payment gateway/settlement execution... nothing initiates a payout") — but it's worth
   distinguishing "the gateway isn't built" from "there isn't even a manual tracking tool for
   admin to know who to wire money to and how much," which is the actual current state.
5. **Payment collection isn't blocked when the payout destination goes unverified mid-flight.**
   `mun_payment_settings.verificationState` is only checked once, at the
   `PUBLISHED`→`REGISTRATION_OPEN` transition (`lib/lifecycle/registration-lifecycle.ts:271-273`).
   Once a mun is `REGISTRATION_OPEN`, a bank-detail change resets `verificationState` to
   `PENDING` (`lib/lifecycle/reverification.ts`) but nothing re-checks it before accepting the
   next delegate payment — grepped `lib/actions/registration.ts` and `lib/payments/webhook.ts`
   for `verificationState`, zero matches in either. Money keeps flowing to a mun whose payout
   destination is, at that moment, unverified.
6. **No partial/per-seat cancellation on a paid registration group.** `cancelGroupInvitation`
   (`registration-group.ts:391-408`) only works on a still-`PENDING` invitation and explicitly
   doesn't touch the registration row; `lib/payments/webhook.ts`'s `memberScope()` always
   resolves to the whole group, confirming/cancelling every seat together. Once a group is
   paid, it's genuinely all-or-nothing — no way to drop one seat (a teammate backs out, was
   invited by mistake, etc.) without cancelling the entire team.
7. **A deleted head account orphans their registration group with no self-service recovery.**
   `account-deletion.ts:198-202` only cancels the deleting user's own unpaid holds — a
   `CONFIRMED` placeholder seat they still "own" as head is untouched, and
   `registrationGroups.headUserId` is never reassigned. The head's session/password are wiped,
   so only an ADMIN/SUPER_ADMIN can manage that group afterward; a teammate can still accept
   an invite into a slot nominally "owned" by a deleted user, and any not-yet-sent invite would
   show the inviter's name as "Deleted user."
8. **Accepting a group invite is a one-way, irreversible ownership transfer with no override.**
   Once a teammate accepts, the head keeps read-only roster visibility
   (`getGroupRoster`, line 170-177) but has no function to cancel/replace/kick that seat —
   `cancelGroupInvitation` only works pre-acceptance. There's no path for a head to fix a
   mistake (wrong person accepted, teammate needs to be swapped) without going through
   support/an admin.
9. **Gate-1 organizer applications have no SLA or staleness tracking**, unlike Gate-2's
   `mun_submissions` (which has `slaDeadline`/`slaState`, read by `lib/notifications/sla-job.ts`
   — gated to `munStatus === 'VERIFICATION'`, i.e. Gate-2 only). The `organizerApplications`
   table (`lib/db/schema.ts:946-964`) has no equivalent columns, and none of the 7 registered
   cron jobs (`lib/jobs/registry.ts:130-138`) touch it. An application can sit in
   `SUBMITTED`/`UNDER_REVIEW` indefinitely with no alert to anyone.
10. **No nudge job for organizers stuck in Gate-2 `ACTION_REQUIRED`/`CHANGES_REQUESTED`.**
    `reminder-job.ts` only emails delegates about an upcoming *confirmed* conference; SLA
    notifications only fire while MUN Hub itself holds the review (`VERIFICATION` status). An
    organizer blocked on their own fixes gets no automated reminder to go finish them.
11. **`registration_group_invitations` expiry is a lazy, on-touch sweep, not a scheduled job.**
    `expireStaleInvitations` only runs when something else reads the group (e.g.
    `getGroupRoster`); no cron job in `registry.ts` calls it. An invitation nobody ever looks
    at again (group page never revisited) stays `PENDING` past its own `expiresAt` until
    someone happens to load that group.

### Minor — narrow blast radius, worth knowing

12. On a MUN cancellation, delegates whose registrations were `PENDING`/`PAYMENT_PENDING`
    (silently flipped to `CANCELLED` by the same action) are **not** emailed —
    `notifyConferenceCancelled`'s recipient query filters to `status = 'CONFIRMED'` only
    (`conference-events.ts:74-78`). Only people who'd already paid get told; people who were
    mid-checkout don't.
13. Cancellation notifications have no delegation-awareness — every member of a paid group
    gets the same individual email a solo delegate would, with no "your whole team" framing
    and no group-level digest.
14. `CLAUDE.md:235`'s claim that `organizer_applications.organizer_id` is unique was stale —
    migration `0030_organizer_many_muns` dropped that constraint. Fixed directly in this pass
    (see the CLAUDE.md diff in the same commit as this file). The actual current behavior
    (`acceptOrganizerAgreement` checks via a plain `SELECT`, not a DB constraint) was already
    correct in practice; only the stated reason was wrong.

### Checked and NOT a gap (ruled out, so nobody re-investigates these)

- `CONFIRMED` registrations surviving a MUN cancellation untouched is a **documented,
  deliberate** design choice ("no refunds"), not an oversight — see
  `registration-lifecycle.ts:55-60`'s own comment.
- A rejected Gate-1 organizer **can** submit a fresh application (no unique constraint blocks
  it) — the reapplication path itself works; only the `CHANGES_REQUESTED` loop (item 1 above)
  is actually broken.
- `password_reset_tokens`/`email_login_codes` purge, and abandoned pre-checkout `PENDING`
  registrations, are both already covered by existing jobs (`purge-auth-artifacts.ts`,
  `release-expired-holds.ts` respectively).
- There is exactly one code path for MUN cancellation (organizer and admin both call
  `runLifecycleAction('cancel', ...)`; behavior only branches on role for permission/email
  wording) — not two divergent implementations.
- Raw over-capacity team registration (e.g. requesting a team of 20 against capacity 5) is
  correctly rejected at reservation time; the real risk is the *combination* of a
  smaller/exact-fit team with unclaimed seats never being reclaimed (item 2 above), not a
  missing capacity check itself.

## If picked up again

Highest-value items from the list above, if asked to act on any of them: #1 (Gate-1
`CHANGES_REQUESTED` dead end) is the most clear-cut bug — the state machine already declares
the transition legal, it just needs a real call site and a UI action button, so it's probably
the cheapest fix relative to its impact. #2 (delegation capacity squatting) needs a product
decision first (an expiry sweep that reclaims the seat, not just the invitation — but reclaim
after how long, and does the head get notified?) before it's a pure coding task. #3 (cancelled
paid registrations having no admin trace) needs a decision on whether cancellations should
route into the existing payment-exception queue or a new one. Everything else in the medium/
minor tiers is real but lower urgency — don't self-assign fixes for any of it without asking,
since several (payout ledger, per-seat group cancellation, Gate-1 SLA tracking) are the kind
of scoped-feature decisions CLAUDE.md says to ask about first, not build unprompted.

Otherwise, unrelated to this pass: fix the reverification atomicity gap above if there's time
and a full test pass to back it; do a fresh, scoped adversarial pass over the 5 newest
features (delegation, R2, fees, analytics, load-test perf fix) since they've never had one;
then move to whatever the user actually asks for — don't self-assign work they haven't
requested.
