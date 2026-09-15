# Registration Types Extend + Allocation Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `registrationProducts` with the PRD-required fields (description, individual/delegation availability, display order, eligibility) and add real server-enforced committee-capacity and portfolio-uniqueness allocation, closing the gap where committee/portfolio limits are declared in schema but never checked.

**Architecture:** Additive Drizzle schema migration (new nullable/defaulted columns + one partial unique index), extend the existing `.for('update')` row-lock pattern in `initiateRegistration` to also lock the target committee, add a new `lib/actions/allocation.ts` for organizer-driven assign/reassign/unassign, wire the existing (currently read-only) `registrations` organizer page to call it, and rename the "Registration Products" UI label to "Registration Types" without touching the underlying route segment or module keys.

**Tech Stack:** Next.js App Router, Drizzle ORM + Postgres (Neon prod / local Docker for tests), Vitest, existing shadcn/ui + Tailwind components.

**Spec:** `docs/superpowers/specs/2026-09-15-registration-types-allocation-design.md`

## Global Constraints

- Never trust client-supplied capacity, price, or ownership — every check happens server-side inside `lib/actions/*`, reusing `assertOwnsOrAdmin` (`lib/auth/ownership.ts`). Do not re-implement it per entity.
- Every mutation that changes committee/portfolio assignment must call `recordAdminAction(tx, ...)` (`lib/audit/log.ts`) **inside the same transaction** as the state change, not after commit.
- New `adminActionEnum` values require a `drizzle-kit generate` migration using `ALTER TYPE ... ADD VALUE`, and per this repo's Postgres-version constraint, an `ADD VALUE` migration must be in its own file, never combined with an `UPDATE`/backfill in the same file.
- Do not rename the `/products` route segment, the `REGISTRATION_TYPES`/`PRICING_CAPACITY` module keys, or any existing exported function/type name — only the human-facing label changes.
- Refund logic, waitlist-on-full, delegation fields' UI, and CSV export are explicitly out of scope for this slice (see spec's "Out of scope" section) — do not add them even if convenient.
- Run `npm run db:generate` after schema.ts edits, inspect the generated SQL before applying, then `npm run db:migrate`. Never hand-write a migration file for a column addition; only the two enum-only migrations in Task 5 are hand-written, matching the existing `drizzle/0016_add_mun_changes_requested_action.sql` style (a single `ALTER TYPE` statement, no transaction wrapper needed for a single statement).
- Tests run against local Docker Postgres via `.env.test` — never against `.env`'s Neon URL. Use `npm test` (vitest run).

---

### Task 1: Extend `registrationProducts` schema + backfill migration

**Files:**
- Modify: `lib/db/schema.ts:214-234` (the `registrationProducts` table definition)
- Create: `drizzle/00XX_<generated-name>.sql` (via `db:generate`, do not hand-write)
- Test: `lib/actions/mun-config.test.ts` (create if it doesn't exist — check first with `ls lib/actions/mun-config.test.ts`)

**Interfaces:**
- Produces: `registrationProducts` gains columns `description: text | null`, `allowsIndividual: boolean` (default `true`), `allowsDelegation: boolean` (default `false`), `displayOrder: integer` (default `0`), `eligibility: unknown | null` (jsonb). The exported `RegistrationProduct` type (`lib/types/mun.ts:15`, `InferSelectModel<typeof registrationProducts>`) picks these up automatically — no manual type edit needed.

- [ ] **Step 1: Add the new columns to the schema**

Edit `lib/db/schema.ts`. Find the `registrationProducts` table (starts at line 214) and add the new columns after `registrationType`:

```ts
export const registrationProducts = pgTable(
  'registration_products',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    currency: text('currency').notNull().default('INR'),
    capacity: integer('capacity').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    // PRD Section 43 Phase 2 columns (Task 3, 2026-09-14).
    registrationType: text('registration_type'),
    earlyBirdPrice: integer('early_bird_price'),
    earlyBirdDeadline: timestamp('early_bird_deadline', { withTimezone: true }),
    // Registration Types PRD (Slice 1, 2026-09-15) — see
    // docs/superpowers/specs/2026-09-15-registration-types-allocation-design.md.
    description: text('description'),
    allowsIndividual: boolean('allows_individual').notNull().default(true),
    allowsDelegation: boolean('allows_delegation').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    eligibility: jsonb('eligibility'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('registration_products_mun_id_idx').on(table.munId)],
)
```

`boolean` and `jsonb` are already imported at the top of `schema.ts` (used elsewhere, e.g. `portfoliosEnabled`, `formResponses`) — verify with `grep -n "^import" lib/db/schema.ts` before assuming; if either is missing from the `drizzle-orm/pg-core` import line, add it there.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/`, e.g. `drizzle/0017_<random-name>.sql`, containing 5 `ALTER TABLE "registration_products" ADD COLUMN ...` statements. Read the generated file to confirm it matches — no `DROP` or data-destructive statements.

- [ ] **Step 3: Apply the migration to local Docker Postgres**

Run: `npm run db:up` (if not already running), then `npm run db:migrate`
Expected: migration applies with no errors.

- [ ] **Step 4: Write a backfill migration for existing `registrationType` values**

Existing rows have `registrationType = NULL`. Create `drizzle/00XX_backfill_registration_type.sql` by hand (this one is a data backfill, not a schema change, so `db:generate` won't produce it):

```sql
UPDATE "registration_products" SET "registration_type" = 'DELEGATE' WHERE "registration_type" IS NULL;
```

Run: `npm run db:migrate` again to apply it. Expected: no errors. Note this migration is idempotent (safe to re-run — `WHERE registration_type IS NULL` matches nothing on a second run).

- [ ] **Step 5: Write a test confirming the new columns default correctly**

Check first whether `lib/actions/mun-config.test.ts` exists: run `ls lib/actions/mun-config.test.ts`. If it does not exist, create it with this header (matching the fixture style in `lib/actions/registration.test.ts`):

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createRegistrationProduct } from './mun-config'

async function createUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email: `user-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

async function createMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Types Mun', slug: `types-mun-${Date.now()}-${Math.random()}` })
    .returning()
  return mun
}

describe('createRegistrationProduct — Slice 1 fields', () => {
  it('defaults allowsIndividual to true and allowsDelegation to false', async () => {
    const organizer = await createUser('ORGANIZER')
    const mun = await createMun(organizer.id)

    const product = await createRegistrationProduct(
      { munId: mun.id, name: 'Delegate', price: 1500, capacity: 100 },
      { userId: organizer.id, role: 'ORGANIZER' },
    )

    expect(product.allowsIndividual).toBe(true)
    expect(product.allowsDelegation).toBe(false)
    expect(product.displayOrder).toBe(0)
    expect(product.description).toBeNull()
  })
})
```

Append this `describe` block if the file already exists instead of creating a new file.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/actions/mun-config.test.ts -t "Slice 1 fields"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle/ lib/actions/mun-config.test.ts
git commit -m "feat(db): extend registrationProducts with description, allowsIndividual, allowsDelegation, displayOrder, eligibility"
```

---

### Task 2: Extend `CreateRegistrationProductInput`/`UpdateRegistrationProductInput` and the two `lib/actions/mun-config.ts` functions

**Files:**
- Modify: `lib/actions/mun-config.ts:211-233` (`CreateRegistrationProductInput`, `createRegistrationProduct`)
- Modify: `lib/actions/mun-config.ts:255-296` (`UpdateRegistrationProductInput`, `updateRegistrationProduct`)
- Test: `lib/actions/mun-config.test.ts` (extend the file from Task 1)

