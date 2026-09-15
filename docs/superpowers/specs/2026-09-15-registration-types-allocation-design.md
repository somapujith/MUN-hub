# Registration Types Extend + Allocation Enforcement — Design

**Status:** Approved
**Date:** 2026-09-15
**Slice:** 1 of 6 (Organizer Registration & Delegation Management — see `docs/prd/MUNHub_Organizer_Registration_Delegation_Management_PRD.md`)

## Context

The full PRD (`docs/prd/MUNHub_Organizer_Registration_Delegation_Management_PRD.md`) describes a 10-phase registration/delegation/allocation/waitlist/refund system. An architect-agent audit (2026-09-15) found most of the PRD's proposed data model already exists under different names (`registrationProducts` = PRD's `RegistrationType`, `registrations.committeeId`/`portfolioId` = PRD's `CommitteeAssignment`/`PortfolioAssignment`, `munFormFields` = PRD's form builder, `adminActions` = PRD's audit log). Per Rule 2 ("reuse existing code, don't create parallel implementations"), the PRD is decomposed into 6 independently-shippable slices rather than one spec:

1. **Registration Types extend + allocation enforcement** (this doc)
2. Registration form builder UI + funnel wiring
3. Delegation system (new tables, invitations, Head Delegate dashboard)
4. Waitlist
5. Organizer registration/delegation dashboards + allocation board + cancellation + CSV import/export + audit UI
6. Notifications wiring

**Two scope decisions locked for the whole PRD, not just this slice:**
- Delegation payments (Slice 3): one `payments` row per member registration. `payments.registrationId` stays `NOT NULL UNIQUE`, no schema change to `payments`.
- Refund state machine (PRD §23): **out of scope entirely**, given the project's prior double-refund incident (see `lib/db/schema.ts:589-594` and project memory `refund-concurrency-lesson.md`). Cancellation (Slice 5) stops at releasing capacity + audit + handing off to the existing support-ticket `REFUND` category. No automated refund processing, no gateway integration, no change to `payments.status = 'REFUNDED'` semantics.

## Problem (this slice)

Two real gaps found by the audit:

1. **`registrationProducts` is functionally the PRD's "Registration Type" but is missing fields the PRD requires**: `description`, whether individual/delegation registration is allowed, display order, eligibility restrictions. The `registrationType` column exists but is unpopulated.
2. **Committee capacity and portfolio uniqueness are declared in schema but never enforced.** `committees.capacity` and `portfolios.availability` are only read by go-live validators checking they're non-zero — never checked against actual registration counts. Today a committee with capacity 20 can accept unlimited registrations, and two participants can hold the same portfolio.

## Design

### Schema changes

`registrationProducts` (additive columns, no data loss):
- `description` (text, nullable)
- `allowsIndividual` (boolean, not null, default `true`)
- `allowsDelegation` (boolean, not null, default `false`)
- `displayOrder` (integer, not null, default `0`)
- `eligibility` (jsonb, nullable)

Backfill migration: existing rows get `registrationType = 'DELEGATE'` where currently null (matches current single-type usage — every seeded MUN today only has one implicit type).

`registrations` table: add a partial unique index —
```sql
CREATE UNIQUE INDEX registrations_portfolio_unique_active
ON registrations (portfolio_id)
WHERE portfolio_id IS NOT NULL AND status IN ('PENDING', 'PAYMENT_PENDING', 'CONFIRMED');
```
Mirrors the existing `mun_submissions_active_per_mun_uq` partial-unique pattern (`lib/db/schema.ts:637-639`) — partial so cancelled/refunded registrations don't permanently lock a portfolio.

