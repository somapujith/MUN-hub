# Organizer Onboarding & Go-Live Pipeline — Backend Design

**Status:** Proposed
**Date:** 2026-09-14
**Source PRD:** `MUNHub_Organizer_Onboarding_Go_Live_Pipeline_PRD.md`
**Supersedes scope of:** `docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md` (slice 1 — extended, not replaced)
**Implementation plan:** `docs/superpowers/plans/2026-09-14-onboarding-go-live-pipeline.md`

---

## 0. Framing decision: extend, do not duplicate

PRD §37 proposes three new tables: `mun_go_live_submissions`, `mun_onboarding_modules`, `mun_validation_issues`. Slice 1 already shipped functional equivalents of two of them:

| PRD §37 entity | Existing equivalent | Verdict |
|---|---|---|
| `mun_onboarding_modules` | `mun_module_verifications` | **Reuse.** Add `isRequired`, `completionPercentage`, `blockingIssueCount`, `completedAt`. The PRD's `status` (NOT_STARTED/IN_PROGRESS/ACTION_REQUIRED/COMPLETE/LOCKED) is *organizer-facing completion*; the existing `state` (NOT_SUBMITTED/PENDING_REVIEW/VERIFIED/CHANGES_REQUESTED/REJECTED) is *reviewer-facing verification*. These are two orthogonal axes on the same row — see §3.2. Do not collapse them. |
| `mun_validation_issues` | `verification_issues` | **Reuse with a discriminator.** Existing table is reviewer-raised findings; PRD's is machine-raised validation failures. Same shape modulo `code`/`fieldKey`/`source`. Add those three columns rather than a second near-identical table. |
| `mun_go_live_submissions` | *(nothing)* | **Build it**, named `mun_submissions`. This is the genuinely new entity: it carries SLA clock, reviewer assignment, and submission→publish idempotency. |
| `mun_versions` | `mun_versions` | **Reuse as-is**, snapshot payload widens to all 15 modules. |

**Rationale.** A parallel system would mean two sources of truth for "is this mun ready", two audit trails, and two places for the publish gate to disagree with itself. The reviewer-facing verification axis is already load-bearing (`publishMun` requires `VERIFIED`, which requires `checkAllModulesVerified`). Adding a second completion system that also gates publish is how you get a mun that is `COMPLETE` on one axis and `CHANGES_REQUESTED` on the other with no defined precedence.

**Reversibility:** two-way door. Columns added to existing tables are additive; if the unified model proves wrong, splitting `mun_module_verifications` into two tables later is a mechanical migration. Bias to action.

---

## 1. Lifecycle reconciliation

### 1.1 State-by-state diff

Current enum (21 values, `lib/db/schema-enums.ts:11-33`) vs PRD §4 (18 values):

| PRD §4 state | Current enum | Action |
|---|---|---|
| `DRAFT` | `DRAFT` | exists, unchanged |
| `ONBOARDING` | `ONBOARDING` | exists, unchanged |
| `ACTION_REQUIRED` | — | **NEW** |
| `READY_FOR_SUBMISSION` | — | **NEW** |
| `SUBMITTED` | `SUBMITTED` | **collision — see §1.2** |
| `AUTOMATED_VALIDATION` | — | **NEW** |
| `UNDER_REVIEW` | `UNDER_REVIEW` | **collision — see §1.2** |
| `CHANGES_REQUESTED` | `CHANGES_REQUESTED` | **collision — see §1.2** |
| `APPROVED` | `APPROVED` / `VERIFIED` | **collision — see §1.2** |
| `GO_LIVE_QUEUE` | — | **NEW** |
| `PUBLISHING` | — | **NEW** |
| `LIVE` | `PUBLISHED` | **equivalent — do NOT rename, see §1.3** |
| `REGISTRATION_OPEN` | `REGISTRATION_OPEN` | exists |
| `REGISTRATION_CLOSED` | `REGISTRATION_CLOSED` | exists |
| `CONFERENCE_ACTIVE` | `CONFERENCE_ACTIVE` | exists |
| `COMPLETED` | `COMPLETED` | exists |
| `CANCELLED` | `CANCELLED` | exists |
| `UNPUBLISHED` | — (`unpublishMun` sends `PUBLISHED → VERIFIED`) | **NEW** — see §1.4 |

Current-only states with no PRD §4 counterpart, all retained: `REJECTED`, `CONTENT_SUBMITTED`, `ORGANIZER_CONFIRMATION`, `VERIFICATION`, `VERIFIED`, `RESULTS_PENDING`, `RESULTS_UNDER_REVIEW`, `ARCHIVED`, `SUSPENDED`.

**Net additions to `munStatusEnum`: 6 values** — `ACTION_REQUIRED`, `READY_FOR_SUBMISSION`, `AUTOMATED_VALIDATION`, `GO_LIVE_QUEUE`, `PUBLISHING`, `UNPUBLISHED`.

### 1.2 The Gate-1/Gate-2 name collision (the important one)

This is the trap. `SUBMITTED`, `UNDER_REVIEW`, `CHANGES_REQUESTED`, `APPROVED` already exist in the enum — **but they mean something different from what PRD §4 means by them.**

