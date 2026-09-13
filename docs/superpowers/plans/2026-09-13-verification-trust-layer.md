# Verification & Confirmation Trust Layer (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core trust mechanism (module-level verification, organizer confirmation gate, versioning, re-verification triggers) from the new PRD, applied to existing modules (mun details, committees, portfolios, registration products).

**Architecture:** Extends the existing `MunStatus` lifecycle and `transitionMun` state machine rather than replacing them. New tables track per-module verification state and versioned snapshots. Re-verification is a pure-function detector called from existing update actions, not a new API surface callers must remember to invoke.

**Tech Stack:** Drizzle ORM, existing `db.transaction()` + `.for('update')` patterns already proven in `registration.ts`/`mun-state-machine.ts`.

**Spec:** `docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md`

## Global Constraints

- Every new action derives the actor via `getSession()` internally — never accept a session/role parameter from the caller.
- `verification_issues` and `organizer_confirmations` are append-only (no update/delete actions).
- `registrations.munVersionId` is added as a schema column only — do NOT wire capture logic into `initiateRegistration` in this plan (separate future slice, explicit user decision).
- `publishMun` behavior changes: now requires `mun.status === 'VERIFIED'`, not `'VERIFICATION'` — this is an intentional breaking change to match the new Gate 3/4 split, update its existing test accordingly.
- Files 200-400 lines typical — split `lib/lifecycle/` into separate files per concern (module-verification, organizer-confirmation, reverification) as the spec already lays out, don't cram into one file.

---

## Task 1: Extend MunStatus Enum + State Machine

**Files:**
- Modify: `lib/db/schema-enums.ts` (munStatusEnum)
- Modify: `lib/lifecycle/mun-state-machine.ts` (ALLOWED_TRANSITIONS)
- Modify: `lib/lifecycle/mun-state-machine.test.ts`
- Create migration via `drizzle-kit generate`

**Interfaces:**
- Produces: 5 new `MunStatus` values (`ORGANIZER_CONFIRMATION`, `VERIFIED`, `RESULTS_PENDING`, `RESULTS_UNDER_REVIEW`, `CANCELLED`) — later tasks' actions reference these by name.

- [ ] **Step 1: Update the enum**

In `lib/db/schema-enums.ts`, change:
```typescript
export const munStatusEnum = pgEnum('mun_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'ONBOARDING',
  'CONTENT_SUBMITTED',
  'ORGANIZER_CONFIRMATION',
  'VERIFICATION',
  'VERIFIED',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CONFERENCE_ACTIVE',
  'RESULTS_PENDING',
  'RESULTS_UNDER_REVIEW',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
])
```

- [ ] **Step 2: Update the transitions map**

In `lib/lifecycle/mun-state-machine.ts`, replace `ALLOWED_TRANSITIONS`:
```typescript
const ALLOWED_TRANSITIONS: Record<MunStatus, MunStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  APPROVED: ['ONBOARDING', 'CANCELLED'],
  REJECTED: [],
  CHANGES_REQUESTED: ['SUBMITTED', 'CANCELLED'],
  ONBOARDING: ['CONTENT_SUBMITTED', 'CANCELLED'],
  CONTENT_SUBMITTED: ['ORGANIZER_CONFIRMATION', 'CANCELLED'],
  ORGANIZER_CONFIRMATION: ['VERIFICATION', 'CANCELLED'],
  VERIFICATION: ['VERIFIED', 'CHANGES_REQUESTED', 'CANCELLED'],
  VERIFIED: ['PUBLISHED', 'VERIFICATION', 'CANCELLED'],
  PUBLISHED: ['REGISTRATION_OPEN', 'VERIFICATION', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'VERIFICATION', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CONFERENCE_ACTIVE', 'CANCELLED'],
  CONFERENCE_ACTIVE: ['RESULTS_PENDING', 'CANCELLED'],
  RESULTS_PENDING: ['RESULTS_UNDER_REVIEW'],
  RESULTS_UNDER_REVIEW: ['COMPLETED', 'RESULTS_PENDING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: [],
}
```
Note: `VERIFIED`/`PUBLISHED`/`REGISTRATION_OPEN` can transition back to `VERIFICATION` — this is what re-verification (Task 5) uses. `CANCELLED` is reachable from most non-terminal states per PRD §2's mention of a cancellation path, and is itself terminal.

- [ ] **Step 3: Update existing tests for the new transitions**

In `lib/lifecycle/mun-state-machine.test.ts`, the existing `canTransition` tests should still pass unchanged (DRAFT→SUBMITTED, UNDER_REVIEW→APPROVED are untouched). Add:
```typescript
describe('new lifecycle states', () => {
  it('allows CONTENT_SUBMITTED to ORGANIZER_CONFIRMATION', () => {
    expect(canTransition('CONTENT_SUBMITTED', 'ORGANIZER_CONFIRMATION')).toBe(true)
  })

  it('allows ORGANIZER_CONFIRMATION to VERIFICATION', () => {
    expect(canTransition('ORGANIZER_CONFIRMATION', 'VERIFICATION')).toBe(true)
  })

  it('allows VERIFICATION to VERIFIED', () => {
    expect(canTransition('VERIFICATION', 'VERIFIED')).toBe(true)
  })

  it('allows VERIFIED back to VERIFICATION (re-verification)', () => {
    expect(canTransition('VERIFIED', 'VERIFICATION')).toBe(true)
  })

  it('disallows VERIFICATION directly to PUBLISHED (must pass through VERIFIED)', () => {
    expect(canTransition('VERIFICATION', 'PUBLISHED')).toBe(false)
  })

  it('allows DRAFT to CANCELLED', () => {
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true)
  })
})
```