**Interfaces:**
- Consumes: `registrationProducts` schema from Task 1 (columns `description`, `allowsIndividual`, `allowsDelegation`, `displayOrder`, `eligibility`).
- Produces: `createRegistrationProduct(input, session)` and `updateRegistrationProduct(id, input, session)` accept the 5 new optional fields; both continue returning the full `RegistrationProduct` row, now including the new columns.

- [ ] **Step 1: Write the failing test for create with new fields**

Add to `lib/actions/mun-config.test.ts`:

```ts
describe('createRegistrationProduct — new field passthrough', () => {
  it('persists description, allowsIndividual, allowsDelegation, displayOrder, eligibility', async () => {
    const organizer = await createUser('ORGANIZER')
    const mun = await createMun(organizer.id)

    const product = await createRegistrationProduct(
      {
        munId: mun.id,
        name: 'Reporter Pass',
        price: 1000,
        capacity: 20,
        description: 'For press and media delegates.',
        allowsIndividual: true,
        allowsDelegation: false,
        displayOrder: 2,
        eligibility: { minAge: 16 },
      },
      { userId: organizer.id, role: 'ORGANIZER' },
    )

    expect(product.description).toBe('For press and media delegates.')
    expect(product.allowsDelegation).toBe(false)
    expect(product.displayOrder).toBe(2)
    expect(product.eligibility).toEqual({ minAge: 16 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/actions/mun-config.test.ts -t "new field passthrough"`
Expected: FAIL — `createRegistrationProduct`'s input type doesn't accept these fields yet (TypeScript error) or they're silently dropped.

- [ ] **Step 3: Extend the input types and pass fields through**

In `lib/actions/mun-config.ts`, update `CreateRegistrationProductInput` (line 211):

```ts
export interface CreateRegistrationProductInput {
  munId: string
  name: string
  price: number
  capacity: number
  currency?: string
  deadline?: Date
  description?: string
  allowsIndividual?: boolean
  allowsDelegation?: boolean
  displayOrder?: number
  eligibility?: Record<string, unknown>
}
```

`createRegistrationProduct` (line 220) already does `db.insert(registrationProducts).values(input).returning()` — no other change needed there since Drizzle's `.values()` accepts a superset of columns and unlisted fields use their schema defaults.

Update `UpdateRegistrationProductInput` (line 255):

```ts
export interface UpdateRegistrationProductInput {
  name?: string
  price?: number
  capacity?: number
  currency?: string
  deadline?: Date | null
  status?: string
  description?: string
  allowsIndividual?: boolean
  allowsDelegation?: boolean
  displayOrder?: number
  eligibility?: Record<string, unknown>
}
```

`updateRegistrationProduct` (line 264) already spreads `input` into `.set(input)` — no other code change needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/actions/mun-config.test.ts -t "new field passthrough"`
Expected: PASS.

- [ ] **Step 5: Verify `HIGH_IMPACT_FIELDS` doesn't need updating for these fields**

Read `lib/lifecycle/reverification.ts` and find the `REGISTRATION_TYPES` entry in `HIGH_IMPACT_FIELDS`. It currently lists `['name', 'registrationType', 'status']` per the audit. These 5 new fields (`description`, `allowsIndividual`, `allowsDelegation`, `displayOrder`, `eligibility`) are cosmetic/configuration, not the kind of change that should force re-verification on an already-verified mun — do not add them to `HIGH_IMPACT_FIELDS`. Confirm this by reading the file; no code change in this step, just verification that the design intent (only `name`/`registrationType`/`status` trigger re-verification) still holds.

- [ ] **Step 6: Run the full mun-config test suite**

Run: `npx vitest run lib/actions/mun-config.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/mun-config.ts lib/actions/mun-config.test.ts
git commit -m "feat: accept description/allowsIndividual/allowsDelegation/displayOrder/eligibility on registration product create/update"
```

---

### Task 3: Add `adminActionEnum` values for allocation actions

**Files:**
- Modify: `lib/db/schema-enums.ts:121-164` (`adminActionEnum`)
- Create: 6 hand-written migration files under `drizzle/` (one per enum value, per the Postgres `ADD VALUE` isolation rule)

**Interfaces:**
- Produces: `AdminAction` type (`lib/db/schema-enums.ts:300`) gains `'COMMITTEE_ASSIGNED' | 'COMMITTEE_REASSIGNED' | 'COMMITTEE_UNASSIGNED' | 'PORTFOLIO_ASSIGNED' | 'PORTFOLIO_REASSIGNED' | 'PORTFOLIO_UNASSIGNED'`, consumed by Task 4's `recordAdminAction` calls.

- [ ] **Step 1: Add the 6 new values to the enum definition**

Edit `lib/db/schema-enums.ts`, inside `adminActionEnum` (starts line 121), add before the closing `])`:

```ts
export const adminActionEnum = pgEnum('admin_action', [
  'ORGANIZER_SUSPENDED',
  'ORGANIZER_REINSTATED',
  'MUN_UNPUBLISHED',
  'MUN_SUSPENDED',
  'TICKET_ASSIGNED',
  'TICKET_RESOLVED',
  'USER_SUSPENDED',
  'MODULE_REQUIREMENT_CHANGED',
  'MUN_PUBLISHED',
  'MUN_APPROVED',
  'MUN_REJECTED',
  'MUN_CHANGES_REQUESTED',
  'MODULE_REVIEWED',
  'PAYMENT_DETAILS_CHANGED',
  // Registration Types + Allocation (Slice 1, 2026-09-15) — committee/
  // portfolio assignment mutations in lib/actions/allocation.ts. See
  // docs/superpowers/specs/2026-09-15-registration-types-allocation-design.md.
  'COMMITTEE_ASSIGNED',
  'COMMITTEE_REASSIGNED',
  'COMMITTEE_UNASSIGNED',
  'PORTFOLIO_ASSIGNED',
  'PORTFOLIO_REASSIGNED',
  'PORTFOLIO_UNASSIGNED',
])
```

(Keep every existing value and its comments exactly as-is — only appending.)

- [ ] **Step 2: Generate the migration and verify it's `ADD VALUE`-only**

Run: `npm run db:generate`
Expected: one new file, e.g. `drizzle/0018_<name>.sql`, containing 6 `ALTER TYPE "public"."admin_action" ADD VALUE '...'` statements — one per line, matching the style of `drizzle/0016_add_mun_changes_requested_action.sql`.

- [ ] **Step 3: Split into 6 separate migration files if drizzle-kit generated them as one file**

Postgres requires each `ADD VALUE` to commit before it can be used, and this repo's convention (per CLAUDE.md) is one `ADD VALUE` per migration file when multiple values are added at once, to avoid a "unsafe use of new value" error if a later step in the same transaction tries to reference it. Read the generated file:

Run: `cat drizzle/0018_*.sql`

If it contains all 6 `ALTER TYPE ... ADD VALUE` statements in one file, split it into 6 files named `drizzle/0018_add_committee_assigned_action.sql` through `drizzle/0023_add_portfolio_unassigned_action.sql`, each containing exactly one statement, in the same order. Delete the original combined file. Update `drizzle/meta/_journal.json` — check how `db:generate` structures journal entries by reading it first (`cat drizzle/meta/_journal.json | tail -20`) and add one journal entry per split file, incrementing the `idx` field, matching the existing entries' shape exactly.

- [ ] **Step 4: Apply the migrations**

Run: `npm run db:migrate`
Expected: all 6 apply without error, in order.

- [ ] **Step 5: Verify the enum values exist in the database**

Run: `docker compose exec -T db psql -U postgres -d munhub -c "SELECT unnest(enum_range(NULL::admin_action));"` (adjust user/db name if `docker-compose.yml` differs — check with `cat docker-compose.yml` first).
Expected: output includes all 6 new values.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema-enums.ts drizzle/
git commit -m "feat(db): add COMMITTEE_/PORTFOLIO_ASSIGNED/REASSIGNED/UNASSIGNED admin action enum values"
```