Today those four states belong to **Gate 1: the organizer-application approval** (`organizerApplications` table, `reviewMunApplication` in `admin-review.ts:106`). Path: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → ONBOARDING`. That's "is this organization allowed to run a MUN on our platform".

PRD §4 uses the same four words for **Gate 2: the MUN content submission**. Path: `ONBOARDING → … → SUBMITTED → UNDER_REVIEW → APPROVED → GO_LIVE_QUEUE`. That's "is this MUN's content correct enough to publish".

Reusing the identical enum values for both gates makes `mun.status === 'UNDER_REVIEW'` ambiguous — the admin review queue (`getReviewQueue`, `admin-review.ts:41`, filters `inArray(muns.status, ['SUBMITTED','UNDER_REVIEW'])`) would start surfacing content submissions in the organizer-application queue, and `reviewMunApplication` would happily transition a content-stage mun to `APPROVED`, skipping the entire module pipeline. That is a publish-gate bypass.

**Decision: keep Gate 1's four values as-is; map PRD §4's Gate-2 vocabulary onto the existing verification-stage values rather than reusing the Gate-1 words.**

| PRD §4 Gate-2 state | Implemented as | Why |
|---|---|---|
| `SUBMITTED` (content) | `CONTENT_SUBMITTED` (exists) | Already the exact semantic; the name is even clearer than the PRD's. |
| `AUTOMATED_VALIDATION` | `AUTOMATED_VALIDATION` (new) | Genuinely new; no collision. |
| Organizer final confirmation | `ORGANIZER_CONFIRMATION` (exists) | PRD §3 has this step but §4 omits a state for it. Slice 1 already models it. |
| `UNDER_REVIEW` (content) | `VERIFICATION` (exists) | Already means "MUNHub is actively reviewing the content". |
| `CHANGES_REQUESTED` (content) | *module-level* `CHANGES_REQUESTED` + mun-level `ACTION_REQUIRED` | See §1.5 — content change-requests are per-module, not a single mun-level flag. |
| `APPROVED` (content) | `VERIFIED` (exists) | Already means "content passed review". `publishMun` already gates on it. |

This means **only 6 new enum values**, and — critically — **zero existing transitions change meaning.** Anyone reading `mun.status === 'UNDER_REVIEW'` today keeps getting exactly what they got yesterday.

The cost: the PRD's vocabulary and the code's vocabulary differ for four states. Mitigation: a single exported mapping constant, `PRD_STATE_ALIASES` in `lib/lifecycle/mun-state-machine.ts`, so the organizer-facing timeline UI (PRD §30) can render "Under Review" while the DB stores `VERIFICATION`. Documented in `lib/mun-status.ts`'s labels too. This is a labeling concern, not a data concern.

### 1.3 `PUBLISHED` vs `LIVE` — do not rename

**Decision: treat as equivalent. `PUBLISHED` stays the enum value; `LIVE` is a display label only.**

Risks of renaming, concretely, in this codebase:

1. Postgres has no `ALTER TYPE ... RENAME VALUE` that Drizzle generates automatically. `drizzle-kit generate` on a renamed enum value emits a *drop-and-recreate* of the type, which fails on any column with a default or requires a multi-step `ALTER TABLE ... ALTER COLUMN ... TYPE ... USING` dance. The repo's four prior enum migrations (`drizzle/0001`, `drizzle/0005`) are all `ADD VALUE` — additive-only. There is no rename precedent to copy.
2. `ALTER TYPE ... RENAME VALUE` (Postgres 10+, which does exist if hand-written) cannot run inside a transaction block alongside other DDL in some configurations, and Drizzle's migrator wraps migrations in a transaction.
3. Blast radius in code: `muns.publishedAt` column, `transitionMun`'s `toStatus === 'PUBLISHED'` side-effect (`mun-state-machine.ts:106`), `DEFAULT_PUBLIC_STATUSES`/`PUBLIC_DETAIL_STATUSES` (`marketplace.ts:15-29`), `POST_VERIFICATION_STATUSES` (`reverification.ts:15`), `MUN_UNPUBLISHED` admin action, seed data (`lib/db/seed.ts:259`), and every test fixture. All for a word.
4. Neon is live with real seeded data in `PUBLISHED`.

**One-way door** (an enum value rename on a live type with existing rows is painful to undo). Requires more evidence than "the PRD used a different word". Rejected.

`LIVE` is added to `lib/mun-status.ts` as the *label* for `PUBLISHED`: `PUBLISHED: { label: "Live", ... }`. Zero migration.

### 1.4 `UNPUBLISHED`

Today `unpublishMun` (`admin-review.ts:152`) sends `PUBLISHED → VERIFIED`. That conflates "content is verified, awaiting publish" with "was live, deliberately pulled". The go-live queue (§5) needs to distinguish them: a `VERIFIED` mun should appear in the publish queue; an `UNPUBLISHED` one should not, until an admin explicitly re-queues it.

Add `UNPUBLISHED`. `unpublishMun` changes target from `VERIFIED` to `UNPUBLISHED`. `UNPUBLISHED → GO_LIVE_QUEUE` is the re-publish path; `UNPUBLISHED → VERIFICATION` the re-review path.

**This is a behavior change to an existing tested function** — flagged in the plan, its test updates.

### 1.5 `ACTION_REQUIRED` and `READY_FOR_SUBMISSION`

These are **derived-but-materialized** states during onboarding only. The mun sits in `ONBOARDING` while the organizer works; the progress engine (§3) flips it to `ACTION_REQUIRED` when blocking issues exist and `READY_FOR_SUBMISSION` when validation passes clean. All three are mutually reachable in both directions — an organizer who breaks a previously-complete module goes `READY_FOR_SUBMISSION → ACTION_REQUIRED`.

Materializing (rather than computing on read) is deliberate: the admin queue and the organizer dashboard both need to filter/sort on it, and computing a 15-module validation across every mun on every list query is the N+1 the repo just spent a commit (`8fdc449`) fixing elsewhere. The cost is staleness risk — mitigated by recomputing inside every module mutation path (§3.3), never on a cron.

### 1.6 Updated `ALLOWED_TRANSITIONS`

```
DRAFT:                  [SUBMITTED, CANCELLED]
SUBMITTED:              [UNDER_REVIEW, CANCELLED]                          // Gate 1
UNDER_REVIEW:           [APPROVED, REJECTED, CHANGES_REQUESTED]            // Gate 1
APPROVED:               [ONBOARDING, CANCELLED]                            // Gate 1 exit
REJECTED:               []
CHANGES_REQUESTED:      [SUBMITTED, CANCELLED]                             // Gate 1 loop