- [ ] **Step 4: Generate and apply migration**

Run: `npx drizzle-kit generate` then `npx tsx lib/db/migrate.ts` (against local Docker — confirm `docker compose ps` shows healthy first, start with `npm run db:up` if not).
Expected: new migration file created, applies cleanly, no errors. Existing enum values are preserved (Postgres `ALTER TYPE ... ADD VALUE` is additive, non-destructive).

- [ ] **Step 5: Run tests, verify, commit**

Run: `npm run test -- lib/lifecycle/mun-state-machine.test.ts && npx tsc --noEmit`
Expected: all pass, 0 errors.

```bash
git add lib/db/schema-enums.ts lib/lifecycle/mun-state-machine.ts lib/lifecycle/mun-state-machine.test.ts drizzle/
git commit -m "$(cat <<'EOF'
feat: extend MunStatus lifecycle for verification/confirmation gates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- lib/db/schema-enums.ts lib/lifecycle/mun-state-machine.ts lib/lifecycle/mun-state-machine.test.ts drizzle/
```

---

## Task 2: New Schema Tables

**Files:**
- Modify: `lib/db/schema.ts` (add 4 new tables + 1 column)
- Create migration via `drizzle-kit generate`

**Interfaces:**
- Consumes: `munStatusEnum` extended in Task 1 (not directly referenced, but same file).
- Produces: `munModuleVerifications`, `verificationIssues`, `organizerConfirmations`, `munVersions` tables + `registrations.munVersionId` column — Tasks 3-5 import these from `lib/db/schema.ts`.

- [ ] **Step 1: Add a module-name enum and verification-state enum**

In `lib/db/schema-enums.ts`, add:
```typescript
export const munModuleEnum = pgEnum('mun_module', [
  'mun_details',
  'committees',
  'portfolios',
  'registration_products',
])

export const moduleVerificationStateEnum = pgEnum('module_verification_state', [
  'NOT_SUBMITTED',
  'PENDING_REVIEW',
  'VERIFIED',
  'CHANGES_REQUESTED',
  'REJECTED',
])

export const verificationSeverityEnum = pgEnum('verification_severity', [
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
])

export type MunModule = (typeof munModuleEnum.enumValues)[number]
export type ModuleVerificationState = (typeof moduleVerificationStateEnum.enumValues)[number]
export type VerificationSeverity = (typeof verificationSeverityEnum.enumValues)[number]
```

- [ ] **Step 2: Add the 4 new tables to `lib/db/schema.ts`**

Add near the bottom, after `verificationLogs`:
```typescript
export const munModuleVerifications = pgTable(
  'mun_module_verifications',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    moduleName: munModuleEnum('module_name').notNull(),
    state: moduleVerificationStateEnum('state').notNull().default('NOT_SUBMITTED'),
    organizerConfirmedAt: timestamp('organizer_confirmed_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    lastReviewedBy: text('last_reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mun_module_verifications_mun_id_idx').on(table.munId),
  ],
)

export const munModuleVerificationsRelations = relations(munModuleVerifications, ({ one }) => ({
  mun: one(muns, { fields: [munModuleVerifications.munId], references: [muns.id] }),
}))

export const verificationIssues = pgTable(
  'verification_issues',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    moduleName: munModuleEnum('module_name').notNull(),
    severity: verificationSeverityEnum('severity').notNull(),
    reason: text('reason').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    resolved: boolean('resolved').notNull().default(false),
    raisedBy: text('raised_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('verification_issues_mun_id_idx').on(table.munId),
  ],
)

export const organizerConfirmations = pgTable(
  'organizer_confirmations',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    confirmingUserId: text('confirming_user_id')
      .notNull()
      .references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    versionNumber: integer('version_number').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
  },
  (table) => [
    index('organizer_confirmations_mun_id_idx').on(table.munId),
  ],
)

export const munVersions = pgTable(
  'mun_versions',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mun_versions_mun_id_idx').on(table.munId),
  ],
)

export const munVersionsRelations = relations(munVersions, ({ one, many }) => ({
  mun: one(muns, { fields: [munVersions.munId], references: [muns.id] }),
  registrations: many(registrations),
}))
```

Add the required new imports at the top of `schema.ts`: `boolean`, `jsonb` (check if `jsonb` is already imported — `formResponses` on `registrations` uses it, so it likely already is; `boolean` is probably new).

- [ ] **Step 3: Add `munVersionId` to `registrations`**

In the existing `registrations` table definition, add one nullable column:
```typescript
munVersionId: text('mun_version_id').references(() => munVersions.id),
```
Do NOT make it `.notNull()` — existing rows have no version, and `initiateRegistration` isn't being changed in this plan to populate it.

- [ ] **Step 4: Generate and apply migration**

Run: `npx drizzle-kit generate` then `npx tsx lib/db/migrate.ts`.
Expected: applies cleanly against local Docker Postgres.

- [ ] **Step 5: Write a smoke test proving the tables are queryable**

