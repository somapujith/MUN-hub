# Organizer Onboarding & Go-Live Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full 15-module onboarding -> validation -> confirmation -> review -> go-live-queue -> publish pipeline from `MUNHub_Organizer_Onboarding_Go_Live_Pipeline_PRD.md`, by **extending** the slice-1 verification trust layer rather than building PRD Section 37 parallel tables.

**Architecture:** One unified pipeline. `mun_module_verifications` gains a completion axis alongside its existing verification axis. A code-based `MODULE_REGISTRY` of 15 entries (each with a pure `validate` function) replaces the hardcoded 4-element `TRACKED_MODULES`. Seven net-new tables back the seven modules with no schema today. One genuinely new table, `mun_submissions`, carries the SLA clock and publish idempotency.

**Tech Stack:** Drizzle ORM + `postgres` driver, `db.transaction()` + `.for('update')`, Vitest against local Docker Postgres via `.env.test`.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md`

## Global Constraints

- **Never run tests against `.env`.** Vitest loads `.env.test` (local Docker) via `vitest.setup.ts`. If `.env.test` is missing or `vitest.setup.ts` points at `.env`, stop and fix that first - see CLAUDE.md test/dev DB isolation section.
- Every new action derives the actor from `getSession()` internally, or takes an already-derived `Session`. **Never accept a client-supplied `userId` or `role`.**
- Every concurrent-mutation path uses `db.transaction` + `.for('update')`. Where a race is the failure mode, prefer a **DB constraint** over an application check (project memory: the withdrawn refund workflow double-refund race).
- `verification_issues`, `organizer_confirmations`, `mun_versions`, `admin_actions`, `verification_logs` are append-only. No update/delete actions on them.
- **Do NOT rename `PUBLISHED` to `LIVE`** and **do NOT rename the 4 existing `munModuleEnum` values.** Both are one-way doors on a live Neon enum. See spec Sections 1.3 and 2.1.
- **Do NOT reuse `SUBMITTED`/`UNDER_REVIEW`/`APPROVED`/`CHANGES_REQUESTED` for content-stage review.** Those four belong to Gate 1 (organizer application). Content stage uses `CONTENT_SUBMITTED`/`VERIFICATION`/`VERIFIED`. See spec Section 1.2 - this is the sharpest correctness trap in this plan.
- Files 200-400 lines typical, 800 max. One file per module-action group, not one mega-file.
- Payment plaintext is **write-only**. No action returns decrypted PAN/account numbers. Selects in that module list columns explicitly - bare `select()` is banned there.
- Run `npx tsc --noEmit` before every commit. Do not commit with type errors.

---

## Phase 1 - Foundation (PRD Section 43 Phase 1)

## Task 1: Extend MunStatus Enum + State Machine


**Files:**
- Modify: `lib/db/schema-enums.ts` (munStatusEnum)
- Modify: `lib/lifecycle/mun-state-machine.ts` (ALLOWED_TRANSITIONS + PRD alias map)
- Modify: `lib/lifecycle/mun-state-machine.test.ts`
- Modify: `lib/mun-status.ts` (placeholder meta for 6 new statuses)
- Modify: `components/mun/mun-status-badge.tsx` if it has its own exhaustive map - read it first
- Create migration via drizzle-kit generate

**Interfaces:**
- Produces: 6 new MunStatus values (ACTION_REQUIRED, READY_FOR_SUBMISSION, AUTOMATED_VALIDATION, GO_LIVE_QUEUE, PUBLISHING, UNPUBLISHED) - Tasks 10-11 transition to these by name.

- [ ] **Step 1: Add the 6 values to munStatusEnum**

Append to the existing array in lib/db/schema-enums.ts. Order in the TS array does not have to match Postgres ordinal order; drizzle-kit emits ADD VALUE ... BEFORE/AFTER statements. Place them logically: ACTION_REQUIRED / READY_FOR_SUBMISSION / AUTOMATED_VALIDATION after ONBOARDING; GO_LIVE_QUEUE / PUBLISHING before PUBLISHED; UNPUBLISHED after PUBLISHED.



- [ ] **Step 2: Replace ALLOWED_TRANSITIONS**

Use the full map from spec Section 1.6 verbatim. Above it, extend the existing doc comment with a **prominent block** explaining the Gate-1 / Gate-2 split (spec Section 1.2): SUBMITTED / UNDER_REVIEW / APPROVED / CHANGES_REQUESTED are the organizer-application gate; CONTENT_SUBMITTED / VERIFICATION / VERIFIED are the MUN-content gate. A future reader must not be able to miss this.

- [ ] **Step 3: Add the PRD alias map**

Export from lib/lifecycle/mun-state-machine.ts a PRD_STATE_ALIASES constant of type Partial<Record<MunStatus, string>> mapping CONTENT_SUBMITTED to SUBMITTED, VERIFICATION to UNDER_REVIEW, VERIFIED to APPROVED, and PUBLISHED to LIVE, with a doc comment pointing at spec Section 1.2. Display layers render the PRD word; the DB stores the enum value.

- [ ] **Step 4: Add placeholder status meta**

The STATUS_META constant in lib/mun-status.ts is typed Record<MunStatus, StatusMeta> - it will not compile until all 6 are added. Follow the existing SUSPENDED convention at line 51: add each entry with a TODO comment marking it a mechanical placeholder needing UI-session copy review. Suggested: ACTION_REQUIRED warning/alert-triangle, READY_FOR_SUBMISSION info/check, AUTOMATED_VALIDATION info/hourglass, GO_LIVE_QUEUE info/rocket, PUBLISHING info/upload, UNPUBLISHED muted/archive. **Also change the PUBLISHED label from "Published" to "Live"** per spec Section 1.3 - that is the whole of the LIVE rename.

Then grep for any other exhaustive Record<MunStatus, ...> in the repo (excluding node_modules) and fix each.

- [ ] **Step 5: Add transition tests**

In lib/lifecycle/mun-state-machine.test.ts, add a describe block asserting these are **true**: ONBOARDING to ACTION_REQUIRED, ACTION_REQUIRED to READY_FOR_SUBMISSION, READY_FOR_SUBMISSION to CONTENT_SUBMITTED, CONTENT_SUBMITTED to AUTOMATED_VALIDATION, AUTOMATED_VALIDATION to ORGANIZER_CONFIRMATION, VERIFIED to GO_LIVE_QUEUE, GO_LIVE_QUEUE to PUBLISHING, PUBLISHING to PUBLISHED, PUBLISHED to UNPUBLISHED, UNPUBLISHED to GO_LIVE_QUEUE. And these **false**: ONBOARDING to PUBLISHED, GO_LIVE_QUEUE to PUBLISHED (must pass through PUBLISHING), ACTION_REQUIRED to CONTENT_SUBMITTED (must reach READY_FOR_SUBMISSION first), UNPUBLISHED to PUBLISHED.

Existing tests must all still pass unchanged - if any fails, a Gate-1 transition was altered by mistake.

- [ ] **Step 6: Generate and apply migration, run tests, commit**

Start local Docker Postgres and confirm it is healthy, then run the db:generate and db:migrate npm scripts, the state-machine test file, and the TypeScript noEmit check.
Expected: an additive ADD VALUE migration, applies cleanly, all tests pass, 0 type errors.

Commit schema-enums.ts, mun-state-machine.ts, its test, mun-status.ts, and drizzle/ with the message: feat: extend MunStatus for onboarding/go-live pipeline states

---

## Task 2: Extend munModuleEnum to 15 Modules (two migrations)

**Files:**
- Modify: lib/db/schema-enums.ts (munModuleEnum + new moduleCompletionEnum)
- Create: two migration files (see Step 3 - this is the one hazard that will bite you)

**Interfaces:**
- Produces: 15 PRD Section 38 module keys + the ModuleCompletionStatus type - every later task references these.

- [ ] **Step 1: Add the 15 PRD keys to munModuleEnum**

**Keep all 4 existing values.** Append the 15 new ones: BASIC_INFO, DATES_VENUE, BRANDING, COMMITTEES, PORTFOLIOS, EXECUTIVE_BOARD, REGISTRATION_TYPES, REGISTRATION_FORM, PRICING_CAPACITY, PAYMENT_SETTLEMENT, RULES_DOCUMENTS, SCHEDULE, ACCOMMODATION, CONTACT, FINAL_REVIEW. Final enum has 19 values; 15 tracked, 4 legacy.

- [ ] **Step 2: Add moduleCompletionEnum**

A pgEnum named module_completion_status with values NOT_STARTED, IN_PROGRESS, ACTION_REQUIRED, COMPLETE, LOCKED, plus the exported ModuleCompletionStatus type alias, following the file existing convention at lines 128-140.

- [ ] **Step 3: Generate the ADD VALUE migration, then hand-write a SEPARATE remap migration**

Run the db:generate script - this produces migration A (the ADD VALUE statements).

Then **create a second migration file by hand** (next sequence number, and add its entry to drizzle/meta/_journal.json matching the format of existing entries) containing only UPDATE statements that remap the legacy keys in both mun_module_verifications and verification_issues: mun_details to BASIC_INFO, committees to COMMITTEES, portfolios to PORTFOLIOS, registration_products to REGISTRATION_TYPES.

**If migration A and the remap end up in one file, the migration fails with an unsafe-use-of-new-enum-value error** - Postgres cannot use a newly-added enum value in the same transaction that added it. Verify migration A contains only ALTER TYPE ADD VALUE statements before proceeding.

- [ ] **Step 4: Apply both migrations, verify the remap**

Run the db:migrate script, then query mun_module_verifications and confirm no legacy key values remain in the result set.

- [ ] **Step 5: Typecheck, commit**

The TypeScript noEmit check will now show errors in reverification.ts, because HIGH_IMPACT_FIELDS is a non-exhaustive Record<MunModule, string[]>. **That is the intended forcing function** - do not fix it here, Task 12 fills it in. To keep this commit type-clean, temporarily widen HIGH_IMPACT_FIELDS to Partial<Record<MunModule, string[]>> with a TODO(Task 12) comment, and make detectHighImpactChange treat a missing key as an empty list.

Commit with the message: feat: extend munModuleEnum to PRD 15 module keys, remap legacy keys

---

## Task 3: Completion Columns + Unique Constraints on Existing Tables

**Files:**
- Modify: lib/db/schema.ts (munModuleVerifications, verificationIssues, muns, committees, portfolios, registrationProducts)
- Create: dedupe + constraint migration
- Create: lib/db/pipeline-schema.test.ts

**Interfaces:**
- Produces: completion-axis columns consumed by Task 8 engine; the (munId, moduleName) unique constraint consumed by Task 7 safe lazy-create.

- [ ] **Step 1: Add completion columns to munModuleVerifications**

Per spec Section 3.1: completionStatus (moduleCompletionEnum, default NOT_STARTED), isRequired (boolean, default true), completionPercentage (integer, default 0), blockingIssueCount (integer, default 0), lastComputedAt (timestamptz, nullable), completedAt (timestamptz, nullable).

Add a uniqueIndex named mun_module_verifications_mun_module_uq on (munId, moduleName) to the table index array. Import uniqueIndex from drizzle-orm/pg-core.

- [ ] **Step 2: Add discriminator columns to verificationIssues**

code (text, nullable - the machine-readable check key), fieldKey (text, nullable), source (text, notNull, default REVIEWER; values REVIEWER or AUTOMATED). Add an index on (munId, moduleName, resolved) - Task 8 blocking-issue count queries exactly this shape on every recompute.

- [ ] **Step 3: Add the PRD Section 9/10/22 columns to muns**

conferenceType, targetParticipantType, addressLine1, addressState, postalCode, mapUrl (all text), registrationOpensAt and registrationDeadline (timestamptz), accommodationProvided (text, nullable - PROVIDED, NOT_PROVIDED, or null). All nullable, so existing rows do not break. Note muns.venue, city, and country already exist; do not duplicate them.

- [ ] **Step 4: Add columns to committees, portfolios, registrationProducts**

- committees: committeeType (text), portfoliosEnabled (boolean, notNull, default true)
- portfolios: description (text), restrictions (text)
- registrationProducts: registrationType (text), earlyBirdPrice (integer), earlyBirdDeadline (timestamptz)

- [ ] **Step 5: Generate migration, then PREPEND a dedupe statement**

Run the db:generate script, then **edit the generated file** to put a self-join DELETE before the CREATE UNIQUE INDEX: delete rows from mun_module_verifications where another row shares the same (mun_id, module_name) and has an earlier created_at - i.e. keep the oldest.

The unguarded lazy-create in the current getModuleVerificationState can have produced duplicates; the constraint will fail without this.

- [ ] **Step 6: Apply, smoke-test, commit**

Write lib/db/pipeline-schema.test.ts with one test per new constraint: inserting two mun_module_verifications rows with the same (munId, moduleName) is rejected; the new muns and committees columns round-trip. Follow the existing lib/db/verification-schema.test.ts pattern including its afterAll client teardown.

Run the db:migrate script, the new test file, and the TypeScript noEmit check. Commit with the message: feat: add module completion axis, unique constraints, PRD module columns

**CHECKPOINT - Phase 1 schema foundation complete. Run the full test suite here; everything must pass before proceeding.**

---

## Phase 2 - Net-New Module Schema + Actions (PRD Section 43 Phase 2)

## Task 4: Seven Net-New Tables

**Files:**
- Modify: lib/db/schema-enums.ts (6 new enums)
- Modify: lib/db/schema.ts (7 new tables + relations)
- Create migration

**Interfaces:**
- Produces: munMedia, munExecutiveBoard, munFormFields, munPaymentSettings, munDocuments, munScheduleItems, munContacts - Tasks 5-6 write actions against these, Task 9 validators read them.

- [ ] **Step 1: Add the new enums**

- munMediaKindEnum (mun_media_kind): LOGO, COVER, GALLERY, SPONSOR, ORGANIZER_LOGO
- ebRoleEnum (eb_role): CHAIR, VICE_CHAIR, DIRECTOR, RAPPORTEUR, CUSTOM
- formFieldTypeEnum (form_field_type): the 16 PRD Section 17 types - SHORT_TEXT, LONG_TEXT, EMAIL, PHONE, NUMBER, DROPDOWN, MULTIPLE_CHOICE, CHECKBOX, DATE, FILE_UPLOAD, INSTITUTION, ACADEMIC_YEAR, MUN_EXPERIENCE, COMMITTEE_PREFERENCE, PORTFOLIO_PREFERENCE, EMERGENCY_CONTACT
- munDocumentKindEnum (mun_document_kind): RULES, CODE_OF_CONDUCT, REFUND_POLICY, BROCHURE, HANDBOOK, DELEGATE_GUIDE, POSITION_PAPER, OTHER
- scheduleItemKindEnum (schedule_item_kind): OPENING_CEREMONY, COMMITTEE_SESSION, BREAK, LUNCH, CRISIS, CLOSING_CEREMONY, AWARDS, OTHER
- paymentVerificationEnum (payment_verification_state): NOT_SUBMITTED, PENDING, VERIFIED, FAILED

Export the matching type aliases alongside, following the file existing convention.

- [ ] **Step 2: Add the 7 tables**

Exact column lists are in spec Section 2.3. Conventions to follow from the existing file: the id() helper for primary keys, a notNull munId text column referencing muns.id with onDelete cascade, timestamps with withTimezone true, an index on munId for every table, and a unique constraint on munId for the one-row-per-mun tables (munPaymentSettings, munContacts).

munFormFields additionally needs a uniqueIndex named mun_form_fields_mun_key_uq on (munId, fieldKey) - conditionalOn references fieldKey, which must be unambiguous within a mun.

Add a relations export for each, matching the file existing pattern, and add the new collections to munsRelations.

- [ ] **Step 3: Add a comment block on munPaymentSettings**

Above the table, state plainly: the ciphertext columns are write-only; no read path decrypts them in this slice; selects in lib/actions/payment-settlement.ts list columns explicitly and never include them; see spec Section 2.3. A future agent must not add a getFullPaymentDetails without reading that.

- [ ] **Step 4: Generate, apply, smoke-test, commit**

Extend lib/db/pipeline-schema.test.ts with an insert-and-read round-trip per new table (7 tests), including one asserting the munId unique constraint on munPaymentSettings rejects a second row.

Run db:generate, db:migrate, the test file, and the TypeScript noEmit check. Commit with the message: feat: add schema for branding, EB, form builder, payment, docs, schedule, contact

---

## Task 5: Shared Ownership Helper + Content Module Actions

**Files:**
- Create: lib/auth/ownership.ts
- Modify: lib/actions/mun-config.ts, lib/actions/accommodation.ts, lib/lifecycle/module-verification.ts (use the shared helper)
- Create: lib/actions/mun-branding.ts + test
- Create: lib/actions/executive-board.ts + test
- Create: lib/actions/mun-documents.ts + test
- Create: lib/actions/mun-schedule.ts + test
- Create: lib/actions/mun-contact.ts + test

**Interfaces:**
- Consumes: Task 4 tables, lib/storage/adapter.ts.
- Produces: CRUD actions per module - Task 9 validators read the same tables; Task 8 wires onModuleDataChanged into these.

- [ ] **Step 1: Extract assertOwnsOrAdmin to lib/auth/ownership.ts**

It is currently duplicated verbatim in mun-config.ts line 27, accommodation.ts line 13, and module-verification.ts line 11. Move one copy (use the mun-config.ts version - it has the best doc comment and the Mun-not-found distinction), export it, and replace all three definitions with imports. **Behavior must be identical** - re-run those three files existing tests afterward, unchanged, to prove it.

- [ ] **Step 2: lib/actions/mun-branding.ts**

Actions: uploadMunMedia(input, session), listMunMedia(munId), deleteMunMedia(id, session), reorderGallery(munId, orderedIds, session).

Validation **in the action, before touching storage**: allowlist image/png, image/jpeg, image/webp; max 5 MB by byte length; reject otherwise with a specific message. Storage key pattern: muns/{munId}/branding/{uuid} - **never derive the key from the user-supplied filename** (path traversal). Store the returned url plus the storageKey (needed for delete). For LOGO and COVER, upsert: delete any existing row of that kind, and its storage object, first.

Use the StorageAdapter interface from lib/storage/adapter.ts. **First grep whether a concrete implementation exists** - if only the interface is there, create lib/storage/mock-adapter.ts returning a local mock URL and tracking keys in memory for delete, mirroring the style of lib/notifications/console-adapter.ts.

- [ ] **Step 3: lib/actions/executive-board.ts**

Actions: createEbMember, updateEbMember, deleteEbMember, listEbMembers(munId). Validation: a CUSTOM role requires a non-empty customRole; committeeId, when provided, must belong to the same mun - **this is an IDOR check, and a committee id from another mun must be rejected**.

- [ ] **Step 4: lib/actions/mun-documents.ts**

Same upload pattern as branding but application/pdf only, max 20 MB, key prefix muns/{munId}/documents/. Plus listMunDocuments(munId) and deleteMunDocument(id, session).

- [ ] **Step 5: lib/actions/mun-schedule.ts**

Actions: createScheduleItem, updateScheduleItem, deleteScheduleItem, listScheduleItems(munId). Validation: endsAt must be after startsAt; committeeId, if set, belongs to the same mun.

- [ ] **Step 6: lib/actions/mun-contact.ts**

Actions: upsertMunContact(munId, input, session), getMunContact(munId). One row per mun - upsert via onConflictDoUpdate on the munId unique constraint, not read-then-write.

- [ ] **Step 7: Tests**

One test file per action file. Each must cover at minimum: the happy path; **a non-owning organizer rejected with Forbidden**; and the module specific validation rule rejecting bad input. Read lib/actions/mun-config.test.ts first and reuse its fixture helpers (makeUser, makeMun) - do not invent a parallel helper set.

- [ ] **Step 8: Run, typecheck, commit**

Run the five new test files, then re-run mun-config.test.ts, accommodation.test.ts, and module-verification.test.ts - that second run is what proves the ownership-helper extraction changed nothing. Then the TypeScript noEmit check.

Commit with the message: feat: add branding, executive board, documents, schedule, contact modules

---

## Task 6: Registration Form Builder + Payment & Settlement

**Files:**
- Create: lib/actions/registration-form.ts + test
- Create: lib/crypto/field-encryption.ts + test
- Create: lib/actions/payment-settlement.ts + test
- Modify: .env.example, .env.test, .dev.vars.example (add PAYMENT_FIELD_KEY)

**Interfaces:**
- Produces: listFormFields(munId), consumed later by the registration funnel; and getPaymentSettings(munId), returning a **masked** type.

- [ ] **Step 1: lib/actions/registration-form.ts**

Actions: createFormField, updateFormField, deleteFormField, reorderFormFields, listFormFields(munId).

Validation:
- fieldKey unique per mun (the DB constraint backs it; catch and rethrow a readable error).
- DROPDOWN, MULTIPLE_CHOICE, and CHECKBOX require a non-empty choices array - mirror the existing precedent at accommodation.ts line 161.
- conditionalOn must reference an existing fieldKey **on the same mun** and must not create a cycle. Implement assertNoConditionalCycle(munId, fieldKey, conditionalOn): walk the parent chain upward from conditionalOn; if it reaches fieldKey, reject. Bound the walk by field count to guard against pre-existing corrupt data.
- Deleting a field that another field conditionalOn references must be rejected, with a message naming the dependent field.

- [ ] **Step 2: lib/crypto/field-encryption.ts**

encryptField(plaintext) and decryptField(ciphertext) using the node crypto module with AES-256-GCM, a random 12-byte IV per call, output as base64 iv, tag, and ciphertext joined by a separator.

Key from the PAYMENT_FIELD_KEY environment variable (base64, 32 bytes). **Throw at module load if it is absent or the wrong length. No default key, no fallback, no dev bypass** - a silently-weak key is worse than a crash. Add a real random value to .env.test (test-only, safe to commit, consistent with the existing .env.test mock-value policy) and a placeholder to .env.example and .dev.vars.example.

Tests: round-trip; two encryptions of the same plaintext differ (random IV); tampering with the ciphertext throws on decrypt.

decryptField is exported and tested but **has no production caller in this slice** - note that in a comment so nobody deletes it as dead code, and so nobody wires it into a read path without a threat review.

- [ ] **Step 3: lib/actions/payment-settlement.ts**

Define a MaskedPaymentSettings interface that **structurally omits the ciphertext columns**: legal and org fields, panLast4, gstin, authorized rep, accountHolderName, bankName, accountNumberLast4, ifsc, accountType, gateway, currency, refundPolicy, verificationState, verifiedAt. Then:

- upsertPaymentSettings(munId, input, session) - takes the full pan and accountNumber, derives last4, stores ciphertext via encryptField, and **never returns them**.
- getPaymentSettings(munId, session) - owning organizer or ops/admin.
- setPaymentVerificationState(munId, state, session) - ADMIN and SUPER_ADMIN only; writes an admin_actions row in the same transaction.

Every select in this file lists columns explicitly. Add a file-top comment banning the bare no-argument select here.

**Test the leak explicitly**, not just the happy path: serialize the returned object and assert it contains neither the full PAN nor the full account number, and that accountNumberLast4 is correct. That is the test that must fail if someone later adds a ciphertext column to the select.

- [ ] **Step 4: Run, typecheck, commit**

Run the three new test files and the TypeScript noEmit check. Commit with the message: feat: add registration form builder and masked payment settlement module

**CHECKPOINT - Phase 2 complete. All 15 modules have backing data. Run the full suite.**

---

## Phase 3 - Registry, Progress, Validation (PRD Section 43 Phases 1 and 3)

## Task 7: Module Registry + Generalized Verification Engine

**Files:**
- Create: lib/lifecycle/module-registry.ts + test
- Modify: lib/lifecycle/module-verification.ts (data-driven TRACKED_MODULES, row locks, safe lazy-create)
- Modify: lib/lifecycle/module-verification.test.ts

**Interfaces:**
- Produces: MODULE_REGISTRY, TRACKED_MODULES, getModuleDefinition(key), setModuleRequirement(...) - Tasks 8-9 consume the registry.

- [ ] **Step 1: lib/lifecycle/module-registry.ts**

15 ModuleDefinition entries per spec Section 2.4, each with key, label, defaultRequired, and phase. **Leave the validate field out of this task** - it is added in Task 9, so this task stays reviewable. Export TRACKED_MODULES, derived by mapping the registry to its keys, and getModuleDefinition(key).

Test: the registry has exactly 15 entries; every key is a valid MunModule; no duplicates; every PRD Section 38 key is present - assert against a literal list of the 15 strings, which is what catches a typo-ed enum value.

- [ ] **Step 2: Fix the lazy-create race in getModuleVerificationState**

The current code at module-verification.ts line 35 is read-then-insert. With the Task 3 unique constraint in place, a concurrent first-touch now *throws* rather than silently duplicating. Change it to: insert with onConflictDoNothing (seeding isRequired from the registry defaultRequired), then select the row, throwing a clear error if it is somehow still absent.

- [ ] **Step 3: Row-lock confirmModule and reviewModule**

Both currently read state then write with no lock - two admins reviewing the same module concurrently both pass the state check. This is the same bug class as the 2026-09-13 transitionMun fix. Wrap each in a db transaction, re-select the row with a FOR UPDATE lock inside, re-check state under the lock, then write. The reviewModule verification_issues inserts move inside the same transaction, and should be batched into one multi-row insert rather than a loop.

- [ ] **Step 4: Generalize checkAllModulesVerified**

Filter to rows where isRequired is true and the key is in TRACKED_MODULES, then require every one to be VERIFIED. **Critically, first check for required modules that have no row at all** and return false if any are missing - the old 4-module version had the same hole, masked only by callers always touching all four.

- [ ] **Step 5: Add setModuleRequirement**

setModuleRequirement(munId, moduleKey, isRequired, session) - ADMIN and SUPER_ADMIN only, per PRD Section 6 (optional modules may be configured by MUNHub). Writes an admin_actions row (MODULE_REQUIREMENT_CHANGED, added in Task 11) in the same transaction. Rejects any attempt to make FINAL_REVIEW optional.

- [ ] **Step 6: Update tests**

The existing module-verification.test.ts uses the 4 legacy keys - update to PRD keys. Add: checkAllModulesVerified returns false when a required module has no row; returns true when all required modules are VERIFIED; an optional module left NOT_SUBMITTED does not block; and a concurrency test for reviewModule (two concurrent calls on the same module, exactly one succeeds) following the registration.test.ts concurrency-test pattern.

- [ ] **Step 7: Run, typecheck, commit**

Run both lifecycle test files and the TypeScript noEmit check. Commit with the message: feat: data-driven 15-module registry, row-locked module review

---

## Task 8: Progress / Completion Engine

**Files:**
- Create: lib/lifecycle/module-completion.ts + test
- Modify: every module action file from Tasks 5 and 6, plus mun-config.ts and accommodation.ts (wire onModuleDataChanged)
- Create: lib/actions/go-live-dashboard.ts + test

**Interfaces:**
- Produces: computeModuleCompletion, recomputeMunProgress, onModuleDataChanged, and getMunProgress(munId) - the UI session Get Your MUN Live page consumes getMunProgress.

- [ ] **Step 1: lib/lifecycle/module-completion.ts**

Per spec Section 3.2. computeModuleCompletion calls the registry validate function - stub it to a trivially-passing result until Task 9, so the wiring lands now and the validators fill in next. recomputeMunProgress aggregates: overallPercentage is requiredComplete divided by requiredTotal, rounded to a percentage - **module-count based, not an average of per-module percentages** (spec Section 3.2) - plus blockingIssueCount from unresolved BLOCKER issues.

onModuleDataChanged(munId, moduleKey, actorId, tx?) does four things:
1. recompute and persist that module completion row,
2. recompute the mun aggregate,
3. **only if mun.status is one of ONBOARDING, ACTION_REQUIRED, or READY_FOR_SUBMISSION**, transition to the correct one of those three via transitionMun. Never touch a mun that is in review or live.
4. call the existing triggerReverificationIfNeeded path if applicable.

It accepts an optional tx and runs inside it when given; otherwise it opens its own.

- [ ] **Step 2: lib/actions/go-live-dashboard.ts**

getMunProgress(munId) - owning organizer or ops/admin. Returns the mun lifecycle status plus its PRD alias label, the overall percentage, required total and complete counts, the blocking issue count, a per-module array (key, label, isRequired, completionStatus, completionPercentage, verificationState, blockingIssueCount, checks), and the current submission summary or null. It reads the materialized columns - this is a dashboard read, not a gate.

It must **not** include internalNotes or anything ops-only; it is organizer-facing. Mirror the MunDetail versus MunWithApplication split in lib/types/mun.ts.

- [ ] **Step 3: Wire onModuleDataChanged into every module mutation**

Add the call at the end of: updateMunDetails (for both BASIC_INFO and DATES_VENUE), committee CRUD (COMMITTEES), portfolio CRUD (PORTFOLIOS), registration product CRUD (both REGISTRATION_TYPES and PRICING_CAPACITY), accommodation CRUD (ACCOMMODATION), and all of the Task 5 and 6 new actions.

Follow the existing triggerReverificationIfNeeded wiring style at mun-config.ts lines 100, 253, and 318 - an internal call at the end, not a new parameter callers must pass.

- [ ] **Step 4: Tests**

module-completion.test.ts: percentage arithmetic; the ONBOARDING to ACTION_REQUIRED flip when a required module is incomplete; the flip to READY_FOR_SUBMISSION when all pass; **that it does not touch a mun in VERIFICATION**; and that optional modules are excluded from the denominator.

go-live-dashboard.test.ts: the owning organizer gets progress; a non-owning organizer gets Forbidden; an ops role is allowed.

Add one regression test in mun-config.test.ts proving a committee edit moves the mun overallPercentage - the integration proof that the wiring is live, not just the unit.

- [ ] **Step 5: Run, typecheck, commit**

Run the **full** suite here, since Step 3 touched many existing files, plus the TypeScript noEmit check. Commit with the message: feat: server-computed module completion and go-live progress engine

---

## Task 9: Automated Validation Engine

**Files:**
- Create: lib/lifecycle/validation.ts (context loader + aggregator) + test
- Create: lib/lifecycle/validators/ (15 pure validators, grouped about 4 per file) + tests
- Modify: lib/lifecycle/module-registry.ts (attach validate)

**Interfaces:**
- Produces: validateMunForSubmission(munId, opts?) and loadValidationContext(munId) - Task 10 submit gate and Task 11 publish gate both call it.

- [ ] **Step 1: loadValidationContext(munId)**

**The only I/O in the whole engine.** One query per table, all indexed by munId: mun, organizerApplication, committees, portfolios (fetched with an inArray over committee ids - **not** per-committee, that is the N+1), registrationProducts, ebMembers, formFields, paymentSettings, documents, scheduleItems, contact, accommodationOptions, moduleRows, unresolvedIssues. Returns a plain object that also carries a now field.

- [ ] **Step 2: Write the 15 validators as pure functions**

Signature: takes the context, returns a ModuleValidationResult. No db, no await, no clock reads - use the context now field. Group them into validators/content.ts (BASIC_INFO, DATES_VENUE, BRANDING, CONTACT), validators/committees.ts (COMMITTEES, PORTFOLIOS, EXECUTIVE_BOARD), validators/commerce.ts (REGISTRATION_TYPES, REGISTRATION_FORM, PRICING_CAPACITY, PAYMENT_SETTLEMENT), and validators/operations.ts (RULES_DOCUMENTS, SCHEDULE, ACCOMMODATION, FINAL_REVIEW).

The check set is the PRD Section 24 list, assigned per spec Section 4. Specifics that must not be missed:
- **DATES_VENUE**: endDate after startDate; registrationDeadline before startDate; registrationOpensAt before registrationDeadline; venue, address, city, and country all non-empty.
- **PAYMENT_SETTLEMENT**: details-submitted is a BLOCKER; the VERIFIED verification state is **HIGH severity at submit stage but BLOCKER at publish stage** (spec Section 4) - gate on the stage option. This asymmetry is deliberate; a comment must say so, or a future reader will fix it into a bug.
- **PORTFOLIOS**: at least one available portfolio per active committee; no duplicate portfolio name within a committee.
- **EXECUTIVE_BOARD**: every active committee has at least one CHAIR.
- **ACCOMMODATION**: passes trivially when the mun accommodationProvided field is NOT_PROVIDED (the PRD Section 22 explicit opt-out); otherwise requires at least one active option with price and capacity.
- **RULES_DOCUMENTS**: RULES, CODE_OF_CONDUCT, and REFUND_POLICY documents all present.
- **Cross-cutting**: zero unresolved BLOCKER issues - assign each to whichever module raised it.

- [ ] **Step 3: validateMunForSubmission(munId, opts?)**

The stage option is SUBMIT (default) or PUBLISH. Loads the context once, maps the registry over it, and aggregates. It passes when no BLOCKER check failed. The blockers array is the flattened failing BLOCKER checks, which is the PRD Section 24 numbered failure list verbatim.

- [ ] **Step 4: Tests - the highest-value test surface in this plan**

The validators are pure, so test them with literal context objects and **zero DB**. One describe block per module, each with a pass case and one case per failure mode; aim for roughly 60 assertions here. Then 3-4 integration tests for loadValidationContext and validateMunForSubmission against real seeded rows, including one asserting the payment-verification severity genuinely differs between the SUBMIT and PUBLISH stages.

Consider dispatching the hypothesis-tester agent for the date-ordering validators - pure functions over date tuples are exactly its use case.

- [ ] **Step 5: Run, typecheck, commit**

Run the validation tests and the TypeScript noEmit check. Commit with the message: feat: automated validation engine, 15 pure per-module validators

**CHECKPOINT - Phase 3 complete. The validation gate exists but is not yet wired into submission. Full suite.**

---

## Phases 4-5 - Submission, Review, Go-Live (PRD Section 43 Phases 3-5)

## Task 10: Submission Gate + mun_submissions

**Files:**
- Modify: lib/db/schema-enums.ts (submissionStatusEnum, slaStateEnum), lib/db/schema.ts (munSubmissions)
- Create: lib/lifecycle/sla.ts + test
- Create: lib/lifecycle/go-live.ts (submit half) + test
- Modify: lib/lifecycle/organizer-confirmation.ts (accept ORGANIZER_CONFIRMATION, re-validate, widen snapshot)
- Create migration

**Interfaces:**
- Produces: submitMunForReview(munId, session), computeSlaState, addBusinessDays - Task 11 consumes the submission row.

- [ ] **Step 1: Add munSubmissions**

Columns per spec Section 5.1. The partial unique index is the important part - a unique on munId restricted to non-terminal statuses (excluding PUBLISHED, REJECTED, and WITHDRAWN), plus a unique on publishIdempotencyKey.

**Verify the generated SQL actually contains the WHERE clause.** If Drizzle drops it, hand-edit the migration. A non-partial unique on munId would break resubmission forever.

- [ ] **Step 2: lib/lifecycle/sla.ts**

Pure functions. addBusinessDays(from, days, cfg) and computeSlaState(input, now) per spec Section 5.2. The BusinessCalendar default is Asia/Kolkata, Monday through Friday, 10:00 to 19:00, with no holidays.

Test the edges that actually break: a Friday 18:00 submission lands Monday 18:00; a Saturday submission; a submission exactly at the deadline is OVERDUE only strictly past it; PAUSED while in CHANGES_REQUESTED; and pause accounting shifting the deadline by exactly the paused duration. Assert against explicit UTC instants, not local-time strings.

- [ ] **Step 3: submitMunForReview(munId, session) in lib/lifecycle/go-live.ts**

The exact sequence is in spec Section 4.1. All in one db transaction, with the mun row-locked first. On validation failure: persist verification_issues rows with source AUTOMATED, transition to ACTION_REQUIRED, and **commit** - the issue rows must survive, so this is not an abort - then return the blockers. On success: transition to ORGANIZER_CONFIRMATION, insert the munSubmissions row with slaDeadline set one business day out, and return the submission id.

Before inserting, mark prior unresolved AUTOMATED-source issues for this mun as resolved, so a resubmission does not accumulate stale machine issues. Reviewer-raised issues are **not** auto-resolved - only a reviewer clears those.

- [ ] **Step 4: Update submitFinalConfirmation**

organizer-confirmation.ts line 42 currently requires CONTENT_SUBMITTED. Change it to accept CONTENT_SUBMITTED **or** ORGANIZER_CONFIRMATION, and **re-run validateMunForSubmission before confirming** - otherwise an organizer can pass validation, break a field, then confirm (spec Section 4.1). Widen buildSnapshot to include all seven new tables plus accommodation. Skip the transition to ORGANIZER_CONFIRMATION when already in that state.

- [ ] **Step 5: Tests**

go-live.test.ts: an incomplete mun fails with blockers listed, ends in ACTION_REQUIRED, and has issue rows written; a complete mun succeeds with a submission row carrying a future slaDeadline; **two concurrent submitMunForReview calls produce exactly one submission row** (the partial-unique proof, using a settled-promises pattern); and a non-owning organizer gets Forbidden.

organizer-confirmation.test.ts: existing tests updated for the new status precondition, **plus a new test where validation regresses between submit and confirm and the confirmation is blocked.**

- [ ] **Step 6: Run, typecheck, commit**

Run db:generate, db:migrate, the lifecycle tests, and the TypeScript noEmit check. Commit with the message: feat: submission gate with automated validation, SLA clock, submission records

---

## Task 11: Review Decisions, Go-Live Queue, Idempotent Publish

**Files:**
- Modify: lib/lifecycle/go-live.ts (queue + publish half)
- Modify: lib/actions/admin-review.ts (review decisions, queue reads, publishMun delegation, unpublishMun target change)
- Modify: lib/actions/admin-review.test.ts
- Modify: lib/db/schema-enums.ts (adminActionEnum additions)

**Interfaces:**
- Produces: enqueueForGoLive, publishFromQueue, getGoLiveQueue, reviewSubmission - the admin UI consumes these.

- [ ] **Step 1: Add adminActionEnum values**

MUN_PUBLISHED, MUN_APPROVED, MUN_REJECTED, MODULE_REVIEWED, PAYMENT_DETAILS_CHANGED, MODULE_REQUIREMENT_CHANGED. Generate and apply the ADD VALUE migration.

- [ ] **Step 2: reviewSubmission(munId, decision, opts, session)**

OPERATIONS, ADMIN, and SUPER_ADMIN. The decision is APPROVED, CHANGES_REQUESTED, or REJECTED. Row-locks the submission. Sets reviewStartedAt on first touch, and reviewerId.
- APPROVED: mun goes to VERIFIED, submission to APPROVED.
- CHANGES_REQUESTED: mun goes to ACTION_REQUIRED, submission to CHANGES_REQUESTED, SLA to PAUSED with slaPausedAt set, and issues recorded.
- REJECTED: **requires a non-empty reason** (PRD Section 28), mun goes to REJECTED, and the reason is stored in rejectionReason.

Writes an admin_actions row in the same transaction. **Do not** route this through reviewMunApplication - that is Gate 1 and must stay untouched (spec Section 1.2).

- [ ] **Step 3: enqueueForGoLive and getGoLiveQueue**

enqueueForGoLive(munId, session): ADMIN and SUPER_ADMIN, moves VERIFIED to GO_LIVE_QUEUE, sets queuedAt, row-locked.

getGoLiveQueue(params): paginated, defaulting to 20 to match the getReviewQueue convention at admin-review.ts line 39. Joins mun and submission, and computes slaState on read via computeSlaState rather than trusting the stored column.

- [ ] **Step 4: publishFromQueue(munId, session, idempotencyKey?)**

The exact 8-step sequence is in spec Section 5.3, all in one transaction, with a FOR UPDATE lock on the **submission** row - not the mun row - as the serialization point. Re-run validateMunForSubmission with the PUBLISH stage against live data; do not trust the earlier approval. A replay against an already-published submission returns the existing result rather than throwing.

- [ ] **Step 5: publishMun delegation and unpublishMun retarget**

publishMun (admin-review.ts line 138): if an active submission row exists, delegate to publishFromQueue; otherwise keep the current direct transitionMun call, for muns published before this slice and for seed data. Its existing test must still pass.

unpublishMun (admin-review.ts line 152): change the target from VERIFIED to UNPUBLISHED (spec Section 1.4). **Update its existing test** - this is a deliberate behavior change.

- [ ] **Step 6: Tests**

publishFromQueue: the happy path reaches PUBLISHED with publishedAt set and a mun_versions row created; **calling it twice returns the same result and creates exactly one version row** (idempotency); **two concurrent calls produce one publish and one no-op replay, with one version row** (concurrency); a mun whose payment verification regressed to PENDING is blocked with a specific message; and a non-ADMIN gets Forbidden.

reviewSubmission: rejecting without a reason throws; CHANGES_REQUESTED pauses the SLA; two concurrent decisions leave exactly one winner.

- [ ] **Step 7: Run, typecheck, commit**

Full suite plus the TypeScript noEmit check. Commit with the message: feat: review decisions, go-live queue, idempotent concurrency-safe publish

---

## Phase 6 - Hardening (PRD Section 43 Phase 6)

## Task 12: Re-verification Extension, Locking, Notifications, Docs

**Files:**
- Modify: lib/lifecycle/reverification.ts + test
- Create: lib/notifications/pipeline-events.ts + test
- Modify: module action files (lock enforcement + notification calls)
- Modify: CLAUDE.md

- [ ] **Step 1: Fill in HIGH_IMPACT_FIELDS for all 15 modules**

The exact lists are in spec Section 6. Restore the type to the exhaustive Record<MunModule, string[]>, removing the temporary Partial from Task 2 - it must be a compile error to add a module without deciding its high-impact fields. Keep the 4 legacy keys mapped to empty lists.

Add UNPUBLISHED to POST_VERIFICATION_STATUSES. Fix the existing latent bug: triggerReverificationIfNeeded issues an UPDATE filtered by moduleName that silently affects zero rows when no module row exists - route through getModuleVerificationState first.

- [ ] **Step 2: Payment-change special case**

When PAYMENT_SETTLEMENT re-verification triggers, **also reset verificationState to PENDING**. Per spec Section 6, this is the fraud vector: get approved with a clean account, then swap it. Give it its own dedicated test.

- [ ] **Step 3: Form-builder structural exception**

detectHighImpactChange is a field diff and cannot see deletions. In registration-form.ts, when the mun is past VERIFIED and the operation is a field delete or an optional-to-required flip, force re-verification directly. Add a comment explaining why this deliberately bypasses the pure detector.

- [ ] **Step 4: LOCKED enforcement**

When mun.status is one of CONTENT_SUBMITTED, AUTOMATED_VALIDATION, ORGANIZER_CONFIRMATION, or VERIFICATION, reject organizer edits to modules with a **non-empty** HIGH_IMPACT_FIELDS list, with a message naming the module and explaining that review is in progress. Admin edits are still allowed - ops correcting a typo mid-review is a real workflow. Implement it as assertModuleNotLocked(munId, moduleKey, session) in module-completion.ts, called at the top of the affected update actions. Set completionStatus to LOCKED on those module rows for display.

Scope note: modules with empty HIGH_IMPACT_FIELDS lists (BRANDING, REGISTRATION_FORM, FINAL_REVIEW) stay editable during review by design - full lock coverage is a deferred follow-up per spec Section 9.

- [ ] **Step 5: lib/notifications/pipeline-events.ts**

A PipelineEvent union covering the 11 organizer and 6 admin events in PRD Section 35, minus SLA_APPROACHING, which needs a scheduler and is deferred. renderPipelineNotification(event) is **pure** and unit-testable without I/O. notifyPipelineEvent(event) resolves recipients and calls the console notifications adapter.

Call sites: submitMunForReview, reviewSubmission, reviewModule, submitFinalConfirmation, and publishFromQueue. **Outside the transaction, after commit**, wrapped in a try/catch that logs the failure - a notification must never roll back a state change, and must never be silently swallowed.

- [ ] **Step 6: Full suite, typecheck, lint**

Run the full test suite, the TypeScript noEmit check, and the lint script. Show actual output. Expect well north of 200 tests.

- [ ] **Step 7: Update CLAUDE.md**

Add a section covering: the 6 new statuses and the **Gate-1 versus Gate-2 vocabulary split** (the single most important thing for a future agent not to get wrong); that PUBLISHED is the PRD LIVE state, deliberately not renamed; the 15-module registry and where validators live; the completion-versus-verification two-axis model on mun_module_verifications; mun_submissions plus SLA plus publish idempotency; the payment write-only encryption rule and its PAYMENT_FIELD_KEY environment variable; and the deferred list from spec Section 9. Link both the spec and this plan.

- [ ] **Step 8: Commit**

Commit with the message: feat: extend re-verification to 15 modules, add module locking and pipeline notifications

---

## Task 13: Seed, Neon Migration, Review Dispatch

- [ ] **Step 1: Extend lib/db/seed.ts**

Give the 2 demo MUNs (Oxford, VIT) full 15-module data so the go-live dashboard has something to render at 100 percent. Leave the 6 real Hyderabad MUNs partially complete - a realistic ACTION_REQUIRED state is better demo material than eight identical green dashboards. The seed must stay **idempotent**, which is its existing guarantee.

- [ ] **Step 2: Apply migrations to Neon**

Run the db:migrate script against the .env DATABASE_URL, which is Neon. All migrations in this plan are additive (ADD VALUE, CREATE TABLE, ADD COLUMN) plus two data statements: the Task 2 remap and the Task 3 dedupe. **Check the Task 3 dedupe blast radius first** - run its SELECT equivalent against Neon to count how many rows it would delete. If it is more than a handful, stop and ask the user before running the migration.

- [ ] **Step 3: Verification trace**

Before claiming done, produce the connectivity trace:

    ENTRY:  organizer dashboard -> getMunProgress (go-live-dashboard.ts)
            -> recomputeMunProgress (module-completion.ts) -> MODULE_REGISTRY validators
    SUBMIT: submitMunForReview (go-live.ts) -> validateMunForSubmission -> transitionMun -> munSubmissions
    REVIEW: getModuleReviewQueue / getGoLiveQueue -> reviewSubmission -> publishFromQueue -> muns.status = PUBLISHED
    TEST:   <names of the submit-gate, idempotent-publish, and concurrency tests>
    RESULT: <actual test suite output>

Every new module and function must have a caller. Run the integration-enforcer agent to confirm nothing is orphaned.

- [ ] **Step 4: Dispatch review agents in parallel**

This slice touches auth boundaries, money-adjacent data (bank details), and concurrency. Dispatch these in a single message:
- red-team: payment field encryption and masking, the publish gate, and IDOR across the 7 new module action files
- adversarial-coach: the concurrency paths (publish idempotency, submission uniqueness, module review locks)
- integration-enforcer: wiring and orphan check
- test-authenticator: the roughly 200 new tests, specifically whether the validator tests are tautological

Fix findings before declaring the slice done.

- [ ] **Step 5: Notify the UI session**

Summarize for mun-hub-02: the 6 new statuses and the PUBLISHED-is-LIVE labeling decision; the exact getMunProgress return shape; the getGoLiveQueue and getModuleReviewQueue shapes; MaskedPaymentSettings, and that the server never returns plaintext so no client-side masking is needed or trusted; and the lib/mun-status.ts placeholder entries needing real copy.

---

## Self-Review Notes

- **Spec coverage:** Section 1 lifecycle to Task 1; Section 2 modules to Tasks 2, 4, 5, 6, 7; Section 3 progress to Task 8; Section 4 validation to Task 9; Section 5 queue/SLA/publish to Tasks 10 and 11; Section 6 re-verification to Task 12; Section 7 notifications/audit to Tasks 11 and 12; Section 8 security distributed across Tasks 5, 6, 7, 11; Section 9 deferrals deliberately have no tasks.
- **Checkpoints** after Tasks 3, 6, and 9 - each leaves a working system with the full suite green. A session running out of budget mid-plan should stop at one of these, not mid-phase.
- **Sharpest hazard, called out twice:** the Task 2 Step 3 two-migration split. An ADD VALUE plus an UPDATE using the new value in one transaction fails on Postgres. A migration error mentioning unsafe use of a new enum value is this.
- **Flagged rather than guessed:** the partial-unique-index SQL generation (Task 10 Step 1 - verify Drizzle emits the WHERE clause), whether a concrete StorageAdapter implementation exists (Task 5 Step 2 - grep first), whether mun-status-badge.tsx has its own exhaustive map (Task 1 - read first), and the Neon dedupe blast radius (Task 13 Step 2 - count before deleting).
- **Deliberate behavior changes, each with its test update named:** unpublishMun now targets UNPUBLISHED; submitFinalConfirmation re-validates and accepts a second precondition status; publishMun delegates when a submission exists; and the PUBLISHED display label becomes Live.
- **No implementation code written** - every task states files, interfaces, and the decision being applied, with literal detail only where the exact shape is load-bearing (enum value lists, the partial-unique index, the payment leak test).