ONBOARDING:             [ACTION_REQUIRED, READY_FOR_SUBMISSION, CONTENT_SUBMITTED, CANCELLED]
ACTION_REQUIRED:        [ONBOARDING, READY_FOR_SUBMISSION, CANCELLED]
READY_FOR_SUBMISSION:   [CONTENT_SUBMITTED, ACTION_REQUIRED, ONBOARDING, CANCELLED]
CONTENT_SUBMITTED:      [AUTOMATED_VALIDATION, ORGANIZER_CONFIRMATION, ACTION_REQUIRED, CANCELLED]
AUTOMATED_VALIDATION:   [ORGANIZER_CONFIRMATION, ACTION_REQUIRED, CANCELLED]
ORGANIZER_CONFIRMATION: [VERIFICATION, CANCELLED]
VERIFICATION:           [VERIFIED, CHANGES_REQUESTED, ACTION_REQUIRED, REJECTED, CANCELLED]
VERIFIED:               [GO_LIVE_QUEUE, PUBLISHED, VERIFICATION, CANCELLED]
GO_LIVE_QUEUE:          [PUBLISHING, VERIFICATION, CANCELLED]
PUBLISHING:             [PUBLISHED, GO_LIVE_QUEUE, CANCELLED]
PUBLISHED:              [REGISTRATION_OPEN, VERIFICATION, VERIFIED, UNPUBLISHED, SUSPENDED, CANCELLED]
UNPUBLISHED:            [GO_LIVE_QUEUE, VERIFICATION, CANCELLED]
REGISTRATION_OPEN:      [REGISTRATION_CLOSED, VERIFICATION, SUSPENDED, CANCELLED]
REGISTRATION_CLOSED:    [CONFERENCE_ACTIVE, SUSPENDED, CANCELLED]
CONFERENCE_ACTIVE:      [RESULTS_PENDING, SUSPENDED, CANCELLED]
RESULTS_PENDING:        [RESULTS_UNDER_REVIEW]
RESULTS_UNDER_REVIEW:   [COMPLETED, RESULTS_PENDING]
COMPLETED:              [ARCHIVED]
ARCHIVED:               []
CANCELLED:              []
SUSPENDED:              [VERIFICATION, CANCELLED]
```

Deliberate decisions inside that map:

- **`VERIFIED → PUBLISHED` is retained** alongside `VERIFIED → GO_LIVE_QUEUE → PUBLISHING → PUBLISHED`. Removing it would break the existing, tested `publishMun`. The queue path becomes the *recommended* path (`enqueueForGoLive` + `publishFromQueue`); the direct path stays as the admin escape hatch and for backward compatibility. **Trade-off:** PRD §33's "`LIVE` must only be reachable through the approved publishing workflow" is satisfied in the sense that both paths require `VERIFIED` (which requires all modules verified + organizer confirmation + validation), but there are two doors. Accepted, because the gate that matters — `VERIFIED` — is identical on both. If we later want one door only, deleting `VERIFIED → PUBLISHED` is a one-line change (two-way door).
- **`CONTENT_SUBMITTED → ORGANIZER_CONFIRMATION` is retained** even though the new path routes through `AUTOMATED_VALIDATION`. `submitMunForVerification` (the mun-hub-02 compatibility shim, `mun-config.ts:346`) still performs that hop. Removing it breaks the live organizer dashboard panel.
- **`VERIFICATION → REJECTED` is new.** PRD §28 requires a reject decision with mandatory reason at the content-review stage. Today `REJECTED` is only reachable from Gate 1's `UNDER_REVIEW`.
- **`PUBLISHING` can fall back to `GO_LIVE_QUEUE`.** A publish that fails partway (e.g. a validation re-check at publish time fails) must not strand the mun in `PUBLISHING` forever. See §5.3.

---

## 2. Module system extension

### 2.1 `munModuleEnum`: 4 → 15

PRD §38's exact keys, added to the existing enum. The existing four values **stay** (data exists in `mun_module_verifications` and `verification_issues` referencing them on Neon) and are retired by mapping, not deletion:

```
// existing (retained, aliased — see §2.2)
mun_details, committees, portfolios, registration_products
// new, PRD §38 keys
BASIC_INFO, DATES_VENUE, BRANDING, COMMITTEES, PORTFOLIOS, EXECUTIVE_BOARD,
REGISTRATION_TYPES, REGISTRATION_FORM, PRICING_CAPACITY, PAYMENT_SETTLEMENT,
RULES_DOCUMENTS, SCHEDULE, ACCOMMODATION, CONTACT, FINAL_REVIEW
```

Total enum size 19; 15 are *tracked*, 4 are legacy-only.

**Why not rename the four?** Same one-way-door argument as §1.3, and worse: these values appear in two tables' data on a live Neon instance. `ADD VALUE` is safe and already the repo's only precedent.

**Data migration for the legacy four:** a one-shot `UPDATE` in the migration remaps existing rows — `mun_details → BASIC_INFO`, `committees → COMMITTEES`, `portfolios → PORTFOLIOS`, `registration_products → REGISTRATION_TYPES`. Caveat: `ADD VALUE` and a subsequent `UPDATE` using the new value cannot run in the same transaction in Postgres (<15 strictly; Drizzle's migrator transaction makes this brittle regardless). **The remap must be a separate migration file from the `ADD VALUE` migration.** This is the single sharpest implementation hazard in this design — called out again in the plan as its own task with its own commit.

`mun_details` splits into two PRD modules (`BASIC_INFO` + `DATES_VENUE`) over the same underlying `muns` table. Existing `mun_details` rows remap to `BASIC_INFO`; a fresh `DATES_VENUE` row is created lazily by `getModuleVerificationState` on first access. **Decision: split rather than have one module satisfy two keys** — PRD §9 and §10 have genuinely different validation rules and the organizer dashboard shows them as separate cards. One underlying table backing two module rows is fine; the module row is a *tracking* record, not a data record.

Likewise `registration_products` backs both `REGISTRATION_TYPES` (§15: which roles are active) and `PRICING_CAPACITY` (§18: price/capacity/deadline per product).

### 2.2 Module → data source map

| Module key | Backing table(s) | Net-new schema? |
|---|---|---|
| `BASIC_INFO` | `muns` (name, edition, theme, description, conferenceType, targetParticipantType) | +2 columns on `muns` |
| `DATES_VENUE` | `muns` (startDate, endDate, venue, city, country) | +5 columns on `muns` (address, state, mapUrl, registrationOpensAt, registrationDeadline) |
| `BRANDING` | **`mun_media`** (new) | new table |
| `COMMITTEES` | `committees` | +2 columns (committeeType, portfoliosEnabled) |
| `PORTFOLIOS` | `portfolios` | +2 columns (description, restrictions) |
| `EXECUTIVE_BOARD` | **`mun_executive_board`** (new) | new table |
| `REGISTRATION_TYPES` | `registration_products` | +1 column (registrationType) |
| `REGISTRATION_FORM` | **`mun_form_fields`** (new) | new table |
| `PRICING_CAPACITY` | `registration_products` | +2 columns (earlyBirdPrice, earlyBirdDeadline) |
| `PAYMENT_SETTLEMENT` | **`mun_payment_settings`** (new) | new table |
| `RULES_DOCUMENTS` | **`mun_documents`** (new) | new table |
| `SCHEDULE` | **`mun_schedule_items`** (new) | new table |
| `ACCOMMODATION` | `accommodation_options` + `accommodation_option_fields` | +1 column on `muns` (accommodationProvided tri-state) |
| `CONTACT` | **`mun_contacts`** (new) | new table |
| `FINAL_REVIEW` | `organizer_confirmations` (exists) | none |

Seven new tables, matching the seven net-new modules the task brief identified.

### 2.3 Net-new table designs

**`mun_media`** (BRANDING, PRD §11) — `id, munId, kind (munMediaKindEnum: LOGO/COVER/GALLERY/SPONSOR/ORGANIZER_LOGO), url, storageKey, contentType, sizeBytes, displayOrder, createdAt`. Files go through `lib/storage/adapter.ts` — the action receives a Buffer, calls `upload(buffer, key, contentType)`, stores the returned URL plus the key (key needed for `delete`). Validation per PRD §40.7/40.8: allowlist `image/png|jpeg|webp`, max 5 MB, enforced **server-side in the action**, not by the adapter. Unique partial constraint intent: at most one `LOGO` and one `COVER` per mun — enforced in the action (upsert semantics), not a DB constraint, because Drizzle's partial-unique-index support is awkward and the action is the only writer.

**`mun_executive_board`** (EXECUTIVE_BOARD, PRD §14) — `id, munId, committeeId (nullable FK — a Secretary-General is mun-level, a Chair is committee-level), name, role (ebRoleEnum: CHAIR/VICE_CHAIR/DIRECTOR/RAPPORTEUR/CUSTOM), customRole (nullable, required iff role=CUSTOM), photoUrl, bio, displayOrder, createdAt`. Validation: every active committee needs ≥1 `CHAIR`.

**`mun_form_fields`** (REGISTRATION_FORM, PRD §17) — `id, munId, fieldKey (text, unique per mun), fieldType (formFieldTypeEnum, 16 values per §17), label, helpText, required, choices (jsonb, non-null iff type is DROPDOWN/MULTIPLE_CHOICE/CHECKBOX), displayOrder, conditionalOn (nullable text — the `fieldKey` of the controlling field), conditionalOperator (EQUALS/NOT_EQUALS/CONTAINS), conditionalValue (nullable text), createdAt`.

Conditional logic design decision: **a single-parent, single-condition model stored as three columns, not a general expression tree in jsonb.** PRD §17's only stated example is `Accommodation = Yes → show 4 fields`. A single parent + operator + value covers it. Rejected alternative: a jsonb rule AST — more expressive, but it needs a server-side evaluator, a validator, and a cycle detector, all for capability nobody asked for. **Cost of this choice:** OR-conditions and multi-parent dependencies are impossible without a migration. Two-way door — widening to jsonb later is additive.

Cycle safety: `conditionalOn` referencing a field that (transitively) depends on this one must be rejected. With single-parent chains, cycle detection is a simple walk up the parent chain, max depth = field count. Implemented in the create/update action as `assertNoConditionalCycle`.

**`mun_payment_settings`** (PAYMENT_SETTLEMENT, PRD §19) — one row per mun. `id, munId (unique), legalName, orgType, addressLine1, addressLine2, city, state, postalCode, panLast4, panCiphertext, gstin, authorizedRepName, authorizedRepEmail, accountHolderName, bankName, accountNumberLast4, accountNumberCiphertext, ifsc, accountType, gateway, currency, refundPolicy (text), settlementNotes, verificationState (paymentVerificationEnum: NOT_SUBMITTED/PENDING/VERIFIED/FAILED), verifiedAt, verifiedBy, createdAt, updatedAt`.

Masking design (PRD §19, §40.5, §40.14) — **the server never returns full PAN or account number to any client, ever.**
- Write path: the action receives the full value, computes `last4`, stores the full value only in the `*Ciphertext` column via `lib/crypto/field-encryption.ts` (new: AES-256-GCM, key from `PAYMENT_FIELD_KEY` env var, **no hardcoded key, no fallback to a default key — throw at module load if the env var is absent**).
- Read path: `getPaymentSettings(munId)` returns a `MaskedPaymentSettings` type that **structurally does not contain the ciphertext columns** — the Drizzle select lists columns explicitly; `select()` with no argument is banned in this module. TypeScript then makes leaking it a compile error, not a code-review catch.
- There is **no decrypt-and-return action in this slice.** Nothing reads the plaintext back. It is write-only storage pending a real settlement integration. Rationale: a decrypt path with no consumer is pure attack surface. When Razorpay settlement lands, that slice adds the decrypt path with its own threat review.
- **Risk accepted:** encryption key management is env-var-only (consistent with the repo's existing adapter/mock posture). Key rotation is unimplemented. Documented as deferred (§9).

**`mun_documents`** (RULES_DOCUMENTS, PRD §20) — `id, munId, kind (munDocumentKindEnum: RULES/CODE_OF_CONDUCT/REFUND_POLICY/BROCHURE/HANDBOOK/DELEGATE_GUIDE/POSITION_PAPER/OTHER), title, url, storageKey, contentType, sizeBytes, createdAt`. Same storage-adapter + server-side allowlist pattern as `mun_media` (here: `application/pdf`, max 20 MB). Required kinds for completion: `RULES`, `CODE_OF_CONDUCT`, `REFUND_POLICY`.

**`mun_schedule_items`** (SCHEDULE, PRD §21) — `id, munId, committeeId (nullable), title, kind (scheduleItemKindEnum: OPENING_CEREMONY/COMMITTEE_SESSION/BREAK/LUNCH/CRISIS/CLOSING_CEREMONY/AWARDS/OTHER), startsAt, endsAt, location, displayOrder, createdAt`. Validation: `endsAt > startsAt`, and every item within `[mun.startDate, mun.endDate]`.

**`mun_contacts`** (CONTACT, PRD §23) — `id, munId, officialEmail, phone, website, socialLinks (jsonb), contactPersonName, contactPersonRole, contactPersonEmail, contactPersonPhone, createdAt, updatedAt`. One row per mun (`munId` unique).

### 2.4 Generalizing the module engine

Current: `TRACKED_MODULES` is a hardcoded 4-element array (`module-verification.ts:9`) and `checkAllModulesVerified` does `TRACKED_MODULES.every(...)`.

**Decision: a static module registry + a per-mun applicability resolver. Not a DB-configured module list.**

New file `lib/lifecycle/module-registry.ts`:

```
interface ModuleDefinition {
  key: MunModule                     // PRD §38 key
  label: string
  defaultRequired: boolean
  phase: 'CONTENT' | 'COMMERCE' | 'OPERATIONS' | 'FINAL'
  validate: (ctx: MunValidationContext) => ModuleValidationResult
}
const MODULE_REGISTRY: ModuleDefinition[]   // 15 entries, source of truth
```

`TRACKED_MODULES` becomes `MODULE_REGISTRY.map(m => m.key)`.

Per-mun applicability — PRD §6's "optional modules may be configured by MUNHub" — is handled by the **existing `mun_module_verifications.isRequired` column** (added in §3.1), seeded from `defaultRequired` when the row is lazily created, and flippable by an admin-only `setModuleRequirement(munId, moduleKey, isRequired)` action. `checkAllModulesVerified` then checks `rows.filter(r => r.isRequired).every(r => r.state === 'VERIFIED')`.

Why a code registry rather than a `modules` config table: the validator is *code* (`validate` is a function), so the registry cannot live purely in the DB anyway — a DB table would only duplicate the key list and invite the two to drift. The per-mun override, which is genuinely data, lives in the DB where it belongs.

`ACCOMMODATION` is the concrete case: `defaultRequired: true`, but if the organizer sets `muns.accommodationProvided = 'NOT_PROVIDED'` (PRD §22's explicit opt-out), the module auto-satisfies — modeled as the module's `validate` passing trivially in that case, **not** as flipping `isRequired`, so the organizer still sees an explicitly-answered card rather than a silently-vanished one.

`getModuleVerificationState`, `confirmModule`, `reviewModule` need **no signature change** — they are already generic over `MunModule`. `checkAllModulesVerified` changes its predicate only.

**One concurrency fix required here:** `reviewModule` (`module-verification.ts:88`) currently does read-then-write with no row lock, and two admins reviewing the same module concurrently both pass the state check. Same class of bug as the `transitionMun` one fixed on 2026-09-13. Wrap in `db.transaction` with `.for('update')` on the `mun_module_verifications` row. `confirmModule` gets the same treatment.

---

## 3. Progress / completion engine (PRD §5, §7, §8)

### 3.1 Columns added to `mun_module_verifications`

```
completionStatus  moduleCompletionEnum  NOT NULL DEFAULT 'NOT_STARTED'
                  // NOT_STARTED | IN_PROGRESS | ACTION_REQUIRED | COMPLETE | LOCKED