---

### Task 4: Add committee capacity row-lock to `initiateRegistration`

**Files:**
- Modify: `lib/actions/registration.ts:1-192` (imports + `initiateRegistration`)
- Test: `lib/actions/registration.test.ts` (extend)

**Interfaces:**
- Consumes: `committees` table (`lib/db/schema.ts:158-175`, columns `id`, `capacity`, `munId`), `registrations.committeeId`.
- Produces: `initiateRegistration` now throws `Error('Committee is at capacity')` when the target committee is full. No signature change — `RegistrationInput.committeeId` already exists (`lib/types/registration.ts:22`).

- [ ] **Step 1: Write the failing capacity test**

Add to `lib/actions/registration.test.ts` (after the existing accommodation-capacity test block — check the file for where accommodation tests end, likely after line ~230 based on the audit's mention of a `describe` block around line 206):

```ts
describe('committee capacity enforcement', () => {
  async function createCommittee(munId: string, capacity: number) {
    const { committees } = await import('@/lib/db/schema')
    const [committee] = await db.insert(committees).values({ munId, name: 'UNGA', capacity }).returning()
    return committee
  }

  it('rejects registration when the selected committee is full', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const otherStudent = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const committee = await createCommittee(mun.id, 1)

    await db.insert(registrations).values({
      userId: otherStudent.id,
      munId: mun.id,
      registrationProductId: product.id,
      committeeId: committee.id,
      status: 'CONFIRMED',
    })

    await expect(
      initiateRegistration(
        { munId: mun.id, registrationProductId: product.id, committeeId: committee.id },
        { userId: student.id, role: 'STUDENT' },
      ),
    ).rejects.toThrow('Committee is at capacity')
  })

  it('never oversells a committee under concurrent registrations', async () => {
    const organizer = await createUser('ORGANIZER')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 20)
    const committee = await createCommittee(mun.id, 3)

    const students = await Promise.all(Array.from({ length: 10 }, () => createUser('STUDENT')))

    const results = await Promise.allSettled(
      students.map((student) =>
        initiateRegistration(
          { munId: mun.id, registrationProductId: product.id, committeeId: committee.id },
          { userId: student.id, role: 'STUDENT' },
        ),
      ),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled')
    expect(succeeded.length).toBe(3)

    const activeForCommittee = await db
      .select()
      .from(registrations)
      .where(eq(registrations.committeeId, committee.id))
    const active = activeForCommittee.filter((r) =>
      ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'].includes(r.status),
    )
    expect(active.length).toBe(3)
  })

  it('allows registration with no committee selected regardless of committee capacity', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)

    const result = await initiateRegistration(
      { munId: mun.id, registrationProductId: product.id },
      { userId: student.id, role: 'STUDENT' },
    )
    expect(result.registrationId).toBeTruthy()
  })
})
```

Add `committees` to the top-level import from `@/lib/db/schema` at line 3 instead of the dynamic `import()` inside the helper — replace `const { committees } = await import('@/lib/db/schema')` with a static import at the top of the test file:

```ts
import { accommodationOptions, committees, muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/registration.test.ts -t "committee capacity"`
Expected: FAIL — `initiateRegistration` doesn't check committee capacity yet, so the "full" test doesn't throw and the concurrent test oversells.

- [ ] **Step 3: Add the committee row-lock and capacity check**

In `lib/actions/registration.ts`, add `committees` to the import at line 3:

```ts
import { accommodationOptions, committees, muns, payments, registrationProducts, registrations } from '@/lib/db/schema'
```

Inside the transaction in `initiateRegistration` (after the accommodation block, which ends around line 150, and before the `db.insert(registrations)` call at line 152), add:

```ts
    // Committee selection is optional (same as accommodation above). When
    // selected, its capacity gets the exact same row-lock protection as the
    // registration product and accommodation option — a committee filling up
    // is the same overbooking risk, serialized in the same transaction.
    if (input.committeeId) {
      const [committee] = await tx
        .select()
        .from(committees)
        .where(eq(committees.id, input.committeeId))
        .for('update')
        .limit(1)

      if (!committee) {
        throw new Error('Committee not found')
      }
      if (committee.munId !== input.munId) {
        throw new Error('Committee does not belong to this mun')
      }

      const activeCommitteeSelections = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(
          and(
            eq(registrations.committeeId, input.committeeId),
            inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
          ),
        )

      if (activeCommitteeSelections.length >= committee.capacity) {
        throw new Error('Committee is at capacity')
      }
    }
```

Place this block right before the `const [created] = await tx.insert(registrations)...` line (currently line 152) so it runs after the accommodation check but before the insert — matching the existing left-to-right ordering of capacity checks (product, then accommodation, then committee).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/registration.test.ts -t "committee capacity"`
Expected: PASS, all 3 new tests.

- [ ] **Step 5: Run the full registration test suite to confirm no regression**

Run: `npx vitest run lib/actions/registration.test.ts`
Expected: all tests PASS, including the pre-existing product-capacity and accommodation-capacity concurrency tests.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/registration.ts lib/actions/registration.test.ts
git commit -m "fix: enforce committee capacity in initiateRegistration with row-lock, closing the declared-but-unenforced gap"
```

---

### Task 5: Add the portfolio-uniqueness partial unique index

**Files:**
- Modify: `lib/db/schema.ts:245-280` (the `registrations` table's index array)
- Create: `drizzle/00XX_<generated-name>.sql`
- Test: `lib/actions/registration.test.ts` (extend)

**Interfaces:**
- Produces: a partial unique index `registrations_portfolio_unique_active` on `registrations(portfolio_id)` filtered to `portfolio_id IS NOT NULL AND status IN ('PENDING','PAYMENT_PENDING','CONFIRMED')`. Any insert/update violating it raises a Postgres `23505` error, to be caught in Task 6's `assignPortfolio`.

- [ ] **Step 1: Find the current index array for `registrations`**

Run: `grep -n "registrations_" lib/db/schema.ts` to find the existing index definitions (e.g. `registrations_mun_id_status_idx`, `registrations_user_id_idx`) and their exact syntax in the `pgTable` third argument.

- [ ] **Step 2: Add the partial unique index**

Using the same `pgTable(..., (table) => [...])` array syntax found in Step 1, add a new entry using drizzle-orm's `uniqueIndex` with a `.where()` clause. First check the import line at the top of `schema.ts` for `uniqueIndex` — if not imported, add it to the `drizzle-orm/pg-core` import:

```ts
import { uniqueIndex } from 'drizzle-orm/pg-core'
```

Add to the `registrations` table's index array (alongside the existing indexes):

```ts
uniqueIndex('registrations_portfolio_unique_active')
  .on(table.portfolioId)
  .where(sql`${table.portfolioId} IS NOT NULL AND ${table.status} IN ('PENDING', 'PAYMENT_PENDING', 'CONFIRMED')`),
```

Verify `sql` is imported from `drizzle-orm` at the top of the file (it's used elsewhere for jsonb/enum handling — confirm with `grep -n "^import.*sql" lib/db/schema.ts`; add `import { sql } from 'drizzle-orm'` if missing, being careful not to duplicate an existing `drizzle-orm` import line — merge into it instead).

- [ ] **Step 3: Generate and review the migration**

Run: `npm run db:generate`
Expected: new file with a `CREATE UNIQUE INDEX ... WHERE ...` statement. Read it to confirm the `WHERE` clause matches exactly.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: applies cleanly — this will fail if any existing seeded data already has two active registrations sharing a portfolio. If it fails, run this query first to find and manually resolve conflicts before retrying: `SELECT portfolio_id, count(*) FROM registrations WHERE portfolio_id IS NOT NULL AND status IN ('PENDING','PAYMENT_PENDING','CONFIRMED') GROUP BY portfolio_id HAVING count(*) > 1;` — report any conflicts found rather than silently deleting rows.

- [ ] **Step 5: Write a test confirming the constraint**

Add to `lib/actions/registration.test.ts`:

```ts
describe('portfolio uniqueness constraint', () => {
  it('rejects a second active registration for the same portfolio at the DB level', async () => {
    const { committees, portfolios } = await import('@/lib/db/schema')
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const [committee] = await db.insert(committees).values({ munId: mun.id, name: 'UNGA', capacity: 10 }).returning()
    const [portfolio] = await db
      .insert(portfolios)
      .values({ committeeId: committee.id, name: 'India' })
      .returning()

    await db.insert(registrations).values({
      userId: studentA.id,
      munId: mun.id,
      registrationProductId: product.id,
      portfolioId: portfolio.id,
      status: 'CONFIRMED',
    })

    await expect(
      db.insert(registrations).values({
        userId: studentB.id,
        munId: mun.id,
        registrationProductId: product.id,
        portfolioId: portfolio.id,
        status: 'CONFIRMED',
      }),
    ).rejects.toThrow()
  })

  it('allows a cancelled registration to free the portfolio for a new active registration', async () => {
    const { committees, portfolios } = await import('@/lib/db/schema')
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const [committee] = await db.insert(committees).values({ munId: mun.id, name: 'UNGA', capacity: 10 }).returning()
    const [portfolio] = await db
      .insert(portfolios)
      .values({ committeeId: committee.id, name: 'France' })
      .returning()

    await db.insert(registrations).values({
      userId: studentA.id,
      munId: mun.id,
      registrationProductId: product.id,
      portfolioId: portfolio.id,
      status: 'CANCELLED',
    })

    await expect(
      db.insert(registrations).values({
        userId: studentB.id,
        munId: mun.id,
        registrationProductId: product.id,
        portfolioId: portfolio.id,
        status: 'CONFIRMED',
      }),
    ).resolves.toBeDefined()
  })
})
```

Move the `committees`/`portfolios` imports to the static top-level import (same as Task 4 Step 1) instead of dynamic `import()` — by this point the test file's top import line should read:

```ts
import { accommodationOptions, committees, muns, payments, portfolios, registrationProducts, registrations, users } from '@/lib/db/schema'
```

and remove the two `const { committees, portfolios } = await import(...)` lines from inside the test bodies above, since they're now statically imported.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/actions/registration.test.ts -t "portfolio uniqueness"`
Expected: PASS, both tests.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle/ lib/actions/registration.test.ts
git commit -m "feat(db): add partial unique index preventing duplicate active portfolio assignments"
```

---

### Task 6: Create `lib/actions/allocation.ts` — assign/reassign/unassign committee and portfolio

**Files:**
- Create: `lib/actions/allocation.ts`
- Test: `lib/actions/allocation.test.ts`

**Interfaces:**
- Consumes: `assertOwnsOrAdmin` (`lib/auth/ownership.ts`), `recordAdminAction` (`lib/audit/log.ts`), `Session` (`lib/auth/adapter.ts`), `registrations`/`committees`/`portfolios` schema.
- Produces: `assignCommittee(registrationId, committeeId, session)`, `unassignCommittee(registrationId, session)`, `bulkAssignCommittee(registrationIds, committeeId, session)`, `assignPortfolio(registrationId, portfolioId, session)`, `unassignPortfolio(registrationId, session)`, `bulkAssignPortfolio(assignments, session)` — each returns `Promise<{ id: string }>` (single) or `Promise<{ succeeded: string[]; failed: Array<{ id: string; error: string }> }>` (bulk). These are called by Task 7's route-local `actions.ts` wrapper.

- [ ] **Step 1: Write the failing test for `assignCommittee`**

Create `lib/actions/allocation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, portfolios, registrationProducts, registrations, users } from '@/lib/db/schema'
import { assignCommittee } from './allocation'

async function createUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email: `user-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

async function createMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Allocation Mun', slug: `alloc-mun-${Date.now()}-${Math.random()}` })
    .returning()
  return mun
}

async function createProduct(munId: string) {
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId, name: 'Delegate', price: 1500, capacity: 100 })
    .returning()
  return product
}

async function createCommittee(munId: string, capacity: number) {
  const [committee] = await db.insert(committees).values({ munId, name: 'UNGA', capacity }).returning()
  return committee
}

async function createRegistration(userId: string, munId: string, registrationProductId: string) {
  const [registration] = await db
    .insert(registrations)
    .values({ userId, munId, registrationProductId, status: 'CONFIRMED' })
    .returning()
  return registration
}

describe('assignCommittee', () => {
  it('assigns a committee to a registration when the organizer owns the mun', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 10)
    const registration = await createRegistration(student.id, mun.id, product.id)

    const result = await assignCommittee(registration.id, committee.id, {
      userId: organizer.id,
      role: 'ORGANIZER',
    })

    expect(result.id).toBe(registration.id)

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id)).limit(1)
    expect(updated?.committeeId).toBe(committee.id)
  })

  it('rejects assignment when the committee is at capacity', async () => {
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 1)
    const registrationA = await createRegistration(studentA.id, mun.id, product.id)
    const registrationB = await createRegistration(studentB.id, mun.id, product.id)

    await assignCommittee(registrationA.id, committee.id, { userId: organizer.id, role: 'ORGANIZER' })

    await expect(
      assignCommittee(registrationB.id, committee.id, { userId: organizer.id, role: 'ORGANIZER' }),
    ).rejects.toThrow('Committee is at capacity')
  })

  it('rejects a different organizer from assigning committees on another organizer\'s mun', async () => {
    const organizerA = await createUser('ORGANIZER')
    const organizerB = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizerA.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 10)
    const registration = await createRegistration(student.id, mun.id, product.id)

    await expect(
      assignCommittee(registration.id, committee.id, { userId: organizerB.id, role: 'ORGANIZER' }),
    ).rejects.toThrow('Forbidden')
  })

  it('allows reassigning a registration already in a different committee', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committeeA = await createCommittee(mun.id, 10)
    const committeeB = await createCommittee(mun.id, 10)
    const registration = await createRegistration(student.id, mun.id, product.id)

    await assignCommittee(registration.id, committeeA.id, { userId: organizer.id, role: 'ORGANIZER' })
    await assignCommittee(registration.id, committeeB.id, { userId: organizer.id, role: 'ORGANIZER' })

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id)).limit(1)
    expect(updated?.committeeId).toBe(committeeB.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/actions/allocation.test.ts`
Expected: FAIL — `./allocation` module doesn't exist.

- [ ] **Step 3: Implement `lib/actions/allocation.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, portfolios, registrations } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { recordAdminAction } from '@/lib/audit/log'

const ACTIVE_REGISTRATION_STATUSES = ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'] as const

/** Resolves a registration's munId, or throws `Error('Registration not found')`. */
async function getMunIdForRegistration(registrationId: string): Promise<string> {
  const [registration] = await db
    .select({ munId: registrations.munId })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1)
  if (!registration) throw new Error('Registration not found')
  return registration.munId
}

/**
 * Assigns (or reassigns) a registration to a committee, row-locking the
 * committee for the duration of the check so concurrent assignments to the
 * same committee serialize the same way `initiateRegistration`'s signup-time
 * check does (lib/actions/registration.ts). Reassignment (a registration
 * that already has a different committeeId) is allowed — moving OUT of the
 * old committee happens implicitly via the UPDATE, no separate unassign
 * step required.
 */
export async function assignCommittee(
  registrationId: string,
  committeeId: string,
  session: Session | null,
): Promise<{ id: string }> {
  const munId = await getMunIdForRegistration(registrationId)
  await assertOwnsOrAdmin(munId, session)

  await db.transaction(async (tx) => {
    const [committee] = await tx
      .select()
      .from(committees)
      .where(eq(committees.id, committeeId))
      .for('update')
      .limit(1)
    if (!committee) throw new Error('Committee not found')
    if (committee.munId !== munId) throw new Error('Committee does not belong to this mun')

    const activeInCommittee = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.committeeId, committeeId),
          inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
        ),
      )

    const alreadyInThisCommittee = activeInCommittee.some((r) => r.id === registrationId)
    if (!alreadyInThisCommittee && activeInCommittee.length >= committee.capacity) {
      throw new Error('Committee is at capacity')
    }

    const [existing] = await tx
      .select({ committeeId: registrations.committeeId })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .limit(1)
    if (!existing) throw new Error('Registration not found')

    await tx.update(registrations).set({ committeeId, updatedAt: new Date() }).where(eq(registrations.id, registrationId))

    const action = existing.committeeId ? 'COMMITTEE_REASSIGNED' : 'COMMITTEE_ASSIGNED'
    await recordAdminAction(tx, session!.userId, action, 'registration', registrationId, undefined, {
      committeeId,
      previousCommitteeId: existing.committeeId,
    })
  })

  return { id: registrationId }
}

/** Clears a registration's committee assignment, freeing its capacity slot. */
export async function unassignCommittee(registrationId: string, session: Session | null): Promise<{ id: string }> {
  const munId = await getMunIdForRegistration(registrationId)
  await assertOwnsOrAdmin(munId, session)

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ committeeId: registrations.committeeId })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .limit(1)
    if (!existing) throw new Error('Registration not found')

    await tx.update(registrations).set({ committeeId: null, updatedAt: new Date() }).where(eq(registrations.id, registrationId))

    await recordAdminAction(tx, session!.userId, 'COMMITTEE_UNASSIGNED', 'registration', registrationId, undefined, {
      previousCommitteeId: existing.committeeId,
    })
  })

  return { id: registrationId }
}

export interface BulkAssignResult {
  succeeded: string[]
  failed: Array<{ id: string; error: string }>
}

/**
 * Best-effort bulk committee assignment: each registration is attempted
 * independently (its own transaction via `assignCommittee`), so one failure
 * (e.g. capacity reached partway through the batch) doesn't roll back
 * assignments that already succeeded. This is a deliberate choice over
 * all-or-nothing — PRD § 13 warns against "destructive partial imports" for
 * CSV import specifically, but for an organizer manually bulk-selecting rows
 * to assign, a partial success with a clear per-row report is more useful
 * than losing every successful assignment because the batch's last row hit a
 * capacity wall. The caller (route-local action) surfaces `failed` to the UI.
 */
export async function bulkAssignCommittee(
  registrationIds: string[],
  committeeId: string,
  session: Session | null,
): Promise<BulkAssignResult> {
  const succeeded: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const registrationId of registrationIds) {
    try {
      await assignCommittee(registrationId, committeeId, session)
      succeeded.push(registrationId)
    } catch (error) {
      failed.push({ id: registrationId, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  return { succeeded, failed }
}

/**
 * Assigns a portfolio. Uniqueness is enforced by the DB partial unique index
 * (`registrations_portfolio_unique_active`) — a duplicate active assignment
 * raises Postgres error code 23505, translated here into a readable message
 * the same way `lib/actions/registration-form.ts` translates its own unique
 * violations.
 */
export async function assignPortfolio(
  registrationId: string,
  portfolioId: string,
  session: Session | null,
): Promise<{ id: string }> {
  const munId = await getMunIdForRegistration(registrationId)
  await assertOwnsOrAdmin(munId, session)

  const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).limit(1)
  if (!portfolio) throw new Error('Portfolio not found')

  const [committee] = await db.select({ munId: committees.munId }).from(committees).where(eq(committees.id, portfolio.committeeId)).limit(1)
  if (!committee || committee.munId !== munId) throw new Error('Portfolio does not belong to this mun')

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ portfolioId: registrations.portfolioId })
        .from(registrations)
        .where(eq(registrations.id, registrationId))
        .limit(1)
      if (!existing) throw new Error('Registration not found')

      await tx.update(registrations).set({ portfolioId, updatedAt: new Date() }).where(eq(registrations.id, registrationId))

      const action = existing.portfolioId ? 'PORTFOLIO_REASSIGNED' : 'PORTFOLIO_ASSIGNED'
      await recordAdminAction(tx, session!.userId, action, 'registration', registrationId, undefined, {
        portfolioId,
        previousPortfolioId: existing.portfolioId,
      })
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      throw new Error('This portfolio is already assigned to another active registration')
    }
    throw error
  }

  return { id: registrationId }
}

/** Clears a registration's portfolio assignment. */
export async function unassignPortfolio(registrationId: string, session: Session | null): Promise<{ id: string }> {
  const munId = await getMunIdForRegistration(registrationId)
  await assertOwnsOrAdmin(munId, session)

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ portfolioId: registrations.portfolioId })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .limit(1)
    if (!existing) throw new Error('Registration not found')

    await tx.update(registrations).set({ portfolioId: null, updatedAt: new Date() }).where(eq(registrations.id, registrationId))

    await recordAdminAction(tx, session!.userId, 'PORTFOLIO_UNASSIGNED', 'registration', registrationId, undefined, {
      previousPortfolioId: existing.portfolioId,
    })
  })

  return { id: registrationId }
}

/** Best-effort bulk portfolio assignment — same reasoning as `bulkAssignCommittee`. */
export async function bulkAssignPortfolio(
  assignments: Array<{ registrationId: string; portfolioId: string }>,
  session: Session | null,
): Promise<BulkAssignResult> {
  const succeeded: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const { registrationId, portfolioId } of assignments) {
    try {
      await assignPortfolio(registrationId, portfolioId, session)
      succeeded.push(registrationId)
    } catch (error) {
      failed.push({ id: registrationId, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  return { succeeded, failed }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/allocation.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Add tests for unassign, bulk operations, and portfolio assignment**

Append to `lib/actions/allocation.test.ts`:

```ts
import { assignPortfolio, bulkAssignCommittee, bulkAssignPortfolio, unassignCommittee, unassignPortfolio } from './allocation'

async function createPortfolio(committeeId: string) {
  const { portfolios } = await import('@/lib/db/schema')
  const [portfolio] = await db.insert(portfolios).values({ committeeId, name: 'India' }).returning()
  return portfolio
}

describe('unassignCommittee', () => {
  it('clears the committee assignment', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 10)
    const registration = await createRegistration(student.id, mun.id, product.id)

    await assignCommittee(registration.id, committee.id, { userId: organizer.id, role: 'ORGANIZER' })
    await unassignCommittee(registration.id, { userId: organizer.id, role: 'ORGANIZER' })

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id)).limit(1)
    expect(updated?.committeeId).toBeNull()
  })
})