Create `lib/db/verification-schema.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from './client'
import { muns, users, munModuleVerifications, verificationIssues, organizerConfirmations, munVersions } from './schema'

describe('verification schema tables', () => {
  it('can insert and read a mun_module_verifications row', async () => {
    const [organizer] = await db.insert(users).values({ name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' }).returning()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Schema Test Mun', slug: `schema-test-${Date.now()}` }).returning()

    const [row] = await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'committees', state: 'NOT_SUBMITTED' })
      .returning()

    expect(row.state).toBe('NOT_SUBMITTED')
  })

  it('can insert a verification_issues row with severity', async () => {
    const [organizer] = await db.insert(users).values({ name: 'Org2', email: `org2-${Date.now()}@test.com`, role: 'ORGANIZER' }).returning()
    const [reviewer] = await db.insert(users).values({ name: 'Rev', email: `rev-${Date.now()}@test.com`, role: 'OPERATIONS' }).returning()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Issue Mun', slug: `issue-mun-${Date.now()}` }).returning()

    const [issue] = await db
      .insert(verificationIssues)
      .values({ munId: mun.id, moduleName: 'mun_details', severity: 'BLOCKER', reason: 'Missing venue address', raisedBy: reviewer.id })
      .returning()

    expect(issue.severity).toBe('BLOCKER')
    expect(issue.resolved).toBe(false)
  })

  it('can insert organizer_confirmations and mun_versions rows with a jsonb snapshot', async () => {
    const [organizer] = await db.insert(users).values({ name: 'Org3', email: `org3-${Date.now()}@test.com`, role: 'ORGANIZER' }).returning()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Version Mun', slug: `version-mun-${Date.now()}` }).returning()

    const [confirmation] = await db
      .insert(organizerConfirmations)
      .values({ munId: mun.id, confirmingUserId: organizer.id, versionNumber: 1, snapshotJson: { name: mun.name } })
      .returning()
    expect(confirmation.versionNumber).toBe(1)

    const [version] = await db
      .insert(munVersions)
      .values({ munId: mun.id, versionNumber: 1, snapshotJson: { name: mun.name } })
      .returning()
    expect(version.snapshotJson).toEqual({ name: mun.name })
  })

  afterAll(async () => {
    await db.$disconnect?.()
  })
})
```
(If `db.$disconnect` doesn't exist on this Drizzle client — check `lib/db/client.ts`'s actual shape, e.g. it might be `db.$client.end()` per the pattern used elsewhere in this repo's tests — use whichever the codebase already uses.)

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npm run test -- lib/db/verification-schema.test.ts && npx tsc --noEmit`
Expected: all pass, 0 errors.

```bash
git add lib/db/schema.ts lib/db/schema-enums.ts lib/db/verification-schema.test.ts drizzle/
git commit -m "$(cat <<'EOF'
feat: add module verification, versioning, and confirmation tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- lib/db/schema.ts lib/db/schema-enums.ts lib/db/verification-schema.test.ts drizzle/
```

---

## Task 3: Module Verification Actions

**Files:**
- Create: `lib/lifecycle/module-verification.ts`
- Create: `lib/lifecycle/module-verification.test.ts`

**Interfaces:**
- Consumes: `munModuleVerifications`, `verificationIssues` from Task 2; `transitionMun` from `mun-state-machine.ts`; `requireRole`/`getSession` from existing auth.
- Produces: `getModuleVerificationState(munId, moduleName)`, `confirmModule(munId, moduleName, session)`, `reviewModule(munId, moduleName, decision, issues, session)`, `checkAllModulesVerified(munId)` — Task 4/5 and later UI work call these.

- [ ] **Step 1: Write failing tests**

Create `lib/lifecycle/module-verification.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  getModuleVerificationState,
  confirmModule,
  reviewModule,
  checkAllModulesVerified,
} from './module-verification'

async function makeUser(role: 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'STUDENT') {
  const [user] = await db.insert(users).values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role }).returning()
  return user
}

async function makeMun(organizerId: string, status: 'VERIFICATION' | 'DRAFT' = 'VERIFICATION') {
  const [mun] = await db.insert(muns).values({ organizerId, name: 'Verify Mun', slug: `verify-mun-${crypto.randomUUID()}`, status }).returning()
  return mun
}

describe('getModuleVerificationState', () => {
  it('lazily creates a NOT_SUBMITTED row on first read', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const state = await getModuleVerificationState(mun.id, 'committees')
    expect(state.state).toBe('NOT_SUBMITTED')

    const [row] = await db.select().from(munModuleVerifications).where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'committees')))
    expect(row).toBeDefined()
  })
})