isRequired        boolean               NOT NULL DEFAULT true
completionPercentage integer            NOT NULL DEFAULT 0    // 0-100
blockingIssueCount   integer            NOT NULL DEFAULT 0
lastComputedAt    timestamptz
completedAt       timestamptz
```

Plus the unique constraint the slice-1 design specified but never created: **`UNIQUE (munId, moduleName)`**. Its absence today is a live bug — `getModuleVerificationState`'s lazy-create is read-then-insert with no lock, so two concurrent first-touches insert two rows and every later `[existing] = ...limit(1)` silently picks one at random. Fix: add the constraint, and change the lazy-create to `onConflictDoNothing()` followed by a re-select.

Two orthogonal axes on one row, restated because it is the design's crux:
- `completionStatus` — *organizer-facing*: have you filled this in correctly? Computed by the engine from data.
- `state` — *reviewer-facing*: has MUNHub verified it? Set by humans via `confirmModule`/`reviewModule`.

`LOCKED` is the interaction between them: per PRD §26, once the mun is past `CONTENT_SUBMITTED`, critical modules lock against edits during review.

### 3.2 Computation

New file `lib/lifecycle/module-completion.ts`:

```
computeModuleCompletion(munId, moduleKey, ctx?): Promise<ModuleCompletionResult>
  // { completionStatus, completionPercentage, blockingIssueCount, issues: ValidationIssue[] }