describe('bulkAssignCommittee', () => {
  it('reports per-row success and failure without losing successful assignments', async () => {
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 1)
    const registrationA = await createRegistration(studentA.id, mun.id, product.id)
    const registrationB = await createRegistration(studentB.id, mun.id, product.id)

    const result = await bulkAssignCommittee(
      [registrationA.id, registrationB.id],
      committee.id,
      { userId: organizer.id, role: 'ORGANIZER' },
    )

    expect(result.succeeded).toEqual([registrationA.id])
    expect(result.failed).toEqual([{ id: registrationB.id, error: 'Committee is at capacity' }])
  })
})

describe('assignPortfolio / unassignPortfolio', () => {
  it('assigns a portfolio and rejects a duplicate active assignment', async () => {
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 10)
    const portfolio = await createPortfolio(committee.id)
    const registrationA = await createRegistration(studentA.id, mun.id, product.id)
    const registrationB = await createRegistration(studentB.id, mun.id, product.id)

    await assignPortfolio(registrationA.id, portfolio.id, { userId: organizer.id, role: 'ORGANIZER' })

    await expect(
      assignPortfolio(registrationB.id, portfolio.id, { userId: organizer.id, role: 'ORGANIZER' }),
    ).rejects.toThrow('already assigned to another active registration')
  })

  it('unassigns a portfolio, freeing it for reassignment', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 10)
    const portfolio = await createPortfolio(committee.id)
    const registration = await createRegistration(student.id, mun.id, product.id)

    await assignPortfolio(registration.id, portfolio.id, { userId: organizer.id, role: 'ORGANIZER' })
    await unassignPortfolio(registration.id, { userId: organizer.id, role: 'ORGANIZER' })

    const [updated] = await db.select().from(registrations).where(eq(registrations.id, registration.id)).limit(1)
    expect(updated?.portfolioId).toBeNull()
  })
})