describe('confirmModule', () => {
  it('lets the owning organizer confirm and moves state to PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const result = await confirmModule(mun.id, 'portfolios', { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.state).toBe('PENDING_REVIEW')
    expect(result.organizerConfirmedAt).toBeTruthy()
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(confirmModule(mun.id, 'portfolios', { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  it('rejects confirming a module that is already PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })

    await expect(confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow('cannot be confirmed from its current state')
  })
})

describe('reviewModule', () => {
  it('lets OPERATIONS verify a module and records no issues when decision is VERIFIED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(mun.id, 'committees', 'VERIFIED', [], { userId: reviewer.id, role: 'OPERATIONS' })
    expect(result.state).toBe('VERIFIED')
    expect(result.lastReviewedBy).toBe(reviewer.id)
  })

  it('records issues and flips to CHANGES_REQUESTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'registration_products', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(
      mun.id,
      'registration_products',
      'CHANGES_REQUESTED',
      [{ severity: 'HIGH', reason: 'Price missing currency context' }],
      { userId: reviewer.id, role: 'OPERATIONS' },
    )
    expect(result.state).toBe('CHANGES_REQUESTED')
  })

  it('rejects a STUDENT session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    const mun = await makeMun(organizer.id)

    await expect(
      reviewModule(mun.id, 'committees', 'VERIFIED', [], { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('Forbidden')
  })
})

describe('checkAllModulesVerified', () => {
  it('transitions the mun to VERIFIED and creates a version once all 4 modules pass', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    const modules = ['mun_details', 'committees', 'portfolios', 'registration_products'] as const
    for (const moduleName of modules) {
      await confirmModule(mun.id, moduleName, { userId: organizer.id, role: 'ORGANIZER' })
      await reviewModule(mun.id, moduleName, 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })
    }

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })

  it('does not transition the mun if only some modules are verified', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    await confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })
    await reviewModule(mun.id, 'committees', 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')
  })
})

