# Lane: group/delegation registration (2026-09-17)

Feature: a head delegate pays for a whole team in one order instead of each teammate
registering (and paying) individually. Gated on `registration_products.allows_delegation`
(existing column, previously wired to nothing).

Branch: `worktree-agent-ace6251996fce33bd`. Migration slot: **0037** (see "Migration slot"
below for why not 0036).

## Design

One `registrations` row per team member (never one "group" row that fans out) so every
existing per-delegate feature — dashboards, roster, check-in, results, certificates,
communications — keeps working completely unmodified. Group membership is metadata bolted
onto the existing table, not a parallel structure those features would need to learn about.

### New tables (`lib/db/schema.ts`)

- **`registration_groups`** — `munId`, `registrationProductId`, `headUserId`, `teamSize`,
  `headRegistrationId` (nullable text FK to `registrations.id`), `paymentId` (nullable FK to
  `payments.id`, a convenience pointer for "total paid" without following
  registrations→payments through the head row).
- **`registration_group_invitations`** — `groupId`, `registrationId` (which slot this invite
  targets), `email`, `invitedName`, `tokenHash` (SHA-256, same convention as
  `email_verification_tokens` — never store the raw token), `status`
  (`registration_group_invitation_status` enum: PENDING/ACCEPTED/EXPIRED/CANCELLED),
  `expiresAt`, `lastSentAt` (bumped on resend, cooldown reference), `acceptedAt`,
  `cancelledAt`.
- **`registrations.registrationGroupId`** — nullable FK to `registration_groups.id`.

### The "unclaimed placeholder" trick — read this before touching any of this code

`registrations.userId` stays `NOT NULL` (making it nullable would ripple through dozens of
call sites that assume a real user — a far bigger blast radius than this feature justifies).
So when a group of `teamSize` is started, **all `teamSize` registration rows are created
immediately**, and every row *except* the head's own is temporarily tagged
`userId = headUserId` — the head "owns" every seat until a teammate accepts an invitation,
at which point `acceptGroupInvitation` reassigns that one row's `userId` to the accepting
user. This is what makes seats real (they count toward `ACTIVE_REGISTRATION_STATUSES`,
capacity, and the "already have an active registration" check) atomically, at group-start
time, using the exact same row-lock discipline solo registration already has — no schema
change with a bigger footprint, no second capacity-counting mechanism.

The corollary, and the source of two real bugs this session's own browser walkthrough
caught (see "Bugs found via the browser check" below): **a row's `userId` being the head is
not the same as the row being the head's own registration.** `registrationGroups.headRegistrationId`
is the only reliable signal for "this specific row is genuinely the head's." Any code that
needs to tell "the head's own seat" apart from "an unclaimed placeholder the head is
temporarily squatting on" must compare against `headRegistrationId`, and any code that needs
to tell "is this row's *current* owner still just a placeholder" apart from "a genuinely
claimed teammate" must compare `userId` against `headUserId` — never assume one implies the
other's negation.

Invitations target a specific slot (`registrationId`), not just "the group" — cancelling an
invitation never touches the registration row, it just frees that slot for a fresh
invitation to a different address (a slot is "open" iff it has no PENDING, unexpired
invitation). A slot can accumulate more than one invitation row over its life, which is why
`schema.ts` deliberately does **not** add a `registrations.groupInvitation` one-to-one
relation — see that decision documented inline in `lib/db/schema.ts`'s `registrationsRelations`.

### Scope cuts (explicit, not oversights)

- **No committee/portfolio selection in the group flow.** Portfolios are one-delegate-each;
  "assign a portfolio to 3 not-yet-named people" doesn't map cleanly onto the existing model.
  An organizer can still assign committees/portfolios to individual members afterwards via
  the roster, same as always.
- **No accommodation in the group flow.** Accommodation answers are per-person and the head
  can't answer on a teammate's behalf sight-unseen.