describe('bulkAssignPortfolio', () => {
  it('reports per-row success and failure', async () => {
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id)
    const committee = await createCommittee(mun.id, 10)
    const portfolio = await createPortfolio(committee.id)
    const registrationA = await createRegistration(studentA.id, mun.id, product.id)
    const registrationB = await createRegistration(studentB.id, mun.id, product.id)

    await assignPortfolio(registrationA.id, portfolio.id, { userId: organizer.id, role: 'ORGANIZER' })

    const result = await bulkAssignPortfolio(
      [{ registrationId: registrationB.id, portfolioId: portfolio.id }],
      { userId: organizer.id, role: 'ORGANIZER' },
    )

    expect(result.succeeded).toEqual([])
    expect(result.failed[0]?.id).toBe(registrationB.id)
  })
})
```

Move the `createPortfolio` helper's dynamic import to the file's static top-level import (add `portfolios` to the existing `@/lib/db/schema` import line) instead of importing inside the function.

- [ ] **Step 6: Run the full allocation test suite**

Run: `npx vitest run lib/actions/allocation.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/allocation.ts lib/actions/allocation.test.ts
git commit -m "feat: add assignCommittee/unassignCommittee/bulkAssignCommittee/assignPortfolio/unassignPortfolio/bulkAssignPortfolio actions"
```

---

### Task 7: Wire the organizer `registrations` page to allocation actions

**Files:**
- Create: `app/organizer/dashboard/[munId]/registrations/actions.ts`
- Create: `app/organizer/dashboard/[munId]/registrations/assign-committee-control.tsx`
- Create: `app/organizer/dashboard/[munId]/registrations/assign-portfolio-control.tsx`
- Modify: `app/organizer/dashboard/[munId]/registrations/page.tsx` (pass committees/portfolios to `DelegateTable`)
- Modify: `components/organizer/delegate-table.tsx` (render assign controls per row)

**Interfaces:**
- Consumes: `assignCommittee`, `unassignCommittee`, `assignPortfolio`, `unassignPortfolio`, `bulkAssignCommittee`, `bulkAssignPortfolio` from `lib/actions/allocation.ts` (Task 6); `listCommittees`, `listPortfolios` from `lib/actions/mun-config.ts`.
- Produces: interactive assign/unassign controls on each registration row.

- [ ] **Step 1: Create the route-local `actions.ts` wrapper**

Create `app/organizer/dashboard/[munId]/registrations/actions.ts`, following the exact 3-part contract documented in `app/organizer/dashboard/[munId]/products/actions.ts` (throw-to-result translation, server-side session resolution, revalidation):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import {
  assignCommittee,
  assignPortfolio,
  bulkAssignCommittee,
  bulkAssignPortfolio,
  unassignCommittee,
  unassignPortfolio,
  type BulkAssignResult,
} from "@/lib/actions/allocation";

/**
 * Route-local wrappers around `lib/actions/allocation`. Same three-part
 * contract as `app/organizer/dashboard/[munId]/products/actions.ts`:
 * translate throws to a discriminated result, resolve the session
 * server-side only, revalidate the section path after a mutation.
 *
 * Authorization is NOT re-implemented here — every `lib/actions/allocation`
 * function calls `assertOwnsOrAdmin` internally.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to edit this conference. Sign in again.";
    }
    if (error.message === "Mun not found" || error.message === "Registration not found") {
      return "That registration no longer exists. Reload the page.";
    }
    if (error.message === "Committee not found" || error.message === "Portfolio not found") {
      return "That committee or portfolio was already removed. Reload the page.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function revalidateSection(munId: string): void {
  revalidatePath(`/organizer/dashboard/${munId}/registrations`);
}

export async function assignCommitteeAction(
  munId: string,
  registrationId: string,
  committeeId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await assignCommittee(registrationId, committeeId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function unassignCommitteeAction(
  munId: string,
  registrationId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await unassignCommittee(registrationId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function assignPortfolioAction(
  munId: string,
  registrationId: string,
  portfolioId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await assignPortfolio(registrationId, portfolioId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function unassignPortfolioAction(
  munId: string,
  registrationId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await unassignPortfolio(registrationId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function bulkAssignCommitteeAction(
  munId: string,
  registrationIds: string[],
  committeeId: string,
): Promise<ActionResult<BulkAssignResult>> {
  try {
    const session = await getSession();
    const result = await bulkAssignCommittee(registrationIds, committeeId, session);
    revalidateSection(munId);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function bulkAssignPortfolioAction(
  munId: string,
  assignments: Array<{ registrationId: string; portfolioId: string }>,
): Promise<ActionResult<BulkAssignResult>> {
  try {
    const session = await getSession();
    const result = await bulkAssignPortfolio(assignments, session);
    revalidateSection(munId);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
```