recomputeMunProgress(munId, actorId?): Promise<MunProgress>
  // { overallPercentage, requiredTotal, requiredComplete, blockingIssueCount,
  //   modules: ModuleProgressRow[], lifecycleStatus }
```

`completionPercentage` = satisfied required checks / total required checks for that module, from the registry's `validate` result. Each `validate` returns a `checks: { key, label, passed, severity }[]` — which is exactly what PRD §8's per-committee checklist renders, so the checklist and the percentage come from one source, never disagreeing.

`overallPercentage` = required modules at `COMPLETE` / total required modules — **module-count based, matching PRD §5's "12 / 15 required modules complete" and the 82% bar.** Rejected alternative: averaging per-module percentages, which makes the bar move when a module goes from 40%→60% while the "12/15" count stays put — two numbers telling different stories in the same widget.

**Everything is server-computed.** `recomputeMunProgress` is the only writer of the progress columns; no action accepts a client-supplied percentage or status. PRD §40.2.

### 3.3 Where recomputation is triggered

A single choke point: `lib/lifecycle/module-completion.ts`'s `onModuleDataChanged(munId, moduleKey, actorId)`, called at the end of **every** module-data mutation — the existing `mun-config.ts` and `accommodation.ts` actions plus all seven new module action files. It:
1. recomputes that module's completion row,
2. recomputes the mun's aggregate,
3. materializes the `ONBOARDING`/`ACTION_REQUIRED`/`READY_FOR_SUBMISSION` status flip **only if the mun is currently in one of those three states** (never touches a mun under review or live),
4. calls the existing `triggerReverificationIfNeeded` for the post-verification case.

This mirrors the existing `triggerReverificationIfNeeded` wiring pattern exactly — internal call at the end of the update action, not a parameter callers must remember. **Failure mode accepted:** a module action that forgets the call leaves stale progress. Mitigation: `validateMunForSubmission` (§4) recomputes from scratch rather than trusting the columns, so a stale column can misinform the dashboard but **cannot let an invalid mun through the submit gate.** That's the property that matters.

`onModuleDataChanged` runs inside the caller's transaction where one exists; otherwise opens its own.

---

## 4. Automated validation engine (PRD §24)

New file `lib/lifecycle/validation.ts`:

```
interface ValidationCheck { key: string; label: string; passed: boolean; severity: VerificationSeverity; message?: string }
interface ModuleValidationResult { moduleKey: MunModule; checks: ValidationCheck[]; passed: boolean }
interface MunValidationResult {
  passed: boolean
  modules: ModuleValidationResult[]
  blockers: ValidationCheck[]     // severity BLOCKER, flattened — PRD §24's numbered failure list
}

