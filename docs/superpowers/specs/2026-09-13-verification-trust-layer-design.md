# Verification & Confirmation Trust Layer — Slice 1: Core Trust Mechanism

**Status:** Approved
**Source PRD:** `MUNHub_Organizer_Modules_Verification_Confirmation_PRD.md` (full scope — this spec covers only the P0 subset below)
**Scope:** the new trust machinery (versioning, module-level verification, organizer confirmation gate, re-verification triggers) applied to modules that already exist: MUN details, committees, portfolios, registration products.

**Explicitly out of scope for this slice** (separate future slices — mostly Phase 2 territory since the underlying features don't exist yet): registration form builder, QR check-in, results/awards, certificates, communications, documents/media versioning, analytics, team permissions beyond what RBAC already has, executive board module (schema exists nowhere yet — would need its own slice), organizer application module changes (existing `organizerApplications` flow is untouched).

## 1. Lifecycle change

`MunStatus` enum extends (values are additive + reordered semantically per PRD §2; existing values keep their names so no data migration needed for muns already in those states):

```
DRAFT → SUBMITTED → UNDER_REVIEW → { APPROVED | REJECTED | CHANGES_REQUESTED }
CHANGES_REQUESTED → SUBMITTED
APPROVED → ONBOARDING → CONTENT_SUBMITTED → ORGANIZER_CONFIRMATION → VERIFICATION → { VERIFIED | CHANGES_REQUESTED }
VERIFIED → PUBLISHED → REGISTRATION_OPEN → REGISTRATION_CLOSED → CONFERENCE_ACTIVE
CONFERENCE_ACTIVE → RESULTS_PENDING → RESULTS_UNDER_REVIEW → COMPLETED → ARCHIVED
Any non-terminal state → CANCELLED (organizer or admin initiated, terminal)
```

New states added to the existing enum: `ORGANIZER_CONFIRMATION`, `VERIFIED`, `RESULTS_PENDING`, `RESULTS_UNDER_REVIEW`, `CANCELLED`. `VERIFICATION` (existing) now means "MUNHub is actively reviewing," `VERIFIED` (new) means "passed," matching PRD's Gate 3/Gate 4 split — this is a real behavior change: `publishMun` now requires `VERIFIED`, not `VERIFICATION`.

`lib/lifecycle/mun-state-machine.ts`'s `ALLOWED_TRANSITIONS` map updates accordingly. Existing tests for `canTransition`/`transitionMun` stay valid for untouched transitions; new tests cover the added states.

## 2. New tables

**`mun_module_verifications`** — one row per `(munId, moduleName)`. `moduleName` is a string enum: `'mun_details' | 'committees' | 'portfolios' | 'registration_products'`. Fields: `state` (NOT_SUBMITTED/PENDING_REVIEW/VERIFIED/CHANGES_REQUESTED/REJECTED), `organizerConfirmedAt` (nullable — the per-module "I confirm..." statement from PRD §5/§6), `lastReviewedAt`, `lastReviewedBy` (nullable FK to users). Unique constraint on `(munId, moduleName)`.

**`verification_issues`** — reviewer-recorded findings. Fields: `munId`, `moduleName`, `severity` (BLOCKER/HIGH/MEDIUM/LOW), `reason`, `previousValue`/`newValue` (nullable text — free-form since fields vary per module), `resolved` (boolean, default false), `raisedBy` (FK users), `createdAt`, `resolvedAt` (nullable).

**`organizer_confirmations`** — Gate 3, whole-submission confirmation (not per-module). Fields: `munId`, `confirmingUserId`, `confirmedAt`, `versionNumber` (int, references the version this confirmation covers), `snapshotJson` (jsonb — full mun+committees+portfolios+products at confirmation time, for audit/dispute resolution).

**`mun_versions`** — created only when a mun passes VERIFIED (first time) or re-passes after a re-verification cycle. Fields: `munId`, `versionNumber` (int, auto-incrementing per mun, starts at 1), `snapshotJson` (jsonb, same shape as `organizer_confirmations.snapshotJson`), `createdAt`. Unique constraint on `(munId, versionNumber)`.

**`registrations.munVersionId`** — nullable FK to `mun_versions.id`, added to the existing `registrations` table. **Not wired into `initiateRegistration` in this slice** — column exists, capture logic is a follow-up slice once `mun_versions` has proven stable in the review flow. Zero behavior change to the existing, tested registration/payment code path.

## 3. Actions

**`lib/lifecycle/module-verification.ts`** (new file):
- `getModuleVerificationState(munId, moduleName): Promise<ModuleVerification>` — creates a NOT_SUBMITTED row lazily if none exists yet (so callers never have to pre-seed rows for a new mun).
- `confirmModule(munId, moduleName, session): Promise<ModuleVerification>` — organizer-only (ownership check via existing `assertOwnsOrAdmin`-style helper), sets `organizerConfirmedAt`, flips state to PENDING_REVIEW. Requires the module to currently be NOT_SUBMITTED or CHANGES_REQUESTED (can't re-confirm something already PENDING_REVIEW/VERIFIED).
- `reviewModule(munId, moduleName, decision: 'VERIFIED' | 'CHANGES_REQUESTED' | 'REJECTED', issues: IssueInput[], session): Promise<ModuleVerification>` — OPERATIONS/ADMIN/SUPER_ADMIN only, writes `verification_issues` rows (if any), flips module state. After every call, checks `checkAllModulesVerified(munId)`.
- `checkAllModulesVerified(munId): Promise<boolean>` — internal helper, if all 4 tracked modules are VERIFIED and mun.status is VERIFICATION, transitions mun to VERIFIED and creates the next `mun_versions` snapshot (via `transitionMun`, reusing its audit-log-writing transaction pattern).

**`lib/lifecycle/organizer-confirmation.ts`** (new file):
- `submitFinalConfirmation(munId, session): Promise<Mun>` — Gate 3. Organizer-only. Requires mun.status === CONTENT_SUBMITTED. Snapshots current mun+committees+portfolios+products into `organizer_confirmations`, transitions mun to ORGANIZER_CONFIRMATION, then immediately to VERIFICATION (both logged as separate `transitionMun` calls so the audit trail shows the real two-step PRD lifecycle, not a collapsed jump).

**`lib/lifecycle/reverification.ts`** (new file):
- `HIGH_IMPACT_FIELDS` per module — a `Record<ModuleName, string[]>` constant listing exactly which fields trigger re-verification per PRD §16 (mun_details: name/startDate/endDate/venue; registration_products: price/capacity/deadline; committees: name/capacity/agenda).
- `detectHighImpactChange(moduleName, before: Record<string, unknown>, after: Record<string, unknown>): boolean` — pure function, no I/O. Compares only the fields in `HIGH_IMPACT_FIELDS[moduleName]`.
- `triggerReverificationIfNeeded(munId, moduleName, before, after, actorId): Promise<void>` — called from `updateMunDetails`/`updateRegistrationProduct`/`updateCommittee` (existing functions in `mun-config.ts`, each gets one extra call at the end). If `detectHighImpactChange` is true AND mun.status is VERIFIED or later (PUBLISHED/REGISTRATION_OPEN/etc), flips that module back to PENDING_REVIEW and the mun back to VERIFICATION (via `transitionMun`, logged with a note identifying the triggering field diff). If mun isn't yet VERIFIED, this is a no-op — pre-verification edits don't need re-verification, there's nothing to "re"-verify yet.

**`lib/actions/admin-review.ts` additions:**
- `getModuleReviewQueue(): Promise<MunModuleVerification[]>` — all `PENDING_REVIEW` module rows across all muns, for the Verification Console (PRD §15).
- Existing `reviewMunApplication`/`publishMun` stay as-is for the outer application-approval gate (Gates 1-2); the new module-level actions are Gates 3-4, a distinct later stage in the same mun's lifecycle.

## 4. What does NOT change

- `initiateRegistration`, the payments webhook, the row-lock capacity fix — untouched.
- `organizerApplications` / `submitOrganizerApplication` — untouched (that's Gate 1, already correct).
- Existing `mun-config.ts` CRUD functions keep their current signatures; `triggerReverificationIfNeeded` is called internally, not exposed as a new required parameter callers must pass.
- `MunSummary`/`MunDetail` types — no changes needed for this slice (module verification state isn't surfaced on public marketplace pages, only in the organizer dashboard and admin console, which are UI work for a later handoff to mun-hub-02).

## 5. Security

Same pattern as everything else in this repo: derive actor from `getSession()` internally in every new action, never accept a role/session param from the caller. `confirmModule`/`submitFinalConfirmation` require organizer ownership; `reviewModule` requires OPERATIONS/ADMIN/SUPER_ADMIN. `verification_issues` and `organizer_confirmations` are audit trail — no update/delete actions on them (append-only, matching PRD §26 "normal users cannot edit audit logs").

## 6. Explicitly deferred to later slices

- Field-level (not module-level) verification granularity.
- `registrations.munVersionId` capture logic in `initiateRegistration`.
- Executive board module (doesn't exist in schema yet).
- Registration form builder, QR check-in, results/awards, certificates, communications, documents/media, analytics, team permissions/RBAC roles beyond current 5-role enum.
- Public "Preview as Student" (PRD §17) — UI-only, depends on nothing new here structurally.