New `adminActionEnum` values (separate migration file per CLAUDE.md's Postgres <15 `ADD VALUE` rule): `COMMITTEE_ASSIGNED`, `COMMITTEE_REASSIGNED`, `COMMITTEE_UNASSIGNED`, `PORTFOLIO_ASSIGNED`, `PORTFOLIO_REASSIGNED`, `PORTFOLIO_UNASSIGNED`.

### Capacity enforcement — extends the existing row-lock pattern

**Signup-time (student self-select), in `initiateRegistration` (`lib/actions/registration.ts`):**
Add a third `.for('update')` row lock on the target `committees` row inside the existing transaction (same shape as the current accommodation-option lock at registration.ts:118-123). Count active registrations (`ACTIVE_REGISTRATION_STATUSES`) for that committee; reject with a clear error if `count >= committee.capacity`. Only runs when `committeeId` is supplied (committee selection stays optional where it is today).

**Organizer reassignment, in new `lib/actions/allocation.ts`:**
- `assignCommittee(registrationId, committeeId, session)` / `unassignCommittee(registrationId, session)`
- `bulkAssignCommittee(registrationIds[], committeeId, session)`
- `assignPortfolio(registrationId, portfolioId, session)` / `unassignPortfolio(registrationId, session)`
- `bulkAssignPortfolio(assignments: {registrationId, portfolioId}[], session)`

Each single-item action: `assertOwnsOrAdmin(munId, session)` → row-lock the target committee (capacity check, same as above) or rely on the DB unique index (portfolio) → update `registrations.committeeId`/`portfolioId` → `recordAdminAction(tx, ...)` inside the same transaction → return result. Bulk variants loop the same logic inside one transaction per PRD §30 ("avoid destructive partial imports... prefer transactional behavior"); a bulk call either fully succeeds or reports per-item failures without partial capacity corruption — implementation detail for the plan to pin down (all-or-nothing vs. best-effort-with-report is a call for the implementation plan, not this design doc, since it doesn't change the schema or the enforcement primitive).

Portfolio uniqueness relies on the DB constraint above — a duplicate assignment fails at the DB level (`23505`) inside the transaction, translated to a readable error the same way `registration-form.ts:70` already does.

### UI changes

- Rename the "Registration Products" section label to "Registration Types" in `app/organizer/dashboard/[munId]/products/` and `nav-config.ts`. **No route rename, no module-key rename** — `REGISTRATION_TYPES`/`PRICING_CAPACITY` module keys and the `/products` URL segment stay exactly as they are; this is a label-only change to match PRD vocabulary without touching the verified module system.
- Add `description`, `allowsIndividual`, `allowsDelegation`, `displayOrder`, `eligibility` fields to the existing product form dialog (`product-form-dialog.tsx`).
- Add assign/reassign/unassign actions (single + bulk-select) to the existing read-only `registrations` page (`app/organizer/dashboard/[munId]/registrations/`), which today only filters/searches. This is the first slice of PRD §33's data-table actions — export and cancel are explicitly deferred to Slice 5.

### Out of scope for this slice

- Delegation-aware fields (`allowsIndividual`/`allowsDelegation` are added to schema now so Slice 3 doesn't need another migration, but no delegation UI/logic ships here).
- Waitlist-on-full behavior (PRD §18) — capacity rejection in this slice is a hard error, not a waitlist offer; Slice 4 adds the waitlist path.
- CSV export of the registrations table (Slice 5).
- Any refund/cancellation action (Slice 5, refund explicitly excluded per the PRD-wide decision above).

## Testing

- Concurrency test: N concurrent `initiateRegistration` calls against a committee at capacity — exactly `capacity` succeed, matching the existing `registration.test.ts` pattern (10 concurrent callers vs. capacity 3).
- Concurrency test: N concurrent `assignPortfolio` calls for the same portfolio — exactly 1 succeeds, rest fail on the unique constraint.
- Cross-MUN/cross-organizer authorization test for every new action (Organizer A cannot assign committees on Organizer B's MUN).
- Migration test: existing seeded registration products get `registrationType = 'DELEGATE'` backfilled, existing data preserved.

## Risks

- Backfilling `registrationType` on existing rows is a one-way default choice — acceptable since it's currently unpopulated and unused by any query.
- Adding the committee capacity check to `initiateRegistration` changes existing behavior (previously-unenforced committee selection now can reject at signup). This is a deliberate bug fix per the PRD, not a silent behavior change — will be called out in the plan's review step.