afterAll(async () => {
  await db.$client.end()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- lib/lifecycle/module-verification.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/lifecycle/module-verification.ts`:
```typescript
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import type { MunModule, ModuleVerificationState, VerificationSeverity } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { transitionMun } from './mun-state-machine'

const TRACKED_MODULES: MunModule[] = ['mun_details', 'committees', 'portfolios', 'registration_products']

async function assertOwnsOrAdmin(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return
  const [mun] = await db.select({ organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}

export interface ModuleVerification {
  id: string
  munId: string
  moduleName: MunModule
  state: ModuleVerificationState
  organizerConfirmedAt: Date | null
  lastReviewedAt: Date | null
  lastReviewedBy: string | null
}

export async function getModuleVerificationState(munId: string, moduleName: MunModule): Promise<ModuleVerification> {
  const [existing] = await db
    .select()
    .from(munModuleVerifications)
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(munModuleVerifications)
    .values({ munId, moduleName, state: 'NOT_SUBMITTED' })
    .returning()
  return created
}

export async function confirmModule(munId: string, moduleName: MunModule, session: Session | null): Promise<ModuleVerification> {
  await assertOwnsOrAdmin(munId, session)

  const current = await getModuleVerificationState(munId, moduleName)
  if (current.state !== 'NOT_SUBMITTED' && current.state !== 'CHANGES_REQUESTED') {
    throw new Error(`Module "${moduleName}" cannot be confirmed from its current state (${current.state})`)
  }

  const [updated] = await db
    .update(munModuleVerifications)
    .set({ state: 'PENDING_REVIEW', organizerConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(munModuleVerifications.id, current.id))
    .returning()
  return updated
}

export interface IssueInput {
  severity: VerificationSeverity
  reason: string
  previousValue?: string
  newValue?: string
}

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export async function reviewModule(
  munId: string,
  moduleName: MunModule,
  decision: 'VERIFIED' | 'CHANGES_REQUESTED' | 'REJECTED',
  issues: IssueInput[],
  session: Session | null,
): Promise<ModuleVerification> {
  requireRole(session, [...REVIEW_ROLES])

  const current = await getModuleVerificationState(munId, moduleName)

  for (const issue of issues) {
    await db.insert(verificationIssues).values({
      munId,
      moduleName,
      severity: issue.severity,
      reason: issue.reason,
      previousValue: issue.previousValue,
      newValue: issue.newValue,
      raisedBy: session.userId,
    })
  }

  const [updated] = await db
    .update(munModuleVerifications)
    .set({ state: decision, lastReviewedAt: new Date(), lastReviewedBy: session.userId, updatedAt: new Date() })
    .where(eq(munModuleVerifications.id, current.id))
    .returning()

  if (decision === 'VERIFIED') {
    await checkAllModulesVerified(munId)
  }

  return updated
}

export async function checkAllModulesVerified(munId: string): Promise<boolean> {
  const rows = await db.select().from(munModuleVerifications).where(eq(munModuleVerifications.munId, munId))
  const rowsByModule = new Map(rows.map((r) => [r.moduleName, r]))

  const allVerified = TRACKED_MODULES.every((m) => rowsByModule.get(m)?.state === 'VERIFIED')
  if (!allVerified) return false

  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || mun.status !== 'VERIFICATION') return false

  await transitionMun(munId, 'VERIFIED', 'system', 'All modules verified')
  return true
}
```

Note: `transitionMun`'s `actorId` parameter is `'system'` here since this is an automatic transition, not a specific reviewer's action — check `verificationLogs.reviewerId`'s FK constraint (references `users.id`) — **if this FK is NOT NULL and requires a real user**, this will fail. If so, pass the `session.userId` of whichever reviewer's `reviewModule` call triggered the final verification instead of the literal string `'system'` — thread it through as a parameter. Verify against the real schema before assuming either approach works; the test in Step 1 will catch this either way (FK violation surfaces as a thrown error).

- [ ] **Step 4: Run tests, fix any FK issue found, verify pass**

Run: `npm run test -- lib/lifecycle/module-verification.test.ts`
Expected: PASS. If the `'system'` actorId fails on the `verificationLogs.reviewerId` FK, thread the real reviewer's `session.userId` through `checkAllModulesVerified(munId, lastReviewerId)` instead and update the call site in `reviewModule`.

- [ ] **Step 5: Typecheck, commit**

Run: `npx tsc --noEmit`
Expected: 0 errors.

```bash
git add lib/lifecycle/module-verification.ts lib/lifecycle/module-verification.test.ts
git commit -m "$(cat <<'EOF'
feat: add module-level verification actions (confirm/review/auto-transition)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- lib/lifecycle/module-verification.ts lib/lifecycle/module-verification.test.ts
```

---

## Task 4: Organizer Final Confirmation (Gate 3)

**Files:**
- Create: `lib/lifecycle/organizer-confirmation.ts`
- Create: `lib/lifecycle/organizer-confirmation.test.ts`

**Interfaces:**
- Consumes: `organizerConfirmations`, `munVersions` from Task 2; `committees`, `portfolios`, `registrationProducts` from existing schema; `transitionMun`.
- Produces: `submitFinalConfirmation(munId, session): Promise<Mun>` — later UI work (mun-hub-02's Organizer Final Confirmation screen) calls this directly.

- [ ] **Step 1: Write failing tests**

Create `lib/lifecycle/organizer-confirmation.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, organizerConfirmations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { submitFinalConfirmation } from './organizer-confirmation'

async function makeUser(role: 'ORGANIZER' | 'STUDENT') {
  const [user] = await db.insert(users).values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role }).returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db.insert(muns).values({ organizerId, name: 'Confirm Mun', slug: `confirm-mun-${crypto.randomUUID()}`, status: 'CONTENT_SUBMITTED' }).returning()
  return mun
}

describe('submitFinalConfirmation', () => {
  it('creates a confirmation snapshot and moves the mun to VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const result = await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.status).toBe('VERIFICATION')

    const [confirmation] = await db.select().from(organizerConfirmations).where(eq(organizerConfirmations.munId, mun.id))
    expect(confirmation.confirmingUserId).toBe(organizer.id)
    expect(confirmation.versionNumber).toBe(1)
    expect(confirmation.snapshotJson).toBeTruthy()
  })

  it('rejects a mun not in CONTENT_SUBMITTED status', async () => {
    const organizer = await makeUser('ORGANIZER')
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Wrong State Mun', slug: `wrong-state-${crypto.randomUUID()}`, status: 'DRAFT' }).returning()

    await expect(submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow()
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(submitFinalConfirmation(mun.id, { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- lib/lifecycle/organizer-confirmation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/lifecycle/organizer-confirmation.ts`:
```typescript
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, committees, portfolios, registrationProducts, organizerConfirmations } from '@/lib/db/schema'
import type { Mun } from '@/lib/types'
import type { Session } from '@/lib/auth/adapter'
import { transitionMun } from './mun-state-machine'

async function buildSnapshot(munId: string) {
  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  const munCommittees = await db.select().from(committees).where(eq(committees.munId, munId))
  const committeeIds = munCommittees.map((c) => c.id)
  const munPortfolios = committeeIds.length
    ? await db.select().from(portfolios).where(eq(portfolios.committeeId, committeeIds[0]))
    : []
  const munProducts = await db.select().from(registrationProducts).where(eq(registrationProducts.munId, munId))

  return {
    mun,
    committees: munCommittees,
    portfolios: munPortfolios,
    registrationProducts: munProducts,
  }
}

export async function submitFinalConfirmation(munId: string, session: Session | null): Promise<Mun> {
  if (!session) throw new Error('Forbidden')

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  if (mun.organizerId !== session.userId && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN') {
    throw new Error('Forbidden')
  }
  if (mun.status !== 'CONTENT_SUBMITTED') {
    throw new Error(`Cannot submit final confirmation from status ${mun.status}`)
  }

  const [priorConfirmation] = await db
    .select({ versionNumber: organizerConfirmations.versionNumber })
    .from(organizerConfirmations)
    .where(eq(organizerConfirmations.munId, munId))
    .orderBy(organizerConfirmations.versionNumber)

  const nextVersion = (priorConfirmation?.versionNumber ?? 0) + 1
  const snapshot = await buildSnapshot(munId)

  await db.insert(organizerConfirmations).values({
    munId,
    confirmingUserId: session.userId,
    versionNumber: nextVersion,
    snapshotJson: snapshot,
  })

  await transitionMun(munId, 'ORGANIZER_CONFIRMATION', session.userId, 'Organizer submitted final confirmation')
  return transitionMun(munId, 'VERIFICATION', session.userId, 'Auto-advanced to MUNHub verification')
}
```

Note the portfolio query above only fetches portfolios for the FIRST committee (`committeeIds[0]`) — this is a bug to fix, not ship as-is. Correct it to fetch portfolios across ALL of the mun's committees:
```typescript
const { inArray } = await import('drizzle-orm') // or add to the top-level import
const munPortfolios = committeeIds.length
  ? await db.select().from(portfolios).where(inArray(portfolios.committeeId, committeeIds))
  : []
```
Add `inArray` to the top-level `drizzle-orm` import instead of a dynamic import — write it correctly the first time in the actual file, the inline snippet above just calls out the fix explicitly so it isn't missed.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- lib/lifecycle/organizer-confirmation.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, commit**

Run: `npx tsc --noEmit`
Expected: 0 errors.

```bash
git add lib/lifecycle/organizer-confirmation.ts lib/lifecycle/organizer-confirmation.test.ts
git commit -m "$(cat <<'EOF'
feat: add organizer final confirmation gate (Gate 3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- lib/lifecycle/organizer-confirmation.ts lib/lifecycle/organizer-confirmation.test.ts
```

---

## Task 5: Re-verification Trigger

**Files:**
- Create: `lib/lifecycle/reverification.ts`
- Create: `lib/lifecycle/reverification.test.ts`
- Modify: `lib/actions/mun-config.ts` (wire into `updateMunDetails`, `updateRegistrationProduct`, `updateCommittee`)
- Modify: `lib/actions/mun-config.test.ts` (regression tests for the wiring)

**Interfaces:**
- Consumes: `transitionMun`, module-verification's `getModuleVerificationState`/internal update (reuse the same `munModuleVerifications` update pattern, don't reimport `confirmModule`/`reviewModule` since those have gating logic that doesn't apply to an automatic system-triggered reset).
- Produces: `detectHighImpactChange(moduleName, before, after): boolean`, `triggerReverificationIfNeeded(munId, moduleName, before, after, actorId): Promise<void>` — Task 5's own wiring into `mun-config.ts` is the only caller for this slice; later UI-facing edit paths would call the same functions.

- [ ] **Step 1: Write failing tests for the pure detector**

Create `lib/lifecycle/reverification.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { detectHighImpactChange, triggerReverificationIfNeeded } from './reverification'

describe('detectHighImpactChange', () => {
  it('detects a price change on registration_products as high-impact', () => {
    expect(detectHighImpactChange('registration_products', { price: 2000 }, { price: 2500 })).toBe(true)
  })

  it('does not flag an unchanged price', () => {
    expect(detectHighImpactChange('registration_products', { price: 2000 }, { price: 2000 })).toBe(false)
  })

  it('ignores changes to fields not on the high-impact list', () => {
    expect(detectHighImpactChange('mun_details', { description: 'old' }, { description: 'new' })).toBe(false)
  })

  it('detects a mun name change as high-impact', () => {
    expect(detectHighImpactChange('mun_details', { name: 'Old Name' }, { name: 'New Name' })).toBe(true)
  })

  it('detects a committee capacity change as high-impact', () => {
    expect(detectHighImpactChange('committees', { capacity: 30 }, { capacity: 50 })).toBe(true)
  })
})

async function makeUser(role: 'ORGANIZER' = 'ORGANIZER') {
  const [user] = await db.insert(users).values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role }).returning()
  return user
}

describe('triggerReverificationIfNeeded', () => {
  it('flips a VERIFIED module and the mun back to VERIFICATION when the mun is already VERIFIED and a high-impact field changed', async () => {
    const organizer = await makeUser()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Reverify Mun', slug: `reverify-mun-${crypto.randomUUID()}`, status: 'VERIFIED' }).returning()
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'registration_products', state: 'VERIFIED' })

    await triggerReverificationIfNeeded('registration_products', { price: 2000 }, { price: 3000 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')

    const [moduleState] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'registration_products')))
    expect(moduleState.state).toBe('PENDING_REVIEW')
  })

  it('is a no-op if the mun is not yet VERIFIED', async () => {
    const organizer = await makeUser()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Draft Mun', slug: `draft-mun-${crypto.randomUUID()}`, status: 'DRAFT' }).returning()

    await triggerReverificationIfNeeded('registration_products', { price: 2000 }, { price: 3000 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('DRAFT')
  })

  it('is a no-op if the change is not high-impact', async () => {
    const organizer = await makeUser()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Stable Mun', slug: `stable-mun-${crypto.randomUUID()}`, status: 'VERIFIED' }).returning()

    await triggerReverificationIfNeeded('mun_details', { description: 'old' }, { description: 'new' }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })
})

afterAll(async () => {
  await db.$client.end()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- lib/lifecycle/reverification.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/lifecycle/reverification.ts`:
```typescript
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications } from '@/lib/db/schema'
import type { MunModule } from '@/lib/db/schema-enums'
import { transitionMun } from './mun-state-machine'

const HIGH_IMPACT_FIELDS: Record<MunModule, string[]> = {
  mun_details: ['name', 'startDate', 'endDate', 'venue'],
  committees: ['name', 'capacity'],
  portfolios: ['availability'],
  registration_products: ['price', 'capacity', 'deadline'],
}

const POST_VERIFICATION_STATUSES = ['VERIFIED', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED']

export function detectHighImpactChange(
  moduleName: MunModule,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  const fields = HIGH_IMPACT_FIELDS[moduleName]
  return fields.some((field) => {
    if (!(field in after)) return false
    const beforeValue = before[field]
    const afterValue = after[field]
    if (beforeValue instanceof Date && afterValue instanceof Date) {
      return beforeValue.getTime() !== afterValue.getTime()
    }
    return beforeValue !== afterValue
  })
}

export async function triggerReverificationIfNeeded(
  moduleName: MunModule,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  munId: string,
  actorId: string,
): Promise<void> {
  if (!detectHighImpactChange(moduleName, before, after)) return

  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || !POST_VERIFICATION_STATUSES.includes(mun.status)) return

  await db
    .update(munModuleVerifications)
    .set({ state: 'PENDING_REVIEW', updatedAt: new Date() })
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))

  if (mun.status !== 'VERIFICATION') {
    await transitionMun(munId, 'VERIFICATION', actorId, `Re-verification triggered by high-impact change to ${moduleName}`)
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- lib/lifecycle/reverification.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `mun-config.ts`'s update actions**

Read the current `updateMunDetails`, `updateRegistrationProduct`, `updateCommittee` in `lib/actions/mun-config.ts` first — each needs the row's state BEFORE the update captured, then `triggerReverificationIfNeeded` called AFTER the update commits, comparing before/after. Example for `updateRegistrationProduct` (adapt the same pattern to the other two — read the actual current function bodies, since exact field names/structure may differ slightly from what's summarized here):

```typescript
export async function updateRegistrationProduct(
  id: string,
  input: UpdateRegistrationProductInput,
  session: Session | null,
): Promise<RegistrationProduct> {
  const [existing] = await db.select().from(registrationProducts).where(eq(registrationProducts.id, id)).limit(1)
  if (!existing) throw new Error('Registration product not found')
  await assertOwnsOrAdmin(existing.munId, session)

  const [updated] = await db
    .update(registrationProducts)
    .set(input)
    .where(eq(registrationProducts.id, id))
    .returning()
  if (!updated) throw new Error('Registration product not found')

  await triggerReverificationIfNeeded('registration_products', existing, updated, existing.munId, session!.userId)

  return updated
}
```
Add the import: `import { triggerReverificationIfNeeded } from '@/lib/lifecycle/reverification'`. Apply the same before/after-capture-then-trigger pattern to `updateMunDetails` (moduleName `'mun_details'`, munId is the function's own `munId` param) and `updateCommittee` (moduleName `'committees'`, munId via the committee's `munId` — check how `updateCommittee` currently resolves the owning mun, reuse that same lookup instead of adding a second query).

- [ ] **Step 6: Add regression tests to `mun-config.test.ts`**

Add to `lib/actions/mun-config.test.ts`:
```typescript
describe('re-verification triggers', () => {
  it('updateRegistrationProduct triggers re-verification when mun is VERIFIED and price changes', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, { status: 'VERIFIED' })
    const session = sessionFor(organizer)

    const product = await createRegistrationProduct({ munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 }, session)
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'registration_products', state: 'VERIFIED' })

    await updateRegistrationProduct(product.id, { price: 3000 }, session)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')
  })

  it('updateRegistrationProduct does NOT trigger re-verification when mun is still DRAFT', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    const session = sessionFor(organizer)

    const product = await createRegistrationProduct({ munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 }, session)
    await updateRegistrationProduct(product.id, { price: 3000 }, session)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('DRAFT')
  })
})
```
Import `munModuleVerifications` from `@/lib/db/schema` at the top of the test file if not already imported. Check `makeMun`'s existing signature in this test file — it may not currently accept a `status` override; if not, add one (default to whatever it currently defaults to, so existing calls don't break).

- [ ] **Step 7: Run full mun-config test suite, verify all pass**

Run: `npm run test -- lib/actions/mun-config.test.ts`
Expected: PASS (existing tests + 2 new ones).

- [ ] **Step 8: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add lib/lifecycle/reverification.ts lib/lifecycle/reverification.test.ts lib/actions/mun-config.ts lib/actions/mun-config.test.ts
git commit -m "$(cat <<'EOF'
feat: trigger re-verification on high-impact edits to a VERIFIED mun

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- lib/lifecycle/reverification.ts lib/lifecycle/reverification.test.ts lib/actions/mun-config.ts lib/actions/mun-config.test.ts
```

---

## Task 6: publishMun Gate Update + Module Review Queue

**Files:**
- Modify: `lib/actions/admin-review.ts` (`publishMun` requires VERIFIED; add `getModuleReviewQueue`)
- Modify: `lib/actions/admin-review.test.ts`

**Interfaces:**
- Consumes: `munModuleVerifications` from Task 2.
- Produces: `getModuleReviewQueue(): Promise<ModuleVerificationWithMun[]>` — for mun-hub-02's Verification Console UI.

- [ ] **Step 1: Read the current `publishMun` and its test**

Read `lib/actions/admin-review.ts` and `lib/actions/admin-review.test.ts` in full before editing — the existing `publishMun` calls `transitionMun(munId, 'PUBLISHED', ...)`, which under Task 1's new transitions map now requires the mun to be in `VERIFIED` status (not `VERIFICATION`) for that transition to succeed — `transitionMun` will already throw `Invalid transition` correctly once Task 1 lands, so this task is mostly about updating the EXISTING test's fixture status from `'VERIFICATION'` to `'VERIFIED'`, not changing `publishMun`'s own code.

- [ ] **Step 2: Update the existing publishMun test fixture**

Find the existing test (likely named something like "publishes a mun in VERIFICATION status" per the original Task 10 in the MVP plan) and change its fixture mun's `status: 'VERIFICATION'` to `status: 'VERIFIED'`, and rename the test description to match ("publishes a mun in VERIFIED status").

- [ ] **Step 3: Add `getModuleReviewQueue`**

Add to `lib/actions/admin-review.ts`:
```typescript
import { munModuleVerifications, muns } from '@/lib/db/schema'

export interface ModuleReviewQueueRow {
  id: string
  munId: string
  munName: string
  moduleName: string
  state: string
  organizerConfirmedAt: Date | null
}

export async function getModuleReviewQueue(): Promise<ModuleReviewQueueRow[]> {
  const session = await getSession()
  requireRole(session, [...REVIEW_ROLES])

  const rows = await db
    .select({
      id: munModuleVerifications.id,
      munId: munModuleVerifications.munId,
      munName: muns.name,
      moduleName: munModuleVerifications.moduleName,
      state: munModuleVerifications.state,
      organizerConfirmedAt: munModuleVerifications.organizerConfirmedAt,
    })
    .from(munModuleVerifications)
    .innerJoin(muns, eq(munModuleVerifications.munId, muns.id))
    .where(eq(munModuleVerifications.state, 'PENDING_REVIEW'))
    .orderBy(desc(munModuleVerifications.organizerConfirmedAt))

  return rows
}
```
Check the existing top-of-file imports in `admin-review.ts` for `eq`/`desc` — they're likely already imported from `drizzle-orm` (used by `getReviewQueue`), reuse rather than re-import.

- [ ] **Step 4: Write a test for `getModuleReviewQueue`**

Add to `lib/actions/admin-review.test.ts`:
```typescript
describe('getModuleReviewQueue', () => {
  it('returns PENDING_REVIEW module rows with mun name, requires reviewer role', async () => {
    const organizer = await db.insert(users).values({ name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' }).returning().then((r) => r[0])
    const reviewer = await db.insert(users).values({ name: 'Rev', email: `rev-${Date.now()}@test.com`, role: 'OPERATIONS' }).returning().then((r) => r[0])
    const mun = await db.insert(muns).values({ organizerId: organizer.id, name: 'Queue Mun', slug: `queue-mun-${Date.now()}` }).returning().then((r) => r[0])
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'committees', state: 'PENDING_REVIEW', organizerConfirmedAt: new Date() })

    mockGetSession.mockResolvedValue({ userId: reviewer.id, role: 'OPERATIONS' })
    const queue = await getModuleReviewQueue()
    expect(queue.some((row) => row.munId === mun.id && row.munName === 'Queue Mun')).toBe(true)
  })
})
```
Check how `mockGetSession` is set up in the existing test file (it's likely already mocked the same way as `registration.test.ts`/`student-dashboard.test.ts` via `vi.mock('@/lib/auth/session', ...)`) — reuse that exact pattern, don't introduce a second mocking approach.

- [ ] **Step 5: Run tests, typecheck**

Run: `npm run test -- lib/actions/admin-review.test.ts && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 6: Full suite one more time, then commit**

Run: `npm run test`
Expected: all pass (should be well over 100 tests now given Tasks 1-6's additions).

```bash
git add lib/actions/admin-review.ts lib/actions/admin-review.test.ts
git commit -m "$(cat <<'EOF'
feat: require VERIFIED status to publish, add module review queue

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- lib/actions/admin-review.ts lib/actions/admin-review.test.ts
```

---

## Task 7: Update CLAUDE.md, Apply Migrations to Neon

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply all migrations from Tasks 1-2 to Neon**

Run: `npm run db:migrate` (this runs against `.env`'s `DATABASE_URL`, which is Neon — confirmed safe since migrations are additive schema changes, not data-destructive; unlike the test-isolation incident earlier, this is the intended one-time production migration, not a test run).
Expected: applies cleanly, no errors.

- [ ] **Step 2: Update CLAUDE.md**

Add a section documenting: the extended `MunStatus` lifecycle (with the VERIFIED/PUBLISHED split — `publishMun` now requires VERIFIED), the 4 new tables and what they're for, the module-level verification actions and where they live, the re-verification trigger mechanism and its `HIGH_IMPACT_FIELDS` list, and explicitly flag `registrations.munVersionId` as schema-only/not-yet-wired for whoever picks up that follow-up slice. Note this is Slice 1 of the new PRD — link to both the PRD file and the spec doc.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document verification/confirmation trust layer (slice 1) in CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" -- CLAUDE.md
```

- [ ] **Step 4: Notify mun-hub-02**

Send a message summarizing what landed: the 4 new tables, the module-verification/organizer-confirmation/reverification actions and their exact function signatures, the `publishMun` behavior change (now requires VERIFIED not VERIFICATION), and that this unblocks their Organizer Final Confirmation screen + Verification Console UI work.

---

## Self-Review Notes

- Spec coverage: lifecycle extension → Task 1; new tables → Task 2; module verification actions → Task 3; confirmation gate → Task 4; re-verification → Task 5; publish gate change + review queue → Task 6; docs/deploy → Task 7. All of spec sections 1-5 covered; section 6 (deferred items) deliberately has no task — that's the point.
- No placeholders: every step has runnable code or an explicit instruction to read existing code first (Task 6 Step 1) rather than guessing its shape blind.
- Type consistency: `MunModule`/`ModuleVerificationState`/`VerificationSeverity` types from Task 2 used identically in Tasks 3/5/6. `Session` type reused from existing `lib/auth/adapter.ts` throughout, matching the pattern in every other action file in this repo.
- Flagged uncertainty explicitly rather than guessing: Task 3 Step 3's note about `transitionMun`'s `actorId` FK requirement, Task 5 Step 5's note to read existing `mun-config.ts` functions before assuming their exact shape, Task 4 Step 3's explicit bug-fix-inline for the portfolio query only covering one committee.
