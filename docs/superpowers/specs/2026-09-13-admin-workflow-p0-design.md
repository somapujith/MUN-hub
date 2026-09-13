# Admin Workflow P0 — Design

**Date:** 2026-09-13
**Source PRD:** `MUNHub_Admin_Workflow_PRD.md`
**Status:** approved for implementation planning

**2026-09-13 update:** the refund workflow (track 6 below) was fully
descoped and removed after implementation. Over 4 fix rounds (3
red-team-verified with live exploit reproduction), a concurrent-request
race allowing a single payment to be refunded multiple times could not be
closed with an application-level fix — the last attempt in progress was a
DB-level partial-unique-index approach when the user decided to drop
refunds from this slice entirely rather than continue. All refund code,
schema (`refund_requests` table, `refundStatusEnum`, the two `REFUND_*`
admin action values), and `PaymentsAdapter.refund()` were removed. See
`docs/superpowers/plans/2026-09-13-admin-workflow-p0.md` Task 6 notes and
the SDD ledger for the full incident history if refunds are revisited
later — the two-phase-commit architecture from round 2 was sound, the
remaining gap was in request-time concurrency control, and a DB-level
unique constraint (not another application-level status check) is the
right next attempt.

## 1. Scope

Full PRD covers 39 sections / 19 nav items / 6 admin roles — far beyond one slice
(P1/P2 items explicitly deferred by the PRD's own section 38). This spec covers
the **P0 list** (PRD section 38), minus what already exists in the codebase:

**Already built, untouched by this spec:**
- Admin auth/session (`lib/auth/adapter.ts`, `getSession()`)
- RBAC via `requireRole()` (`lib/auth/authorize.ts`) against `roleEnum`
  (STUDENT/ORGANIZER/OPERATIONS/ADMIN/SUPER_ADMIN)
- Organizer application review (`lib/actions/organizer-application.ts`,
  `organizer_applications` table)
- MUN verification (module-level + whole-mun), change-requests, publish gate
  (`lib/lifecycle/*`, `app/admin/verification/`, `app/admin/review/`)

**New in this spec, 6 delivered tracks (a 7th, refunds, was descoped — see update above):**
1. Admin overview + nav shell
2. General audit log (`admin_actions` table)
3. Organizer management (list, suspend/reinstate — login-block only, no MUN cascade)
4. MUN unpublish/suspend actions (publish already exists; unpublish/suspend don't)
5. Registration + payment monitoring (global search, `PAYMENT_EXCEPTION` flagging)
6. Support tickets (full lifecycle, student/organizer/admin facing)

~~Refund workflow (request → approval → mock-provider refund)~~ — descoped, removed.

**Explicitly deferred (P1/P2 per PRD):** results/certificates verification,
fraud/risk scoring, two-person approval, SLA automation, task
queue/assignment engine, moderation-case UI, analytics dashboards, granular
Verification/Finance/Support/Moderator roles (OPERATIONS stays the one
generic ops role for all of these — confirmed with user, avoids an enum
migration + RBAC split nobody can use yet).

## 2. Decisions locked with user

- **Roles:** no new enum values. All new admin surfaces gate on
  `OPERATIONS`/`ADMIN`/`SUPER_ADMIN` via `requireRole`, same pattern as
  existing admin-review code. Finance/Support/Moderator distinctions are
  documentation-only for now (PRD section 2 language, not enforced roles).
- **Refunds:** full state machine + DB records land now. Actual provider
  refund call is a new `refund()` method on the existing mock
  `PaymentsAdapter` interface (`lib/payments/adapter.ts`) — mirrors how
  `createOrder`/`verifyWebhookSignature` are mocked today. Real Razorpay
  refund wiring deferred to whenever Razorpay itself gets wired in.
- **Support tickets:** full lifecycle (`NEW → ASSIGNED → IN_PROGRESS →
  WAITING → RESOLVED → CLOSED`), category/priority per PRD section 19,
  creatable by student/organizer/admin, not admin-only shell.
- **Organizer suspend:** login-block + flag only. Does **not** cascade to
  auto-unpublish the organizer's MUNs — admin reviews and acts on each MUN
  separately. Smaller blast radius; matches "admin reviews, doesn't
  auto-execute" spirit of PRD section 31 (overrides are exceptional).
- **Audit log coverage (P0):** all three action families —
  organizer/MUN lifecycle (`ORGANIZER_SUSPENDED`, `ORGANIZER_REINSTATED`,
  `MUN_UNPUBLISHED`, `MUN_SUSPENDED`; `MUN_VERIFIED`/`MUN_REJECTED`/
  `MUN_PUBLISHED` already logged via `verificationLogs` and are NOT
  duplicated into `admin_actions` — see section 4), refund decisions
  (`REFUND_APPROVED`, `REFUND_REJECTED`), and support/moderation actions
  (`TICKET_ASSIGNED`, `TICKET_RESOLVED`, `USER_SUSPENDED`).

## 3. Data model

New tables in `lib/db/schema.ts`, new enums in `lib/db/schema-enums.ts`.

### `admin_actions` (general audit log)

```
id, actorId (FK users), action (adminActionEnum), targetType (text — 'mun'|'user'|'refund_request'|'support_ticket'),
targetId (text), reason (text, nullable), metadata (jsonb, nullable — before/after values),
createdAt
```

Append-only. Never updated or deleted (mirrors `verification_issues`
append-only pattern already in the codebase). Indexed on `(targetType,
targetId)` and `actorId` for the audit-history views PRD section 30 tab 13
implies.

`adminActionEnum` values for P0: `ORGANIZER_SUSPENDED`, `ORGANIZER_REINSTATED`,
`MUN_UNPUBLISHED`, `MUN_SUSPENDED`, `REFUND_APPROVED`, `REFUND_REJECTED`,
`TICKET_ASSIGNED`, `TICKET_RESOLVED`, `USER_SUSPENDED`.

**Why not log MUN_VERIFIED/PUBLISHED/REJECTED here too:** those already
write to `verificationLogs` with the same actor/target/reason/timestamp
shape. Duplicating into `admin_actions` would mean two audit trails can
diverge. `admin_actions` is for actions that have nowhere else to log today
— `getAuditHistory(targetType, targetId)` merges both sources when reading.

### `users` — suspension columns (new, nullable)

```
suspended: boolean not null default false
suspendedReason: text, nullable
suspendedAt: timestamp, nullable
```

Login (`getSession` / mock sign-in path) must reject a suspended user —
this is the actual enforcement point, not just a UI flag.

### MUN status — no new enum value needed

PRD wants "suspend" distinct from "cancel" (suspend = reversible hide,
cancel = terminal). The existing `MunStatus` enum has no `SUSPENDED` value
and `CANCELLED` is terminal (no outgoing transitions). Adding a real
`SUSPENDED` status means new transition edges in
`lib/lifecycle/mun-state-machine.ts`.

Chosen approach: add `SUSPENDED` to `munStatusEnum`, with transitions:
- Any of `PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED,
  CONFERENCE_ACTIVE` → `SUSPENDED` (admin-only, via `requireRole`)
- `SUSPENDED` → the state it was suspended from is NOT preserved (simpler:
  reinstate always goes to `VERIFICATION`, re-running the verification gate
  before going live again — cheapest correct choice, avoids storing
  "previous status")
- `SUSPENDED` → `CANCELLED` (admin decides suspension is permanent)

`unpublishMun` is a lighter action: `PUBLISHED → VERIFIED` (no suspension
semantics, just pulls it back to pre-publish state, organizer can fix and
re-publish once still-VERIFIED — no re-verification needed since nothing
about the content changed, this is a pure visibility toggle). Only legal
from `PUBLISHED` itself, not from `REGISTRATION_OPEN` onward (once
registrations exist, pulling back below VERIFIED would orphan them —
suspend is the only path from those states).

### `refund_requests`

```
id, registrationId (FK registrations), paymentId (FK payments),
requestedBy (FK users), reason (text), amount (integer, paise — matches payments.amount),
status (refundStatusEnum: REQUESTED | APPROVED | REJECTED | REFUNDED),
approverId (FK users, nullable), approvedAt (timestamp, nullable),
providerRefundId (text, nullable), createdAt, updatedAt
```

State machine in `lib/lifecycle/refund.ts`, same row-lock pattern as
`transitionMun`/`initiateRegistration`:
- `REQUESTED → APPROVED | REJECTED` (admin, `requireRole(OPERATIONS+)`)
- `APPROVED → REFUNDED` (calls `PaymentsAdapter.refund()`, then updates
  `registrations.status` to `REFUNDED` and `payments.status` to `REFUNDED`
  in the same transaction — row-locks the registration like the existing
  webhook handler does, so a refund can't race a concurrent webhook
  confirming the same payment)
- Terminal: `REJECTED`, `REFUNDED`

`PaymentsAdapter` gains:
```ts
refund(providerPaymentId: string, amount: number): Promise<{ providerRefundId: string }>
```
Mock implementation returns a fake ID immediately (same style as
`createOrder`).

### `support_tickets`

```
id, createdBy (FK users), category (supportCategoryEnum), priority (supportPriorityEnum),
status (supportStatusEnum), subject (text), description (text),
assignedTo (FK users, nullable), relatedRegistrationId (FK registrations, nullable),
relatedMunId (FK muns, nullable), createdAt, updatedAt
```

`supportCategoryEnum`: `REGISTRATION | PAYMENT | REFUND | MUN_INFO | ACCOUNT |
CERTIFICATE | ORGANIZER | TECHNICAL | SAFETY_POLICY` (PRD section 19).
`supportPriorityEnum`: `LOW | NORMAL | HIGH | URGENT`.
`supportStatusEnum`: `NEW | ASSIGNED | IN_PROGRESS | WAITING | RESOLVED | CLOSED`.

A `support_ticket_messages` thread table is NOT in scope — P0 ticket detail
is single description + admin resolution notes, no threaded replies (matches
"basic support" in PRD's own P0 line item; threaded messaging would need a
notification-on-reply loop that's out of scope here).

## 4. Actions / lifecycle files

- `lib/audit/log.ts` — `recordAdminAction(actorId, action, targetType, targetId, reason?, metadata?)`.
  Thin insert wrapper, called from inside the same DB transaction as the
  state change it's recording (never a separate fire-and-forget write).
- `lib/actions/organizer-admin.ts` — `listOrganizers(params)`,
  `suspendOrganizer(userId, reason, session)`, `reinstateOrganizer(userId, session)`.
- `lib/lifecycle/mun-state-machine.ts` — extend `ALLOWED_TRANSITIONS` per
  section 3; add `unpublishMun(munId, session)`, `suspendMun(munId, reason, session)`,
  `reinstateMun(munId, session)` to `lib/actions/admin-review.ts` (same file
  as `publishMun`, keeps mun-lifecycle admin actions together).
- `lib/actions/admin-search.ts` — `searchRegistrations(query, session)`
  (matches registration/student/mun/committee/portfolio/payment/order ID —
  PRD section 24), `listPaymentExceptions(session)` (computed: `FAILED`
  payments, or `PAID` payments whose registration isn't `CONFIRMED` — the
  exact "amount mismatch/webhook fail" cases already produced by the
  existing webhook handler's `refundOwed` path per project memory).
- `lib/lifecycle/refund.ts` — `requestRefund`, `approveRefund`, `rejectRefund`,
  `executeRefund` (the `APPROVED → REFUNDED` step).
- `lib/actions/support.ts` — `createTicket`, `listTickets(filters, session)`,
  `assignTicket`, `updateTicketStatus`.
- `lib/actions/admin-review.ts` — add `getAuditHistory(targetType, targetId)`
  merging `admin_actions` + `verificationLogs` for a given target, sorted by
  timestamp (backs the audit-history tab, PRD section 30).

## 5. UI

- `app/admin/layout.tsx` — nav shell, all `app/admin/*` routes nest under it.
  Sections shown: Overview, Applications, MUNs, Verification, Registrations,
  Payments, Refunds, Organizers, Support, Audit Log (10 of PRD's 19 — the
  rest are P1/P2 and not scaffolded as dead nav items).
- `app/admin/page.tsx` — overview counts (pending applications, pending
  verifications, open tickets, payment exceptions, open refund requests).
- `app/admin/organizers/` — list + detail + suspend/reinstate dialog
  (confirmation required per PRD section 25 pattern already used for
  publish).
- `app/admin/registrations/` — search page.
- `app/admin/payments/` — list + exception flag column.
- `app/admin/refunds/` — queue + approve/reject dialog.
- `app/admin/support/` — ticket list + detail + assign/resolve.
- `app/admin/audit/` — read-only log viewer, filter by target type/actor.
- MUN detail page (existing `app/admin/review/[munId]` or equivalent) gains
  unpublish/suspend buttons alongside existing publish button.
- Student/organizer-facing: minimal "Contact support" entry point (a form,
  not a full inbox) — new `app/support/new/page.tsx` or a dashboard panel,
  whichever fits existing dashboard nav better (implementer's call, follow
  existing dashboard patterns).

## 6. Testing

Per new lifecycle function, integration test against real (Docker) Postgres
per existing convention (`vitest.setup.ts` / `.env.test`):
- Refund state machine: happy path REQUESTED→APPROVED→REFUNDED, illegal
  transitions rejected, concurrent-approval row-lock test (two admins
  approve same request — mirrors existing `transitionMun` concurrency test
  pattern).
- MUN suspend/unpublish: transition table tests, row-lock test (two admins
  act on same mun concurrently — same pattern as existing `transitionMun`
  test).
- Organizer suspend: suspended user's `getSession`/sign-in rejected.
- Support ticket lifecycle: status transitions, assignment.
- Audit log: every new mutating action asserted to produce exactly one
  `admin_actions` row (or `verificationLogs` row where that's the system of
  record) with correct actor/target/reason.

## 7. Migration

One migration: `admin_actions`, `refund_requests`, `support_tickets` tables;
`users.suspended`/`suspendedReason`/`suspendedAt` columns; `SUSPENDED` added
to `munStatusEnum`; five new enums (`adminActionEnum`, `refundStatusEnum`,
`supportCategoryEnum`, `supportPriorityEnum`, `supportStatusEnum`). Applied
to local Docker Postgres first (tests), then Neon, per existing convention
in CLAUDE.md.

## 8. Build/fanout plan (for implementation)

Dependency order:
1. **Foundation** (must land first, everything else wires into it): schema
   migration + `admin_actions` table + `lib/audit/log.ts` + nav shell.
2. **Parallel tracks** (independent of each other, depend only on 1):
   organizer management; MUN unpublish/suspend; registration+payment search;
   support tickets.
3. **Refunds** (depends on payment search existing for the admin to find
   what to refund against, but is otherwise independent) — can run parallel
   with track 2 if the implementer doesn't block on UI, only on the
   `payments`/`registrations` schema which already exists.
4. **Audit history view** (`getAuditHistory` + `app/admin/audit/`) — depends
   on `admin_actions` existing (track 1) and benefits from at least one
   producer (track 2/3) existing to have real data to view, but can be built
   against track 1 alone with mocked/empty data in tests.

Review after each track: `adversarial-coach` + `integration-enforcer`
always; `red-team` additionally for refunds and organizer-suspend (auth
boundary + money movement).