- **Invitations only after the group's own payment confirms.** There is no per-member
  payment step anywhere (explicit product requirement) — inviting before payment would let
  a teammate accept a seat that could still lapse unpaid when the 15-minute hold expires.
  `inviteGroupMember` enforces this (`GROUP_ERRORS.notPaid`).
- **Max team size 20** (`GROUP_MAX_SIZE`, `lib/actions/registration.ts`), min 2
  (`GROUP_MIN_SIZE`) — a sane ceiling, not a researched business number.

## Backend

### `lib/actions/registration.ts` — `initiateGroupRegistration`

Sits in the same file as `initiateRegistration` (not a separate module) because it reuses
that function's private helpers directly: `ACTIVE_REGISTRATION_STATUSES` (now exported),
`findByIdempotencyKey` (extended to also select `registrationGroupId`, so a replayed
group-start request can be told apart from a replayed solo one), `isUniqueViolation`,
`RESERVATION_TTL_MS`. Same transaction shape as solo registration: share-lock the mun,
row-lock the product (`FOR UPDATE`) — every concurrent `initiateRegistration` /
`initiateGroupRegistration` call for one product serializes on that lock, so a group
reserving N seats can never oversell against a simultaneous solo reservation or another
group. Capacity check is `activeRegistrations.length + teamSize > product.capacity`, the
direct N-seat generalization of solo's `+ 1`.

Price = `effectivePassPrice(product, now).price * teamSize` (early-bird, if running, applies
per seat) → one fee breakdown (`computeFeeBreakdown`) on the total → one payment row,
attached to the **head's own registration id** (the "anchor"). `POST /registrations/group`
requires the same `Idempotency-Key` header and gates on `isProfileComplete` +
`assertEmailVerifiedIfRequired`, same as solo `POST /registrations`.

### `lib/payments/webhook.ts` — generalized to confirm/cancel a whole group at once