loadValidationContext(munId): Promise<MunValidationContext>   // the ONLY I/O
validateMunForSubmission(munId): Promise<MunValidationResult>
```

**Design: one batched read, then 15 pure functions.** `loadValidationContext` issues one query per table (~12 queries, all indexed by `munId`) and builds an in-memory context object. Each registry entry's `validate(ctx)` is **pure** — no I/O, no DB, synchronous. Consequences: the whole 15-module validation is one round-trip-bounded operation (PRD §41's p95 <300 ms is reachable); every validator is unit-testable with a literal object and no DB; and there is no N+1 hiding in a per-committee loop.

Cross-module checks that don't belong to one module (e.g. "every active committee has ≥1 available portfolio" spans COMMITTEES/PORTFOLIOS) are assigned to the module the organizer must *edit to fix it* — that check lives in `PORTFOLIOS`, because that's the page they need to open. PRD §8's example does exactly this.

Two checks need the context to reach outside the mun:
- "Organizer approved" — reads `organizerApplications.status === 'APPROVED'` (Gate 1). Assigned to `BASIC_INFO`.
- "No duplicate active slug" (PRD §9) — `muns.slug` is already `UNIQUE` at the DB level, so this check is a redundant belt; kept anyway because it must produce a *readable message* rather than a constraint violation.
- "Payment verification complete" — `mun_payment_settings.verificationState === 'VERIFIED'`. **Severity decision: `HIGH`, not `BLOCKER`, for submission; `BLOCKER` for publish.** Rationale: PRD §19's example UI shows "🟡 Account verification pending" as a normal in-flight state, and verification is performed by MUNHub, not the organizer — blocking *submission* on a check only MUNHub can clear would deadlock the organizer. It correctly blocks *publishing* (PRD §33). This is the one place submit-gate and publish-gate deliberately differ, and it is enforced by `validateForPublish` (§5.3) re-running with `{ stage: 'PUBLISH' }`.

### 4.1 Where it plugs into submission

`submitMunForReview(munId, session)` in `lib/lifecycle/go-live.ts`:

1. Row-lock the mun. Assert status ∈ {`ONBOARDING`, `ACTION_REQUIRED`, `READY_FOR_SUBMISSION`, `CHANGES_REQUESTED`-equivalent}. Assert organizer ownership.
2. `transitionMun → CONTENT_SUBMITTED` (audit-logged).
3. `transitionMun → AUTOMATED_VALIDATION` (audit-logged — PRD §4 wants this state observable, even if it's brief).
4. Run `validateMunForSubmission`. Persist every failing check as a `verification_issues` row with `source: 'AUTOMATED'`.
5. **Fail** → `transitionMun → ACTION_REQUIRED`, return `{ passed: false, blockers }`. Organizer sees PRD §24's numbered list. No submission row is created.
6. **Pass** → `transitionMun → ORGANIZER_CONFIRMATION`, create the `mun_submissions` row with the SLA clock (§5), return `{ passed: true }`. The organizer then calls the existing `submitFinalConfirmation` (Gate 3) to advance to `VERIFICATION`.

Note steps 2-6 are one `db.transaction`, so a failed validation rolls back to the mun's original status rather than leaving it in `AUTOMATED_VALIDATION`. **Except** the `verification_issues` rows must survive a failure — so on the fail path the transaction commits with the `ACTION_REQUIRED` status and the issue rows; it is not an abort.

`submitFinalConfirmation` (`organizer-confirmation.ts:34`) currently hard-requires `mun.status === 'CONTENT_SUBMITTED'`. It must accept `ORGANIZER_CONFIRMATION` too, and must **re-run `validateMunForSubmission` itself** — otherwise an organizer could pass validation, edit a field to break it, and confirm. Its snapshot widens to all 15 modules' data (§6 of the slice-1 spec's snapshot builder gains the seven new tables).

---

## 5. Go-live queue + SLA (PRD §31-33)

### 5.1 `mun_submissions` (new table)

```
id, munId (FK, cascade)
submittedBy (FK users)
versionNumber (int)                 // pairs with organizer_confirmations / mun_versions
status (submissionStatusEnum: SUBMITTED | UNDER_REVIEW | CHANGES_REQUESTED | APPROVED | REJECTED | QUEUED | PUBLISHED | WITHDRAWN)
progressPercentage (int)            // snapshot at submit time
submittedAt, reviewStartedAt, decidedAt, approvedAt, queuedAt, publishedAt (all nullable tz)
slaDeadline (timestamptz)
slaState (slaStateEnum: ON_TRACK | DUE_SOON | OVERDUE | PAUSED | COMPLETED)
slaPausedAt, slaPausedTotalMs (int, default 0)
reviewerId (FK users, nullable)
munVersionId (FK mun_versions, nullable)
publishIdempotencyKey (text, nullable, UNIQUE)
rejectionReason (text, nullable)
createdAt, updatedAt
indexes: (munId), (slaState), (status), partial-unique on active submission per mun
```

**"One active submission per mun"** is enforced by a partial unique index: `UNIQUE (mun_id) WHERE status NOT IN ('PUBLISHED','REJECTED','WITHDRAWN')`. This is the structural fix for the double-submit race — and it is deliberately a **DB constraint, not an application check**, per the lesson recorded in this project's memory (the withdrawn refund workflow: "DB unique constraint is the right next fix" after an unresolved double-refund race). An application-level "does an active submission exist" check has the identical TOCTOU hole. Drizzle expresses this via `uniqueIndex(...).on(table.munId).where(sql\`...\`)`.

### 5.2 SLA / business-day math

New file `lib/lifecycle/sla.ts`, **pure functions, no I/O, no `Date.now()` inside the math** (clock injected as a parameter — makes it property-testable, which the repo's hypothesis-tester agent can then exercise):

```
addBusinessDays(from: Date, days: number, cfg: BusinessCalendar): Date
computeSlaState(submission: SlaInput, now: Date): SlaState
```

`BusinessCalendar` = `{ timeZone, workdays: number[], startHour, endHour, holidays: Date[] }`. Default: `Asia/Kolkata`, Mon-Fri, 10:00-19:00, empty holiday list. Hardcoded as a constant for now with the shape ready for per-region config — the user's focus market is Hyderabad.

Deadline rule: submission at time T → deadline is `addBusinessDays(T, 1)`, clamped into business hours (a Friday 18:00 submission is due Monday 18:00, not Saturday). Thresholds: `DUE_SOON` when <25% of the window remains, `OVERDUE` past deadline, `PAUSED` while `CHANGES_REQUESTED` (the clock stops while the ball is in the organizer's court — otherwise MUNHub's SLA is hostage to organizer response time), `COMPLETED` at publish.

Pause accounting: `slaPausedAt` set on entering `CHANGES_REQUESTED`; on resubmission, `slaPausedTotalMs += (now - slaPausedAt)` and `slaDeadline` shifts by the same amount. Deadline is thus a stored, monotonically-adjusted value — not recomputed from scratch on read, which would lose pause history.

`slaState` is **computed on read** (`computeSlaState(row, now)`), with the column materialized only when a transition writes it, so a stale column never lies to the admin queue. Reading `DUE_SOON`/`OVERDUE` requires no cron — the state is a function of `now` vs a stored deadline. **This is why there is no background job in this design:** PRD §35's "SLA approaching" *notification* does need a scheduler, and that is explicitly deferred (§9). The *state* does not.

### 5.3 Publishing: concurrency-safe and idempotent

`lib/lifecycle/go-live.ts`:

```
enqueueForGoLive(munId, session)      // VERIFIED -> GO_LIVE_QUEUE. ADMIN/SUPER_ADMIN.
getGoLiveQueue(params)                // paginated, joins mun + submission + computed SLA state
publishFromQueue(munId, session, idempotencyKey?)
```

`publishFromQueue`, entirely inside one `db.transaction`:

1. `SELECT ... FOR UPDATE` the `mun_submissions` row for this mun. **This lock, not the mun row's, is the serialization point** — it is the row carrying `publishIdempotencyKey`, and locking the thing you're about to conditionally write is the only lock that helps.
2. If `submission.status === 'PUBLISHED'` → return the existing result unchanged. **Idempotent replay, not an error** (PRD §40.11). If `idempotencyKey` is supplied and matches the stored one, likewise.
3. Re-run `validateMunForSubmission(munId, { stage: 'PUBLISH' })` against live data. PRD §33's blocked-publish list is exactly this check set plus: organizer approved, all required modules `COMPLETE` *and* `VERIFIED`, zero unresolved `BLOCKER` issues, payment verification `VERIFIED`, organizer confirmation present. **Validating at publish time, not trusting the approval, is the point** — approval happened at T-1day and the data may have moved.
4. `transitionMun → PUBLISHING` (audit-logged, `externalTx`).
5. Create the `mun_versions` snapshot; set `submission.munVersionId`.
6. `transitionMun → PUBLISHED` (sets `publishedAt` via the existing side-effect at `mun-state-machine.ts:106`).
7. `submission.status = 'PUBLISHED'`, `publishedAt`, `slaState = 'COMPLETED'`, `publishIdempotencyKey` persisted.
8. `recordAdminAction(tx, ...)` — needs a new `MUN_PUBLISHED` value on `adminActionEnum`.

Step 3 failing throws, the transaction rolls back, the mun never sits in `PUBLISHING` — which is why `PUBLISHING → GO_LIVE_QUEUE` exists in the transition map only as a manual recovery path for the crash-between-commits case, not the normal failure path.

The existing `publishMun` (`admin-review.ts:138`) is **kept and delegated to `publishFromQueue`** when a submission row exists, falling back to its current direct `transitionMun` when none does (muns published before this slice, and seed data). Its tests keep passing.

---

## 6. High-impact re-verification extension (PRD §34)

`HIGH_IMPACT_FIELDS` (`reverification.ts:8`) is `Record<MunModule, string[]>` — adding 15 enum values makes it a **compile error until every key is filled in.** That's the desired forcing function; no key can be silently forgotten.

```
BASIC_INFO:          ['name', 'edition']
DATES_VENUE:         ['startDate', 'endDate', 'venue', 'city', 'country', 'registrationDeadline']
BRANDING:            []                                  // cosmetic — see below
COMMITTEES:          ['name', 'capacity', 'agenda']
PORTFOLIOS:          ['name', 'availability']
EXECUTIVE_BOARD:     ['name', 'role', 'committeeId']
REGISTRATION_TYPES:  ['name', 'registrationType', 'status']
REGISTRATION_FORM:   []                                  // see below
PRICING_CAPACITY:    ['price', 'capacity', 'deadline', 'earlyBirdPrice', 'earlyBirdDeadline']
PAYMENT_SETTLEMENT:  ['accountNumberLast4','ifsc','legalName','panLast4','refundPolicy','gateway','currency']
RULES_DOCUMENTS:     ['url']                             // replacing a policy doc is high-impact
SCHEDULE:            ['startsAt', 'endsAt']
ACCOMMODATION:       ['price', 'capacity', 'name', 'status']
CONTACT:             ['officialEmail', 'phone']
FINAL_REVIEW:        []
// legacy aliases retained so old rows/tests still resolve
mun_details: [...], committees: [...], portfolios: [...], registration_products: [...]
```

`BRANDING: []` — PRD §34's list doesn't include media, and a logo swap forcing a live mun back into review would make organizers avoid fixing a bad logo. `REGISTRATION_FORM: []` for the same reason at the field level, **with one exception handled separately**: deleting a field or making an optional field required after registrations exist is high-impact. That is a *structural* change, not a field diff, so it is detected in the form action directly (`if (mun is post-VERIFIED && (deleting a field || required: false→true)) → force reverification`), not via `detectHighImpactChange`. Documented as a deliberate exception because the pure-diff detector cannot see deletions.

`PAYMENT_SETTLEMENT` re-verification additionally **resets `verificationState` to `PENDING`** — changing bank details after approval must un-verify the account, not merely re-review the mun. This is the highest-consequence entry in the table (it is the fraud vector: get approved with a clean account, swap in another) and gets its own dedicated test.

`detectHighImpactChange` stays pure and unchanged. `triggerReverificationIfNeeded` gains `UNPUBLISHED` in `POST_VERIFICATION_STATUSES` and — a fix to an existing latent bug — uses `getModuleVerificationState` so that a module with no row yet doesn't silently no-op its `UPDATE ... WHERE moduleName = ...` against zero rows.

---

## 7. Notifications & audit (PRD §35-36)

**Audit.** Two existing sinks, both reused, no third one:
- `verificationLogs` — every lifecycle transition, written by `transitionMun`. Covers PRD §36's submission/review-start/change-request/approval/publishing/re-verification rows for free.
- `adminActions` — admin-initiated actions with actor/reason/metadata, written by `recordAdminAction` inside the caller's transaction. Gains enum values `MUN_PUBLISHED`, `MUN_APPROVED`, `MUN_REJECTED`, `MODULE_REVIEWED`, `PAYMENT_DETAILS_CHANGED`, `MODULE_REQUIREMENT_CHANGED`.

PRD §36 wants `old_value`/`new_value`. `adminActions.metadata` (jsonb) carries `{ before, after, fields }`. For `PAYMENT_DETAILS_CHANGED` the metadata records **only masked values and the list of changed field names** — never the plaintext that the encryption in §2.3 exists to protect. An audit log that leaks what it is auditing is worse than no log.

**Notifications.** `lib/notifications/adapter.ts` already defines `NotificationsAdapter.send({to, subject, body})` with `consoleNotificationsAdapter` as the only implementation. Add `lib/notifications/pipeline-events.ts`: a `PipelineEvent` union covering PRD §35's 11 organizer + 6 admin events, a `renderPipelineNotification(event) → NotificationPayload` pure function, and `notifyPipelineEvent(event)` which resolves recipients and calls the adapter.

Call sites: end of `submitMunForReview`, `reviewModule`, `submitFinalConfirmation`, `publishFromQueue`, and the approve/reject/request-changes actions. **Fire-and-forget, outside the transaction, wrapped so a notification failure can never roll back a state change** — but logged, never swallowed silently (repo rule: never silently swallow errors).

Deferred: real email provider, in-app notification table, and the "SLA approaching" event (needs a scheduler — §9).

---

## 8. Security invariants

1. Every new action derives the actor from `getSession()` internally or takes a `Session` already derived by its caller — **never a client-supplied `userId` or `role`.** Matches every existing action in `lib/actions/`.
2. Ownership: organizer-facing module actions use the established `assertOwnsOrAdmin(munId, session)`. **New:** that helper is currently duplicated verbatim in `mun-config.ts:27`, `accommodation.ts:13`, and `module-verification.ts:11`. Seven new module action files would make it ten copies. Extract to `lib/auth/ownership.ts` and have all ten import it — one place for the IDOR rule (PRD §40.6).
3. Reviewer actions: `requireRole(session, ['OPERATIONS','ADMIN','SUPER_ADMIN'])`. Publish/enqueue: `['ADMIN','SUPER_ADMIN']`.
4. Row locks (`.for('update')`) on every concurrent-mutation path: `reviewModule`, `confirmModule`, `publishFromQueue`, `enqueueForGoLive`, `submitMunForReview`, plus the existing `transitionMun`.
5. DB-level constraints where a race is the failure mode: `UNIQUE (munId, moduleName)`, partial-unique active submission, `UNIQUE publishIdempotencyKey`, `UNIQUE munId` on the one-row-per-mun tables.
6. Uploads: server-side content-type allowlist + size cap in the action, before touching the storage adapter. Storage key namespaced `muns/{munId}/{module}/{uuid}` so a crafted filename can't escape a mun's prefix.
7. Payment plaintext is write-only, encrypted, and structurally unreachable by any read path (§2.3).
8. The pre-existing `signIn(email)` passwordless mock auth remains the platform's dominant risk and is **out of scope here** — but note that this slice adds bank details to the DB, which meaningfully raises the cost of that unfixed hole. Flagged, not fixed, in §9.

---

## 9. Non-goals / deferred

- **Real payment gateway + settlement execution.** `mun_payment_settings` stores configuration; nothing initiates a payout. Razorpay stays behind `lib/payments/adapter.ts`.
- **Payment account verification (penny-drop / API).** `verificationState` is set manually by an admin action. No external verification call.
- **Encryption key rotation** for payment fields. Single env-var key, no rotation, no HSM/KMS.
- **Real email delivery.** Console adapter only.
- **Background jobs / schedulers** (PRD §41, §43 Phase 6). SLA *state* is computed on read; SLA *notifications* ("approaching", "overdue") need a scheduler and are deferred. Publishing is synchronous, not a job.
- **Two-person approval for high-risk admin actions** (PRD §40.13, explicitly marked "Future" in the PRD).
- **Team & permissions** (PRD §39 organizer managers: Content/Registration/Finance/Communications Manager). The 5-value `roleEnum` has no sub-organizer roles. Whole-mun organizer ownership only. This is PRD §43 Phase 2 item 10 and is the single largest deliberate omission — it needs its own schema (`mun_team_members`) and a per-module permission matrix.
- **Delegation registration mode** (PRD §16). It is registration-side, not onboarding-side; the form builder's schema does not preclude it.
- **`registrations.munVersionId` capture.** Still nullable and unwired, as decided in slice 1. The go-live pipeline now *creates* versions reliably at publish, which is the precondition — but wiring capture into `initiateRegistration` remains a separate slice.
- **Field-level (vs module-level) verification granularity.** Unchanged decision from slice 1.
- **Critical-field locking enforcement** (PRD §26, §43 Phase 3 item 15). `LOCKED` is modeled in `moduleCompletionEnum` and computed, but the *enforcement* (rejecting an edit to a locked module mid-review) is wired only for the modules in `HIGH_IMPACT_FIELDS` with non-empty lists — see the plan's Task 12. Full lock coverage across all 15 modules is a follow-up.
- **UI.** Everything here is backend contract. The "Get Your MUN Live" dashboard, verification console, and go-live queue screens belong to the UI session, consuming `getMunProgress`, `getModuleReviewQueue`, `getGoLiveQueue`.
- **`lib/mun-status.ts` copy/icons for the 6 new statuses** get mechanical placeholder entries (same convention as the existing `SUSPENDED` TODO at line 51) — real copy is a UI-session decision, not a backend one.

---

## 10. Risk register

| Risk | Severity | Mitigation | Reversible? |
|---|---|---|---|
| Enum `ADD VALUE` + same-transaction `UPDATE` using the new value fails on Neon | **High** — blocks the whole migration | Split into two migration files; remap is its own task/commit | Yes |
| Gate-1/Gate-2 state vocabulary confusion leads a future agent to reuse `UNDER_REVIEW` for content review, bypassing the module pipeline | **High** | §1.2 decision documented in the spec, in `CLAUDE.md`, and as a comment block on `ALLOWED_TRANSITIONS` | Hard to undo once data exists |
| Progress columns go stale if a new module action forgets `onModuleDataChanged` | Medium | `validateMunForSubmission` recomputes from scratch — stale columns misinform the dashboard but cannot pass the gate | Yes |
| 15 modules × validators is a large single-session scope; partial landing leaves an inconsistent pipeline | Medium | Phased plan with a working system at each commit boundary; module registry entries are independent | Yes |
| Payment field encryption key in env var; loss = unrecoverable ciphertext | Medium | Documented; no read path depends on decryption in this slice, so loss is currently non-fatal | Yes (while unused) |
| `UNIQUE (munId, moduleName)` migration fails because duplicate rows already exist (from the unguarded lazy-create) | Medium | Migration dedupes first (keep lowest `createdAt`), then adds the constraint | Yes |
| Two publish doors (`VERIFIED → PUBLISHED` direct, and via queue) diverge in gating | Medium | Both funnel through `publishFromQueue`'s validation when a submission row exists | Yes |
| `publishFromQueue` re-validation rejects a mun an admin already approved, creating admin confusion | Low | Returns the specific failing checks, not a generic error; the approval→publish window is ~1 business day | Yes |