- [ ] **Step 2: Create the committee assign control (client component)**

Create `app/organizer/dashboard/[munId]/registrations/assign-committee-control.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { assignCommitteeAction, unassignCommitteeAction } from "./actions";

interface CommitteeOption {
  id: string;
  name: string;
}

interface AssignCommitteeControlProps {
  munId: string;
  registrationId: string;
  currentCommitteeId: string | null;
  committees: CommitteeOption[];
}

/**
 * A native `<select>` bound directly to `assignCommitteeAction` /
 * `unassignCommitteeAction` — no client-side capacity check, since the
 * server is the only source of truth for capacity (Global Constraints).
 * Selecting "Unassigned" calls unassign; selecting a committee calls assign.
 * A failed assignment (e.g. capacity reached) reverts the select via
 * `key`-remount rather than leaving a stale selection showing.
 */
export function AssignCommitteeControl({
  munId,
  registrationId,
  currentCommitteeId,
  committees,
}: AssignCommitteeControlProps) {
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState(currentCommitteeId ?? "");

  function handleChange(next: string) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = next
        ? await assignCommitteeAction(munId, registrationId, next)
        : await unassignCommitteeAction(munId, registrationId);

      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-xs">
      <select
        className="rounded-sm border border-border bg-card px-xs py-0.5 text-body-sm text-ink disabled:opacity-60"
        value={value}
        disabled={pending}
        aria-label="Assign committee"
        onChange={(event) => handleChange(event.target.value)}
      >
        <option value="">Unassigned</option>
        {committees.map((committee) => (
          <option key={committee.id} value={committee.id}>
            {committee.name}
          </option>
        ))}
      </select>
      {pending && <Loader2Icon aria-hidden className="size-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
```