`applyEvent` now reads `registrations.registrationGroupId` (and `userId`, which for the
anchor row is always the head's) alongside `status`/`expiresAt`. A new `memberScope(groupId,
registrationId)` helper returns "every row in this group" when there is one, else "just this
row" — used as the WHERE-scope for the confirm (payment.captured), fail (payment.failed),
and hold-expired-at-capture-time branches, so a group's seats settle **together** with a
single bulk UPDATE, the same statement shape solo registration already used. `TxResult`'s
`confirmedRegistrationId`/`failedRegistrationId` became `confirmedRegistrationIds`/
`failedRegistrationIds` (arrays); `processPaymentWebhook` now loops over them, firing one
`onRegistrationConfirmed`/`onPaymentFailed` hook call per id — never batched into one email.

`notifyTargets(rows, anchorRegistrationId, headUserId)` decides who actually gets a
lifecycle email: the anchor (head) always, plus any sibling whose `userId !== headUserId`
(a genuinely claimed teammate). An unclaimed placeholder never gets a payment-lifecycle
email — it has no real recipient yet; it gets its own invitation email later, from a
completely different code path (`inviteGroupMember`), once someone is actually invited into
it.

**Do NOT touch payment-adapter internals** for this feature — `mock-adapter.ts`, `adapter.ts`,
`registry.ts`, `fees.ts`, `pricing.ts` are all unchanged. Only `webhook.ts`'s settlement logic
was generalized, per the task's own instruction.

### `lib/actions/registration-group.ts` — new file, head-delegate + invitee actions

- `getGroupRoster(groupId, session)` — head or ADMIN/SUPER_ADMIN only (`assertHeadOrAdmin`).
  Returns mun/product names, `teamSize`, the group's shared `status` (read off the head's own
  row — every seat in a group moves together), `payment` summary, and one `slot` per
  registration row: `isHead`, `member: {name, email} | null` (set once claimed — head or an
  accepted teammate), and the slot's most recent invitation (any status) if one was ever sent.
- `inviteGroupMember(groupId, email, invitedName, appUrl, session, adapter?)` — locks every
  still-open (head-owned, non-head) slot `FOR UPDATE`, picks the first one with no live
  PENDING invitation, inserts the invitation row, emails a plain-text link (mirrors
  `lib/actions/password-reset.ts`'s own email pattern — no HTML template for this one, unlike
  the OTP template). 7-day expiry.
- `resendGroupInvitation` — rotates the token, extends expiry, 60-second cooldown measured
  off `lastSentAt`.
- `cancelGroupInvitation` — PENDING → CANCELLED, frees the slot.
- `getInvitationPreview(token)` — **public, no auth** — the token itself is the credential,
  same stance as password-reset/email-verification's own token routes. Lazily flips a
  past-expiry PENDING row to EXPIRED and reports whichever status is now current, so the
  accept page can show a friendly per-state message instead of a bare error.
- `acceptGroupInvitation(token, formResponses, session)` — one transaction: locks the
  invitation row, the target registration row, and reads the group row; rejects the head
  accepting their own invite, a double-join (already a member of this group), and — reusing
  the exact solo-flow message — a second active registration for the same product outside
  this group. On success, reassigns `userId` and writes `formResponses` on the slot, marks
  the invitation ACCEPTED. Every failure path (unknown/expired/already-consumed/claimed-by-
  someone-else token) throws the same generic `GROUP_ERRORS.invalidInvite` — no enumeration
  of which case it was, same stance as password-reset's token check.

Error messages are registered in `server/middleware/error.ts` (`mapThrownError` +
`KNOWN_ERROR_MAPPINGS`), and the two new solo-side messages
(`delegationNotAllowed`/`groupSizeInvalid`) too.

### Routes — `server/routes/registration-groups.ts` (new), mounted in `protected.ts`

`POST /registrations/group`, `GET /registration-groups/:id`, `POST
/registration-groups/:id/invitations`, `POST
/registration-groups/invitations/:invitationId/{resend,cancel}`, `GET
/group-invitations/:token` (public), `POST /group-invitations/:token/accept`. Mixed
auth-per-route in one file, same pattern `registrations.ts` already used (some routes public,
some `requireAuth`) — not a hard rule that everything in one file shares one auth level.

### Visibility for organizers/admins

`lib/actions/organizer-dashboard.ts`'s `getDelegateList` now joins
`registrationGroup: {id, teamSize, headUser: {name}}` onto each roster row, so the
organizer's roster page can show a "Group · paid by `<head name>`" indicator instead of
looking like N unrelated transactions that happen to share a pass.

## Web

- **Entry point**: on the pass-selection step of the existing funnel
  (`registration-form.tsx`), a "Register as a group" link appears under the pass list
  whenever any pass has `allowsDelegation` and at least 2 seats open, linking to
  `/register/:slug/group?product=<id>`.
- **`web/src/pages/register/group-register-page.tsx`** (new) — the head's own funnel: team
  size → own details → review/pay. Confirming calls `POST /registrations/group` and
  navigates to the **existing, unmodified** `/register/:slug/pay` page — reuse, not a new
  checkout screen, works because the payment always attaches to the head's own registration
  id, so the existing pay/confirmation pages need no group-specific checkout logic at all.
- **`web/src/components/registration/dynamic-field.tsx`** (new) — `DynamicField`,
  `isFieldVisible`, `CORE_KEYS`/`CORE_LABELS`, `controlClassName` extracted out of
  `registration-form.tsx` so the group-start page and the invite-accept page render the
  exact same per-mun question widgets instead of forking a second copy.
- **`web/src/pages/group-invite-accept-page.tsx`** (new, route `/group-invite?token=`) —
  token-consuming page, same shape as `reset-password-page.tsx`/`verify-email-page.tsx`:
  public preview first (via `getInvitationPreview`), then a sign-in/sign-up prompt if signed
  out (preserving `?redirectTo=`), then the delegate-details form (via the shared
  `dynamic-field.tsx` pieces, pre-filled from the invitee's own profile) and "Accept and join
  the team". **Deliberately does not mount `<RegistrationForm>` itself** — that component is
  built around a pass-selection step and a payment step, neither of which apply here (the
  seat is fixed, the team already paid) — see the file's header comment for the reasoning;
  reuse happens at the `dynamic-field.tsx` layer instead.
- **`web/src/pages/dashboard/group-manage-page.tsx`** (new, route `/dashboard/groups/:groupId`)
  — head's roster: accepted/pending/cancelled/open per slot, invite form, resend/cancel,
  total paid.
- **`register-confirmation-page.tsx`** — a `CONFIRMED` group-head registration shows "Your
  team is registered" / "Invite your team" (→ the manage page) instead of "You're
  registered" / "View your pass".
- **`registration-card.tsx`** (student dashboard) — a "Group registration" badge on any row
  with `registrationGroupId`, and a head-only "Manage your team" link (see bugs below for why
  it's gated on `isGroupHead`, not just `registrationGroupId`).
- **Organizer roster** (`registrations-page.tsx`) — a small "Group · paid by `<head name>`"
  line under the delegate's name/email/institution.

## Bugs found via the browser check (not caught by unit/integration tests — logged here so the pattern is remembered)

The task's own instruction to browser-check the flow caught two real bugs that 155+ passing
unit/integration tests did not, because none of them exercised "load the dashboard as a
second, already-signed-up user who just accepted an invitation":

1. **A claimed teammate's own registration was invisible on their own dashboard.**
   `lib/actions/student-dashboard.ts`'s `isOwnRegistration` filter (added to hide unclaimed
   placeholders from the *head's* dashboard) originally compared `row.id === headRegistrationId`
   and excluded the row otherwise — which also excluded an accepted teammate's own row from
   *their own* list, since their row's id is never `headRegistrationId` either, but it is
   genuinely theirs. Fixed by comparing `row.userId` against the group's `headUserId` instead:
   a row is only ever hidden when it's *still* sitting under the head's own id. Covered by a
   new regression test in `lib/actions/student-dashboard.test.ts`.
2. **A non-head teammate saw a "Manage your team" link that would 403 them.** The dashboard
   card's link was gated on `registrationGroupId` being set, which is true for every seat in
   a group, not just the head's. Added `isGroupHead` (computed server-side by comparing a
   row's id against the group's `headRegistrationId`) to both `GET /me/registrations/*` and
   `GET /registrations/:id`, and gated the dashboard-card link and the confirmation page's
   group branch on it — a teammate now sees the normal "Group registration" badge (informative,
   harmless) but not the head-only management link/copy.

Both are exactly the class of bug this project's own CLAUDE.md keeps rediscovering: logic
that reads correctly for the one persona a test happened to check, wrong for a second persona
nobody drove through the UI. Left as a reminder for whoever touches this code next: if you
change anything about who can see or do what with a group, re-run the two-account browser
walkthrough, don't just re-run the unit tests.

## Migration slot

Highest committed file on this branch was `0035`. `docs/autonomous-run/PLAN.md`'s migration
table (written during an earlier, now-completed autonomous run) marks slot `0036` reserved
for a different, unrelated lane's payout-settings rework, and slot `0037` explicitly "free."
This worktree is sandboxed from seeing any other currently-running session's live state, so
rather than guess whether `0036` has since been claimed elsewhere, this lane took the
explicitly-free `0037` (`drizzle/0037_registration_groups.sql`, journal entry `idx: 37`,
`tag: 0037_registration_groups`) and skipped `0036` entirely — no collision either way,
regardless of when/whether the payout-rework migration lands. **Lead: please confirm at merge
time whether slot 0036 was ever actually used; if not, it's still open for whoever needs it
next.**

## Testing

- **`lib/actions/registration-group.test.ts`** (new) — `initiateGroupRegistration`: seat/order
  math, free-pass path, `allowsDelegation` gate, team-size bounds, capacity refusal, the
  head's own "already have an active registration" refusal, idempotent replay, and a
  concurrency test (one 3-person group racing five solo callers for capacity-5 last seats —
  never oversells, the group's own reservation is all-or-nothing). Plus roster/invite/resend/
  cancel/accept coverage: head-vs-stranger-vs-admin authz, the "every seat has a pending
  invite" refusal, cancel-then-reinvite freeing a slot, resend cooldown/token rotation, claim
  correctness, head-can't-accept-own-invite, double-join refusal, stranger-reusing-a-consumed-
  token refusal, cross-product active-registration refusal, and lazy expiry.
- **`lib/payments/webhook.test.ts`** — 4 new cases: group-wide confirm (with the
  head-plus-already-joined-only notify assertion), group-wide cancel-on-failure, group-wide
  release-on-hold-expiry, and a mixed case where one sibling was already independently
  cancelled before the capture arrives (confirms the bulk update's own `status =
  'PAYMENT_PENDING'` guard, not just the outer transaction, protects it).
- **`lib/actions/student-dashboard.test.ts`** — the regression test for bug #1 above.
- **`server/integration/registration-groups.integration.test.ts`** (new) — `POST
  /registrations/group` profile-gate and `allowsDelegation` gate over HTTP; roster/invite/
  resend/cancel authz (head vs. stranger vs. staff, vs. signed-out); the accept flow end to
  end over HTTP (public preview, 401 signed-out, successful accept, then a second account
  reusing the same now-consumed token gets a 400, never a state-revealing error).
- Full suite: **1835/1835 passing**, root/server `tsc --noEmit` clean, `web`'s `tsc -b
  --noEmit` + `oxlint` (warnings only, all pre-existing patterns) + `vite build` clean.
- **Manual browser walkthrough** (Playwright, driving the locally-installed Chrome, against
  API :3130 / web :5230, `MOCK_PAYMENTS_ENABLED=true`): signed up a head + two teammates via
  the real signup API, registered a 3-person group on a seeded delegation-enabled pass
  (`allows_delegation` flipped via a direct local-Docker-only SQL update — never against
  `.env`), paid with the mock provider, invited both teammates, accepted one via the emailed
  link (recovered from the local API process's console output, since the dev/test mail
  adapter never sends real email), and confirmed: the head's dashboard shows one confirmed
  registration + "Manage your team"; the joined teammate's dashboard shows their own
  confirmed registration, a "Group registration" badge, and *no* "Manage your team" link; the
  organizer's roster shows both as "Group · paid by Head Delegate". This run is what
  surfaced both bugs above — both were fixed and re-verified live before this lane was
  considered done.

## Things the lead/reviewer should double-check before merging

1. **Migration slot 0036 vs 0037** — see above. If another lane already landed `0036`, this
   lane's `0037` is still safe (no number collision), but worth a sanity check that the
   journal's `idx: 37` entry (which intentionally skips `36`) doesn't confuse anyone reading
   `drizzle/meta/_journal.json` later.
2. **No migration was applied to Neon** — only local Docker, per instructions. `drizzle/0037_registration_groups.sql`
   needs to run at the next deploy window alongside whatever else is pending.
3. **`registration_group_invitations.email`/`invitedName` are organizer-entered PII** (the
   invitee's own email/name, before they have an account) — not currently covered by any
   staff-PII-read audit logging the way `admin-pii-read.ts` covers other flows. Worth a look
   if/when this feature gets a real security pass, though the data is no more sensitive than
   what's already in `registrations.formResponses`.
4. **`inviteGroupMember`'s email is plain text**, not the branded HTML template
   `otp-email.ts` uses — a deliberate choice (matches password-reset/email-verification's own
   plain-text pattern more closely than the OTP template), but if this project moves toward
   branded HTML for all lifecycle email, this one should move with it.
5. The manual browser check reused one seeded delegation-enabled mun across several runs and
   had to bump its `registration_products.capacity` mid-session after exhausting it — that
   mun and its accumulated test registrations were deleted afterward (see this lane's final
   cleanup step), but if anything with a slug starting `browser-check-group-mun-` turns up in
   local Docker later, it's leftover from an interrupted run of this check, safe to delete.