- [ ] **Step 3: Create the portfolio assign control (client component)**

Create `app/organizer/dashboard/[munId]/registrations/assign-portfolio-control.tsx` — same shape as Step 2, swapping committee for portfolio:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { assignPortfolioAction, unassignPortfolioAction } from "./actions";

interface PortfolioOption {
  id: string;
  name: string;
}

interface AssignPortfolioControlProps {
  munId: string;
  registrationId: string;
  currentPortfolioId: string | null;
  portfolios: PortfolioOption[];
}

/** Same contract as `AssignCommitteeControl` — see that file's doc comment. */
export function AssignPortfolioControl({
  munId,
  registrationId,
  currentPortfolioId,
  portfolios,
}: AssignPortfolioControlProps) {
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState(currentPortfolioId ?? "");

  function handleChange(next: string) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = next
        ? await assignPortfolioAction(munId, registrationId, next)
        : await unassignPortfolioAction(munId, registrationId);

      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  }

  if (portfolios.length === 0) {
    return <span className="text-muted-foreground italic">No portfolios</span>;
  }

  return (
    <div className="flex items-center gap-xs">
      <select
        className="rounded-sm border border-border bg-card px-xs py-0.5 text-body-sm text-ink disabled:opacity-60"
        value={value}
        disabled={pending}
        aria-label="Assign portfolio"
        onChange={(event) => handleChange(event.target.value)}
      >
        <option value="">Unassigned</option>
        {portfolios.map((portfolio) => (
          <option key={portfolio.id} value={portfolio.id}>
            {portfolio.name}
          </option>
        ))}
      </select>
      {pending && <Loader2Icon aria-hidden className="size-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
```

- [ ] **Step 4: Fetch committees + all portfolios in `page.tsx` and pass to `DelegateTable`**

Modify `app/organizer/dashboard/[munId]/registrations/page.tsx`. It already imports `listCommittees` and calls it at line 74. Add a portfolio fetch (all portfolios across all of this mun's committees, since a registration's portfolio isn't necessarily in its currently-assigned committee — an organizer may reassign both independently) and pass both down. Add near the existing `const committees = await listCommittees(munId);` line:

```ts
import { listCommittees, listPortfolios } from "@/lib/actions/mun-config";

// ... inside the component, after `const committees = await listCommittees(munId);`:
const portfoliosByCommittee = await Promise.all(
  committees.map((committee) => listPortfolios(committee.id)),
);
const allPortfolios = portfoliosByCommittee.flat().map((portfolio) => ({
  id: portfolio.id,
  name: portfolio.name,
}));
```

Update the `<DelegateTable rows={rows} />` call to also pass `munId`, `committees`, and `allPortfolios`:

```tsx
<DelegateTable
  munId={munId}
  rows={rows}
  committees={committees.map((committee) => ({ id: committee.id, name: committee.name }))}
  portfolios={allPortfolios}
/>
```

- [ ] **Step 5: Update `DelegateTable` to accept and render the new props**

Modify `components/organizer/delegate-table.tsx`. Update the header comment's "READ-ONLY BY CONSTRUCTION" claim (it's now inaccurate — replace with a note that assign/unassign now exist, per Slice 1) and the props:

```tsx
import { AssignCommitteeControl } from "@/app/organizer/dashboard/[munId]/registrations/assign-committee-control";
import { AssignPortfolioControl } from "@/app/organizer/dashboard/[munId]/registrations/assign-portfolio-control";

interface DelegateTableProps {
  munId: string;
  rows: DelegateRow[];
  committees: Array<{ id: string; name: string }>;
  portfolios: Array<{ id: string; name: string }>;
}
```

Update `DelegateRowCard` to accept and pass through `munId`, `committees`, `portfolios`, replacing the static committee/portfolio name display (lines 153-161 in the current file) with the interactive controls:

```tsx
function DelegateRowCard({
  row,
  munId,
  committees,
  portfolios,
}: {
  row: DelegateRow;
  munId: string;
  committees: Array<{ id: string; name: string }>;
  portfolios: Array<{ id: string; name: string }>;
}) {
  const payment = latestPayment(row);

  return (
    <details className="group/row border-b border-border last:border-b-0 open:bg-surface-soft/60 dark:open:bg-card">
      <summary
        className="grid cursor-pointer list-none grid-cols-[auto_1fr] items-start gap-x-sm gap-y-xs px-md py-sm transition-colors outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:-ring-offset-2 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center dark:hover:bg-card [&::-webkit-details-marker]:hidden"
        aria-label={`Registration detail for ${row.user.name}`}
      >
        <ChevronRightIcon
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open/row:rotate-90 md:mt-0"
          strokeWidth={1.75}
        />

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-body-md font-medium text-ink">
            {row.user.name}
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {row.id.slice(0, 8)}
          </span>
        </div>

        {/* Interactive controls stop propagation so clicking the select
            doesn't toggle the <details> expander underneath it. */}
        <div onClick={(event) => event.stopPropagation()}>
          <AssignCommitteeControl
            munId={munId}
            registrationId={row.id}
            currentCommitteeId={row.committeeId}
            committees={committees}
          />
        </div>

        <div onClick={(event) => event.stopPropagation()}>
          <AssignPortfolioControl
            munId={munId}
            registrationId={row.id}
            currentPortfolioId={row.portfolioId}
            portfolios={portfolios}
          />
        </div>

        <div className="col-start-2 md:col-start-auto">
          <RegistrationStatusChip status={row.status} />
        </div>

        <div className="col-start-2 md:col-start-auto md:justify-self-end">
          {payment ? (
            <PaymentStatusChip status={payment.status} />
          ) : (
            <span className="text-body-md text-muted-foreground">No payment</span>
          )}
        </div>
      </summary>

      {/* ... rest of the expanded detail panel is unchanged ... */}
    </details>
  );
}
```

Update the `DelegateTable` export to pass the new props through:

```tsx
export function DelegateTable({ munId, rows, committees, portfolios }: DelegateTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div
        aria-hidden
        className="hidden grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-sm border-b border-border bg-surface-soft px-md py-xs text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase md:grid dark:bg-background/40"
      >
        <span className="size-3.5" />
        <span>Delegate</span>
        <span>Committee</span>
        <span>Portfolio</span>
        <span>Registration</span>
        <span className="justify-self-end">Payment</span>
      </div>

      <div role="list">
        {rows.map((row) => (
          <DelegateRowCard key={row.id} row={row} munId={munId} committees={committees} portfolios={portfolios} />
        ))}
      </div>
    </div>
  );
}
```

Note: `<details>`/`<summary>` with an interactive `<select>` inside the summary works in all evergreen browsers (the `stopPropagation` prevents the click from also toggling the details element) — this is the smallest change that keeps the existing zero-client-JS server component mostly intact, isolating client-side interactivity to just the two new leaf components.

- [ ] **Step 6: Manually verify in the dev server**

Run: `npm run dev`, then navigate to `/organizer/dashboard/[a seeded munId]/registrations` as an organizer with at least one committee, one portfolio, and one registration (use seeded data via `npm run db:seed` if needed). Confirm:
- The committee/portfolio selects show the current assignment (or "Unassigned").
- Changing a select persists after a page reload.
- Assigning to a full committee shows a toast error and reverts the select.
- Assigning an already-taken portfolio shows a toast error and reverts the select.

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add app/organizer/dashboard/'[munId]'/registrations/ components/organizer/delegate-table.tsx
git commit -m "feat(web): wire registrations page to assignCommittee/assignPortfolio with inline select controls"
```

---

### Task 8: Rename "Registration Products" UI label to "Registration Types"

**Files:**
- Modify: `app/organizer/dashboard/nav-config.ts:143-144`
- Modify: `app/organizer/dashboard/[munId]/products/page.tsx` (page title/heading, if hardcoded separately from nav)

**Interfaces:**
- Produces: no functional change — label text only. `segment: "products"`, module keys `REGISTRATION_TYPES`/`PRICING_CAPACITY`, and all function/file names stay identical (Global Constraints).

- [ ] **Step 1: Update the nav label**

In `app/organizer/dashboard/nav-config.ts`, find lines 143-144:

```ts
    segment: "products",
    label: "Registration Products",
```

Change only the label:

```ts
    segment: "products",
    label: "Registration Types",
```

- [ ] **Step 2: Check for a hardcoded page heading**

Run: `grep -n "Registration Products" app/organizer/dashboard/'[munId]'/products/page.tsx`

If found (e.g. in a `<WorkspacePage title="Registration Products" ...>` call), update that string to `"Registration Types"` too, for consistency with the nav label.

- [ ] **Step 3: Search for any other hardcoded occurrences**

Run: `grep -rn "Registration Products" app/ components/ --include='*.tsx' --include='*.ts'`

Update any other UI-facing string found (page titles, breadcrumbs, empty-state copy) to say "Registration Types" — but leave alone any occurrence inside a code comment that's documenting history (e.g. referring to the old label for context), since those aren't user-facing.

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`, navigate to `/organizer/dashboard/[a seeded munId]/products`, confirm the sidebar and page heading both read "Registration Types" and the URL is still `/products`.

Stop the dev server when done.

- [ ] **Step 5: Run the full test suite and typecheck to confirm no regression**

Run: `npm test`
Expected: all tests PASS (this task touches no logic, only strings, but confirms nothing else broke during the slice).

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/organizer/dashboard/nav-config.ts app/organizer/dashboard/'[munId]'/products/
git commit -m "chore: rename Registration Products UI label to Registration Types (no route/module-key change)"
```

---

### Task 9: Full-suite verification and cross-tenant security test sweep

**Files:**
- Test: `lib/actions/allocation.test.ts` (extend with cross-MUN test if not already covered by Task 6)

**Interfaces:**
- None new — this task is verification only.

- [ ] **Step 1: Confirm cross-organizer rejection is tested for every new action**

Task 6 Step 1 already includes a cross-organizer test for `assignCommittee`. Verify (don't just assume) that `assignPortfolio`, `unassignCommittee`, and `unassignPortfolio` have the same protection by reading `lib/actions/allocation.ts` — since all four call `assertOwnsOrAdmin(munId, session)` before any mutation, and `assignCommittee`'s cross-organizer test already proves that helper rejects a non-owning organizer for this file's `getMunIdForRegistration` resolution path, this is sufficient without duplicating the same test four more times. If in doubt, add one more explicit test for `assignPortfolio`:

```ts
it('rejects a different organizer from assigning portfolios on another organizer\'s mun', async () => {
  const organizerA = await createUser('ORGANIZER')
  const organizerB = await createUser('ORGANIZER')
  const student = await createUser('STUDENT')
  const mun = await createMun(organizerA.id)
  const product = await createProduct(mun.id)
  const committee = await createCommittee(mun.id, 10)
  const portfolio = await createPortfolio(committee.id)
  const registration = await createRegistration(student.id, mun.id, product.id)

  await expect(
    assignPortfolio(registration.id, portfolio.id, { userId: organizerB.id, role: 'ORGANIZER' }),
  ).rejects.toThrow('Forbidden')
})
```

Add this to the `assignPortfolio / unassignPortfolio` describe block in `lib/actions/allocation.test.ts`.

- [ ] **Step 2: Run it to verify it passes**

Run: `npx vitest run lib/actions/allocation.test.ts -t "different organizer from assigning portfolios"`
Expected: PASS.

- [ ] **Step 3: Run the entire test suite**

Run: `npm test`
Expected: all tests PASS — the pre-existing 557+ tests plus every test added in this plan (Tasks 1, 2, 4, 5, 6, 9). Note this runs against local Docker Postgres via `.env.test`, not Neon.

- [ ] **Step 4: Run the type checker**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: 0 errors (warnings acceptable only if pre-existing — do not introduce new ones).

- [ ] **Step 6: Show the full connectivity trace**

Confirm and report the following chain is real, not assumed:

```
ENTRY: app/organizer/dashboard/[munId]/registrations/page.tsx
  -> components/organizer/delegate-table.tsx (AssignCommitteeControl / AssignPortfolioControl)
  -> app/organizer/dashboard/[munId]/registrations/actions.ts (assignCommitteeAction / assignPortfolioAction)
  -> lib/actions/allocation.ts (assignCommittee / assignPortfolio)
  -> lib/db/schema.ts (registrations, committees, portfolios tables) -> Postgres
TEST: lib/actions/allocation.test.ts — "assigns a committee to a registration when the organizer owns the mun", "rejects assignment when the committee is at capacity", "rejects a second active registration for the same portfolio at the DB level"
RESULT: [paste actual `npm test` output confirming these pass]
```

- [ ] **Step 7: Final commit if any fixes were needed during verification**

```bash
git add -A
git commit -m "test: verification sweep for registration types + allocation enforcement slice"
```

(Skip this commit if Steps 3-5 passed clean with no changes needed.)
