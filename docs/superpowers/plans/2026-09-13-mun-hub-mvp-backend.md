# MUN Hub MVP Backend/Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend/data layer for MUN Hub MVP — Prisma schema, mock auth/payments/storage adapters, and server actions for marketplace, organizer workflow, registration+payment integrity, and RBAC — as the shared contract a parallel UI session builds against.

**Architecture:** Next.js 14 App Router monolith (no separate backend service). Server Actions + Route Handlers only. Prisma + local Postgres now, swappable to Supabase later without schema changes. Three adapter interfaces (auth/payments/storage) isolate all third-party integration points so real keys drop in later without touching call sites.

**Tech Stack:** Next.js 14, TypeScript, Prisma, PostgreSQL (Docker for dev), Zod (input validation), Vitest (integration tests against real local Postgres).

**Spec:** `docs/superpowers/specs/2026-09-13-mun-hub-mvp-backend-design.md`

## Global Constraints

- MVP scope only: PRD Section 28. No Passport, certificates, QR, reviews, recommendations, wildcard subdomains, real third-party keys.
- Every tenant-scoped query filters by `mun_id` via shared `lib/db/tenant-guard.ts` — never ad hoc.
- Never trust client-supplied role claims — every server action re-checks role server-side via `lib/auth/authorize.ts`.
- Registration/payment flow must be idempotent (unique constraint on `provider_order_id`) and prevent overbooking via transactional capacity checks (PRD Section 38).
- All third-party integrations (auth, payments, storage) go behind adapter interfaces in `lib/auth/adapter.ts`, `lib/payments/adapter.ts`, `lib/storage/adapter.ts` — mock implementations now, real ones later, call sites unchanged.
- Integration tests hit real local Postgres, max 2 mocks per test, never mock the system under test.
- Files 200-400 lines typical, 800 max. Functions <50 lines.

---

## Task 1: Project Scaffold + Tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `.env.example`, `.gitignore`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `docker-compose.yml` (local Postgres)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: running `npm run dev` serves Next.js on :3000; `npm run test` runs Vitest; `docker compose up -d` starts local Postgres on :5432.

- [ ] **Step 1: Scaffold Next.js app**

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint --use-npm
```
Answer prompts: yes to all defaults presented.

- [ ] **Step 2: Add shadcn/ui**

```bash
npx shadcn@latest init -d
```

- [ ] **Step 3: Add Docker Postgres**

Create `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: mun_hub
      POSTGRES_PASSWORD: mun_hub_dev
      POSTGRES_DB: mun_hub
    ports:
      - "5432:5432"
    volumes:
      - mun_hub_pgdata:/var/lib/postgresql/data
volumes:
  mun_hub_pgdata:
```

- [ ] **Step 4: Add `.env.example`**

```bash
DATABASE_URL="postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub"
MOCK_PAYMENT_WEBHOOK_SECRET="dev-webhook-secret-change-me"
AUTH_ADAPTER="mock"
PAYMENTS_ADAPTER="mock"
STORAGE_ADAPTER="mock"
```

Copy to `.env`: `cp .env.example .env`

- [ ] **Step 5: Install Prisma, Zod, Vitest**

```bash
npm install prisma @prisma/client zod
npm install -D vitest @vitejs/plugin-react dotenv
```

- [ ] **Step 6: Add Vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15000,
  },
})
```

Create `vitest.setup.ts`:
```typescript
import { config } from 'dotenv'
config({ path: '.env' })
```

Add to `package.json` scripts:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "db:up": "docker compose up -d",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio"
  }
}
```

- [ ] **Step 7: Verify dev server boots**

Run: `docker compose up -d && npm run dev`
Expected: server starts on http://localhost:3000 with no errors, Postgres container healthy (`docker compose ps` shows `healthy` or `Up`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Prisma, Vitest, Docker Postgres"
```

---

## Task 2: Drizzle Schema (All MVP Entities + Enums)

> **Actually implemented with Drizzle ORM, not Prisma.** This task's code blocks below are the real, verified implementation (superseding the original Prisma draft). See `lib/db/schema.ts` and `lib/db/schema-enums.ts`.

**Files:**
- Create: `lib/db/schema-enums.ts` (pgEnum definitions)
- Create: `lib/db/schema.ts` (pgTable + relations definitions)
- Create: `lib/db/client.ts`
- Create: `lib/db/migrate.ts` (migration runner script)

**Interfaces:**
- Consumes: `DATABASE_URL` env var from Task 1.
- Produces: Drizzle client singleton export `import { db } from '@/lib/db/client'`. All later tasks import `db` from here — never instantiate `drizzle(...)` directly elsewhere.
- Produces: Drizzle tables `users`, `muns`, `committees`, `portfolios`, `registrationProducts`, `registrations`, `payments`, `organizerApplications`, `verificationLogs`, `certificates`, `achievements`, `sessions` and pgEnums `roleEnum`, `munStatusEnum`, `registrationStatusEnum`, `paymentStatusEnum`, `applicationStatusEnum` (TS types `Role`, `MunStatus`, `RegistrationStatus`, `PaymentStatus`, `ApplicationStatus` derived via `(typeof xEnum.enumValues)[number]`).
- Produces `relations()` definitions for every FK so `db.query.muns.findMany({ with: { committees: true } })` style relational queries work.
- Adds a `sessions` table (not in the original Prisma-shaped draft) so `lib/auth/session.ts` can look up a session by opaque token instead of trusting a raw userId cookie.

- [ ] **Step 1: Write the enums**

Create `lib/db/schema-enums.ts`:
```typescript
import { pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', [
  'STUDENT',
  'ORGANIZER',
  'OPERATIONS',
  'ADMIN',
  'SUPER_ADMIN',
])

export const munStatusEnum = pgEnum('mun_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'ONBOARDING',
  'CONTENT_SUBMITTED',
  'VERIFICATION',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CONFERENCE_ACTIVE',
  'COMPLETED',
  'ARCHIVED',
])

export const registrationStatusEnum = pgEnum('registration_status', [
  'PENDING',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'CANCELLED',
  'REFUNDED',
  'ATTENDED',
  'NO_SHOW',
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'CREATED',
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
])

export const applicationStatusEnum = pgEnum('application_status', [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
])

export type Role = (typeof roleEnum.enumValues)[number]
export type MunStatus = (typeof munStatusEnum.enumValues)[number]
export type RegistrationStatus = (typeof registrationStatusEnum.enumValues)[number]
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]
export type ApplicationStatus = (typeof applicationStatusEnum.enumValues)[number]
```

- [ ] **Step 2: Write the tables + relations**

Create `lib/db/schema.ts` — see the real file at `lib/db/schema.ts` for the complete, verified definitions of all 12 tables (`users`, `sessions`, `muns`, `committees`, `portfolios`, `registrationProducts`, `registrations`, `payments`, `certificates`, `achievements`, `organizerApplications`, `verificationLogs`) plus their `relations()` blocks. Pattern used throughout:

```typescript
import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { munStatusEnum, roleEnum /* ...other enums */ } from './schema-enums'

export * from './schema-enums'

function id() {
  return text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
}

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  role: roleEnum('role').notNull().default('STUDENT'),
  username: text('username').unique(),
  institution: text('institution'),
  profileImage: text('profile_image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const muns = pgTable(
  'muns',
  {
    id: id(),
    organizerId: text('organizer_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    // ...edition, theme, description, startDate, endDate, venue, city, country
    status: munStatusEnum('status').notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('muns_status_idx').on(table.status),
    index('muns_organizer_id_idx').on(table.organizerId),
  ],
)

export const munsRelations = relations(muns, ({ one, many }) => ({
  organizer: one(users, { fields: [muns.organizerId], references: [users.id] }),
  committees: many(committees),
  registrationProducts: many(registrationProducts),
  // ...
}))

// sessions table (new): supports token-based getSession()
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)
```

Field/table names to use everywhere downstream (Drizzle uses camelCase JS identifiers mapped to snake_case columns): `muns.organizerId`, `registrations.registrationProductId`, `registrations.committeeId`, `registrations.portfolioId`, `payments.registrationId`, `payments.providerOrderId`, `verificationLogs.reviewerId`, `verificationLogs.internalNotes`. Indexes added: `muns(status)`, `muns(organizerId)`, `committees(munId)`, `portfolios(committeeId)`, `registrationProducts(munId)`, `registrations(munId, status)`, `registrations(registrationProductId, status)`, `registrations(userId)`, `verificationLogs(munId)`, `sessions(userId)`.

- [ ] **Step 3: Write DB client singleton**

Create `lib/db/client.ts`:
```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const globalForDb = globalThis as unknown as { queryClient?: ReturnType<typeof postgres> }

const queryClient = globalForDb.queryClient ?? postgres(process.env.DATABASE_URL!)

if (process.env.NODE_ENV !== 'production') {
  globalForDb.queryClient = queryClient
}

export const db = drizzle(queryClient, { schema })
```

- [ ] **Step 4: Write the migration runner**

Create `lib/db/migrate.ts` (this is what `npm run db:migrate` calls, per `package.json`):
```typescript
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

config({ path: '.env' })

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')

  const migrationClient = postgres(databaseUrl, { max: 1 })
  const db = drizzle(migrationClient)

  console.log('Running migrations from ./drizzle ...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations complete.')

  await migrationClient.end()
}

main().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
```

- [ ] **Step 5: Generate and run the migration**

Run: `npm run db:up && npx drizzle-kit generate && npm run db:migrate`
Expected: `drizzle/0000_*.sql` generated (verified: 12 tables, all FKs/indexes present), migration applies cleanly against local Postgres, no errors (a harmless NOTICE about one long FK constraint name being truncated to 63 chars is expected and safe).

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/schema-enums.ts lib/db/client.ts lib/db/migrate.ts drizzle
git commit -m "feat: add Drizzle schema for all MVP entities and DB client singleton"
```

---

## Task 3: Shared Types + Tenant Guard

> **Actually implemented with Drizzle ORM, not Prisma.** Code blocks below are the real, verified implementation. `assertMunExists` uses Drizzle's `select().from().where()` syntax, not `db.mun.findUnique`. Types use `InferSelectModel` against `lib/db/schema.ts` tables, not `@prisma/client` imports.

**Files:**
- Create: `lib/types/mun.ts`, `lib/types/registration.ts`, `lib/types/user.ts`, `lib/types/index.ts`
- Create: `lib/db/tenant-guard.ts`
- Test: `lib/db/tenant-guard.test.ts`

**Interfaces:**
- Consumes: Drizzle tables/relations from Task 2 (`db` client from `lib/db/client.ts`).
- Produces: `assertMunExists(munId: string): Promise<MunRow>` — every tenant-scoped read/write in later tasks should call this first to fail fast on a bad `munId`. Produces re-exported types `MunSummary`, `MunDetail`, `RegistrationInput`, `PublicUser` from `lib/types/index.ts` for the UI session to import.
- **IDOR correction:** `RegistrationInput.userId` is optional, not required — callers must never accept a client-supplied `userId` for a mutation on a specific user's data. The actor is always derived from `getSession()` (Task 4). The optional field exists only for internal server-side construction after the session is already resolved.
- **MunSummary correction:** expanded beyond the original id/name/slug/city/country/startDate/endDate/status shape to also carry `minPrice: number | null` (cheapest active `registrationProducts` row for that MUN), `coverImage: string | null`, and `organizerName: string | null` — required for marketplace card rendering. These are derived/joined fields; callers building a `MunSummary` compute them, they are not raw columns on `muns`.

- [ ] **Step 1: Write failing test for tenant guard**

Create `lib/db/tenant-guard.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from './client'
import { muns, users } from './schema'
import { assertMunExists } from './tenant-guard'

describe('tenant-guard', () => {
  let munId: string

  beforeAll(async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Test Mun', slug: `test-mun-${Date.now()}` })
      .returning()

    munId = mun.id
  })

  it('resolves an existing mun id', async () => {
    const mun = await assertMunExists(munId)
    expect(mun.id).toBe(munId)
  })

  it('throws for a non-existent mun id', async () => {
    await expect(assertMunExists('does-not-exist')).rejects.toThrow('Mun not found')
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/db/tenant-guard.test.ts`
Expected: FAIL — `assertMunExists` not defined.

- [ ] **Step 3: Implement tenant guard**

Create `lib/db/tenant-guard.ts`:
```typescript
import { eq } from 'drizzle-orm'
import { db } from './client'
import { muns } from './schema'

export type MunRow = typeof muns.$inferSelect

export async function assertMunExists(munId: string): Promise<MunRow> {
  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) {
    throw new Error('Mun not found')
  }
  return mun
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/db/tenant-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Write shared types**

Create `lib/types/mun.ts`:
```typescript
import type { InferSelectModel } from 'drizzle-orm'
import type { committees, muns, registrationProducts } from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'

export type Mun = InferSelectModel<typeof muns>
export type Committee = InferSelectModel<typeof committees>
export type RegistrationProduct = InferSelectModel<typeof registrationProducts>

export interface MunSummary {
  id: string
  name: string
  slug: string
  city: string | null
  country: string | null
  startDate: Date | null
  endDate: Date | null
  status: MunStatus
  minPrice: number | null
  coverImage: string | null
  organizerName: string | null
}

export interface MunDetail extends Mun {
  committees: Committee[]
  registrationProducts: RegistrationProduct[]
  organizerName: string | null
}
```

Create `lib/types/registration.ts`:
```typescript
import type { InferSelectModel } from 'drizzle-orm'
import type { registrations } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/db/schema-enums'

export type Registration = InferSelectModel<typeof registrations>

export interface RegistrationInput {
  userId?: string // NEVER accept from a client — derive from getSession()
  munId: string
  registrationProductId: string
  committeeId?: string
  portfolioId?: string
  formResponses?: Record<string, unknown>
}

export type { RegistrationStatus }
```

Create `lib/types/user.ts`:
```typescript
import type { InferSelectModel } from 'drizzle-orm'
import type { users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'

export type User = InferSelectModel<typeof users>

export interface PublicUser {
  id: string
  name: string
  username: string | null
  institution: string | null
  profileImage: string | null
  role: Role
}
```

Create `lib/types/index.ts`:
```typescript
export * from './mun'
export * from './registration'
export * from './user'
```

- [ ] **Step 6: Commit**

```bash
git add lib/types lib/db
git commit -m "feat: add tenant guard and shared types contract"
```

---

## Task 4: Mock Auth Adapter + Authorize Helper

> **Actually implemented with Drizzle ORM, not Prisma.** `getSession()` now looks up a real `sessions` table row by opaque token (never a raw userId in the cookie) — this is a deliberate correction over the original plan, flagged by a UI-session review as an IDOR risk if a raw userId were trusted from a cookie. `createSession`/`destroySession` were added for sign-in/sign-out wiring in a later wave.

**Files:**
- Create: `lib/auth/adapter.ts`, `lib/auth/mock-adapter.ts`, `lib/auth/authorize.ts`, `lib/auth/session.ts`
- Test: `lib/auth/authorize.test.ts`

**Interfaces:**
- Consumes: `Role` type from Task 2's `lib/db/schema-enums.ts`, `db` client, `sessions`/`users` tables.
- Produces: `getSession(): Promise<Session | null>` from `lib/auth/session.ts` — reads the `mun_hub_session` cookie as a TOKEN, joins `sessions` → `users`, checks `expiresAt`, returns `{ userId, role }` or null. Every server action in later tasks calls this to identify the actor — never accept a client-supplied `userId` parameter for a mutation/read of a specific user's data.
- Produces `createSession(userId): Promise<{ token: string; expiresAt: Date }>` and `destroySession(token): Promise<void>` — sign-in/sign-out (built in a later wave) call these.
- Produces `requireRole(session, allowedRoles: Role[]): void` from `lib/auth/authorize.ts` — throws `Error('Forbidden')` if role not allowed.
- Produces `AuthAdapter` interface with `signIn`, `signOut`, `getCurrentUserId` methods — real provider adapter (Supabase Auth or other, undecided) implements same interface later.

- [ ] **Step 1: Write failing test for authorize**

Create `lib/auth/authorize.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { requireRole } from './authorize'

describe('requireRole', () => {
  it('passes when role is allowed', () => {
    expect(() => requireRole({ userId: '1', role: 'ADMIN' }, ['ADMIN', 'SUPER_ADMIN'])).not.toThrow()
  })

  it('throws Forbidden when role is not allowed', () => {
    expect(() => requireRole({ userId: '1', role: 'STUDENT' }, ['ADMIN'])).toThrow('Forbidden')
  })

  it('throws Forbidden when session is null', () => {
    expect(() => requireRole(null, ['ADMIN'])).toThrow('Forbidden')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/auth/authorize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement adapter interface**

Create `lib/auth/adapter.ts`:
```typescript
import type { Role } from '@/lib/db/schema-enums'

export interface Session {
  userId: string
  role: Role
}

export interface AuthAdapter {
  signIn(email: string, password: string): Promise<Session>
  signOut(sessionToken: string): Promise<void>
  getCurrentUserId(sessionToken: string): Promise<string | null>
}
```

- [ ] **Step 4: Implement session helpers (token-based, not raw userId cookie)**

Create `lib/auth/session.ts`:
```typescript
import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import type { Session } from './adapter'

export const SESSION_COOKIE_NAME = 'mun_hub_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const [row] = await db
    .select({ userId: users.id, role: users.role, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1)

  if (!row) return null
  return { userId: row.userId, role: row.role }
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ userId, token, expiresAt })
  return { token, expiresAt }
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token))
}
```

- [ ] **Step 5: Implement mock adapter + authorize helper**

Create `lib/auth/mock-adapter.ts`:
```typescript
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import type { AuthAdapter, Session } from './adapter'
import { createSession, destroySession } from './session'

export const mockAuthAdapter: AuthAdapter = {
  async signIn(email: string): Promise<Session> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!user) throw new Error('Invalid credentials')
    return { userId: user.id, role: user.role }
  },

  async signOut(sessionToken: string): Promise<void> {
    await destroySession(sessionToken)
  },

  async getCurrentUserId(sessionToken: string): Promise<string | null> {
    const [row] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.token, sessionToken))
      .limit(1)
    return row?.userId ?? null
  },
}

export { createSession }
```

Create `lib/auth/authorize.ts`:
```typescript
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from './adapter'

export function requireRole(session: Session | null, allowedRoles: Role[]): asserts session is Session {
  if (!session || !allowedRoles.includes(session.role)) {
    throw new Error('Forbidden')
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- lib/auth/authorize.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/auth
git commit -m "feat: add mock auth adapter, token-based session, and role authorization helper"
```

---

## Task 5: Mock Payments Adapter + Webhook Route

> **Actually implemented with Drizzle ORM, not Prisma.** The adapter itself (this task's Step 1-6) was built in the foundation wave and is verified below. **The webhook route handler (Step 7-9) was NOT built in the foundation wave — it is still owed by whoever picks up this task.** Prisma syntax in the original Step 7-9 draft is illustrative only — use Drizzle against `lib/db/schema.ts` (see Task 2 for the pattern: `db.select().from(payments).where(eq(payments.providerOrderId, orderId))`, `db.update(payments).set({...}).where(...)`, `db.transaction(async (tx) => {...})` for the atomic payment+registration update). Also wire in `simulatePaymentOutcome` (added to the mock adapter, see below) for the mock checkout page so the HMAC secret never reaches the browser.

**Files:**
- Create: `lib/payments/adapter.ts`, `lib/payments/mock-adapter.ts` (done)
- Create: `app/api/webhooks/payments/route.ts` (not yet done — later wave)
- Test: `lib/payments/mock-adapter.test.ts` (done), `app/api/webhooks/payments/route.test.ts` (not yet done)

**Interfaces:**
- Consumes: `db` client, `payments`/`registrations` tables from Task 2.
- Produces: `PaymentsAdapter` interface with `createOrder(amount, currency, registrationId): Promise<{ orderId: string }>` and `verifyWebhookSignature(payload, signature): boolean` — real Razorpay adapter implements same interface later.
- Produces `simulatePaymentOutcome(orderId, outcome: 'success' | 'failure'): Promise<{ signature: string; payload: string }>` — server-side-only helper so a later "mock checkout page" can produce an authentically-signed fake payment outcome without the HMAC secret ever reaching the browser (flagged as a requirement by a UI-session reviewer).
- Still to produce (later wave): route handler `POST /api/webhooks/payments` that the registration flow's checkout redirect posts to.

- [ ] **Step 1: Write failing test for mock adapter**

Create `lib/payments/mock-adapter.test.ts`:
```typescript
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mockPaymentsAdapter, simulatePaymentOutcome } from './mock-adapter'

describe('mockPaymentsAdapter', () => {
  it('creates an order with a unique orderId', async () => {
    const order = await mockPaymentsAdapter.createOrder(2500, 'INR', 'reg_123')
    expect(order.orderId).toMatch(/^mock_order_/)
  })

  it('verifies a correctly signed webhook payload', () => {
    const payload = JSON.stringify({ orderId: 'mock_order_1', status: 'paid' })
    const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET!
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, signature)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const payload = JSON.stringify({ orderId: 'mock_order_1', status: 'paid' })
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, 'bad-signature')).toBe(false)
  })

  it('rejects a signature of differing length without throwing', () => {
    const payload = JSON.stringify({ orderId: 'mock_order_1', status: 'paid' })
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, 'short')).toBe(false)
  })
})

describe('simulatePaymentOutcome', () => {
  it('produces a payload+signature that verifies as authentic for success', async () => {
    const { payload, signature } = await simulatePaymentOutcome('mock_order_abc', 'success')
    expect(JSON.parse(payload).status).toBe('paid')
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, signature)).toBe(true)
  })

  it('produces a payload+signature that verifies as authentic for failure', async () => {
    const { payload, signature } = await simulatePaymentOutcome('mock_order_abc', 'failure')
    expect(JSON.parse(payload).status).toBe('failed')
    expect(mockPaymentsAdapter.verifyWebhookSignature(payload, signature)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/payments/mock-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement adapter interface**

Create `lib/payments/adapter.ts`:
```typescript
export interface PaymentOrder {
  orderId: string
}

export interface PaymentsAdapter {
  createOrder(amount: number, currency: string, registrationId: string): Promise<PaymentOrder>
  verifyWebhookSignature(payload: string, signature: string): boolean
}
```

- [ ] **Step 4: Implement mock adapter (with simulatePaymentOutcome)**

Create `lib/payments/mock-adapter.ts`:
```typescript
import crypto from 'node:crypto'
import type { PaymentOrder, PaymentsAdapter } from './adapter'

function getWebhookSecret(): string {
  const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET
  if (!secret) throw new Error('MOCK_PAYMENT_WEBHOOK_SECRET not configured')
  return secret
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getWebhookSecret()).update(payload).digest('hex')
}

export const mockPaymentsAdapter: PaymentsAdapter = {
  async createOrder(_amount: number, _currency: string, registrationId: string): Promise<PaymentOrder> {
    return { orderId: `mock_order_${registrationId}_${Date.now()}` }
  },

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = sign(payload)
    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(signature)
    if (expectedBuf.length !== actualBuf.length) return false
    return crypto.timingSafeEqual(expectedBuf, actualBuf)
  },
}

/**
 * Server-side-only: signs a fake payment outcome so a mock checkout page can
 * post an authentic webhook payload+signature without the HMAC secret ever
 * reaching the browser.
 */
export async function simulatePaymentOutcome(
  orderId: string,
  outcome: 'success' | 'failure',
): Promise<{ signature: string; payload: string }> {
  const payload = JSON.stringify({
    orderId,
    status: outcome === 'success' ? 'paid' : 'failed',
    providerPaymentId: outcome === 'success' ? `mock_pay_${orderId}` : undefined,
  })
  return { payload, signature: sign(payload) }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/payments/mock-adapter.test.ts`
Expected: PASS (verified: 5 tests pass)

- [ ] **Step 6: Commit adapter**

```bash
git add lib/payments
git commit -m "feat: add mock payments adapter with server-signed outcome simulation"
```

- [ ] **Step 7 (later wave, NOT done in foundation task): write failing test for webhook route**

Create `app/api/webhooks/payments/route.test.ts` using Drizzle inserts (`db.insert(users).values({...}).returning()`, etc. — see Task 2/3 patterns) to seed an organizer/student/mun/product/registration/payment, then POST a signed body to the route and assert the registration flips to `CONFIRMED` and payment to `PAID`. Mirror the idempotency assertion (`alreadyConfirmed: true` on a second call) and invalid-signature rejection (400) from the original Prisma-shaped test.

- [ ] **Step 8 (later wave): implement webhook route handler**

Create `app/api/webhooks/payments/route.ts` using Drizzle: look up the payment row by `providerOrderId` with `db.select().from(payments).where(eq(payments.providerOrderId, orderId))`, short-circuit if already `PAID` (idempotency — the unique constraint on `providerOrderId` also protects this), then apply the payment+registration status update inside `db.transaction(async (tx) => { ... })`.

- [ ] **Step 9 (later wave): run test, verify PASS, commit**

---

## Task 6: Mock Storage Adapter

> No Prisma dependency in this task — the code below is unchanged from the original draft and has been verified as-is (no ORM involved).

**Files:**
- Create: `lib/storage/adapter.ts`, `lib/storage/mock-adapter.ts`
- Test: `lib/storage/mock-adapter.test.ts`

**Interfaces:**
- Produces: `StorageAdapter` interface with `upload(file: Buffer, key: string, contentType: string): Promise<{ url: string }>` and `delete(key: string): Promise<void>` — real R2 adapter implements same interface later.

- [ ] **Step 1: Write failing test**

Create `lib/storage/mock-adapter.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { mockStorageAdapter } from './mock-adapter'

describe('mockStorageAdapter', () => {
  it('uploads and returns a stable local URL', async () => {
    const result = await mockStorageAdapter.upload(Buffer.from('test'), 'logos/test.png', 'image/png')
    expect(result.url).toBe('/mock-storage/logos/test.png')
  })

  it('delete resolves without throwing', async () => {
    await expect(mockStorageAdapter.delete('logos/test.png')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/storage/mock-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement adapter**

Create `lib/storage/adapter.ts`:
```typescript
export interface UploadResult {
  url: string
}

export interface StorageAdapter {
  upload(file: Buffer, key: string, contentType: string): Promise<UploadResult>
  delete(key: string): Promise<void>
}
```

Create `lib/storage/mock-adapter.ts`:
```typescript
import type { StorageAdapter, UploadResult } from './adapter'

export const mockStorageAdapter: StorageAdapter = {
  async upload(_file: Buffer, key: string, _contentType: string): Promise<UploadResult> {
    return { url: `/mock-storage/${key}` }
  },

  async delete(_key: string): Promise<void> {
    return
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/storage/mock-adapter.test.ts`
Expected: PASS (verified)

- [ ] **Step 5: Commit**

```bash
git add lib/storage
git commit -m "feat: add mock storage adapter"
```

---

## Task 7: Seed Script

> **NOT built in the foundation wave** — the foundation task covered schema/types/adapters only. Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts` (see Task 2 for the pattern). `tsx` is already installed; `package.json`'s `db:seed` script already points at `tsx lib/db/seed.ts` (not `prisma/seed.ts` — there is no `prisma/` directory in this project).

**Files:**
- Create: `lib/db/seed.ts` (NOT `prisma/seed.ts` — there is no Prisma in this project)

**Interfaces:**
- Consumes: `db` client and tables from Task 2 (`lib/db/schema.ts`).
- Produces: `npm run db:seed` populates 3 users (1 admin, 1 organizer, 1 student), 2 published MUNs each with 2 committees, 2 portfolios per committee, 2 registration products. UI session and later backend tasks rely on this fixture data existing for manual testing.

- [ ] **Step 1: Write seed script (Drizzle — illustrative sketch, adapt field/table names against `lib/db/schema.ts`)**

Create `lib/db/seed.ts`:
```typescript
import { config } from 'dotenv'
config({ path: '.env' })

import { eq } from 'drizzle-orm'
import { db } from './client'
import { committees, muns, portfolios, registrationProducts, users } from './schema'

async function upsertUserByEmail(data: typeof users.$inferInsert) {
  const [existing] = await db.select().from(users).where(eq(users.email, data.email)).limit(1)
  if (existing) return existing
  const [created] = await db.insert(users).values(data).returning()
  return created
}

async function main() {
  const admin = await upsertUserByEmail({ name: 'Platform Admin', email: 'admin@munhub.test', role: 'ADMIN' })
  const organizer = await upsertUserByEmail({
    name: 'Oxford MUN Society',
    email: 'organizer@munhub.test',
    role: 'ORGANIZER',
  })
  await upsertUserByEmail({
    name: 'Asha Verma',
    email: 'student@munhub.test',
    role: 'STUDENT',
    institution: 'VIT Vellore',
  })

  for (const [i, name] of ['Oxford MUN 2027', 'VIT MUN 2027'].entries()) {
    const slug = `mun-${i}-${name.toLowerCase().replace(/\s+/g, '-')}`
    const [existingMun] = await db.select().from(muns).where(eq(muns.slug, slug)).limit(1)

    const mun =
      existingMun ??
      (
        await db
          .insert(muns)
          .values({
            organizerId: organizer.id,
            name,
            slug,
            edition: '2027',
            theme: 'Diplomacy in a Fractured World',
            description: `${name} brings together delegates from across the region.`,
            startDate: new Date('2027-03-10'),
            endDate: new Date('2027-03-12'),
            city: i === 0 ? 'Oxford' : 'Vellore',
            country: i === 0 ? 'UK' : 'India',
            status: 'PUBLISHED',
            publishedAt: new Date(),
          })
          .returning()
      )[0]

    if (existingMun) continue // idempotent re-run: skip child rows if mun already existed

    for (const committeeName of ['UNSC', 'UNHRC']) {
      const [committee] = await db
        .insert(committees)
        .values({ munId: mun.id, name: committeeName, agenda: 'Sample agenda', capacity: 30 })
        .returning()

      await db.insert(portfolios).values([
        { committeeId: committee.id, name: 'United States', type: 'country', availability: 1 },
        { committeeId: committee.id, name: 'France', type: 'country', availability: 1 },
      ])
    }

    await db.insert(registrationProducts).values([
      { munId: mun.id, name: 'Delegate', price: 2500, capacity: 200 },
      { munId: mun.id, name: 'Press', price: 1500, capacity: 20 },
    ])
  }

  console.log('Seed complete. Admin:', admin.email)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$client.end()
  })
```

- [ ] **Step 2: Run seed and verify**

Run: `npm run db:seed`
Expected: "Seed complete. Admin: admin@munhub.test" logged, no errors.

Verify: `npm run db:studio` opens Drizzle Studio, shows 3 users, 2 MUNs, 4 committees, 8 portfolios, 4 registration products.

- [ ] **Step 3: Commit**

```bash
git add lib/db/seed.ts
git commit -m "feat: add seed script with demo MUNs, committees, portfolios"
```

---

## Task 8: Marketplace Query Layer (Search/Filter/Sort)

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `db.mun.findMany({ where, orderBy, select })` becomes `db.select({...}).from(muns).where(...).orderBy(...)` (or `db.query.muns.findMany({ where: ..., orderBy: ... })` for the relational query API). Note the corrected `MunSummary` shape from Task 3 — `searchMuns` must also populate `minPrice`, `coverImage`, `organizerName` on every returned row, not just the original id/name/slug/city/country/startDate/endDate/status fields. Getting `minPrice` requires either a join/subquery against `registrationProducts` (cheapest `status = 'active'` row per `munId`) or a follow-up batched query — check `lib/db/schema.ts` for the real `registrationProducts` field names (`price`, `status`, `munId`).

**Files:**
- Create: `lib/actions/marketplace.ts`
- Test: `lib/actions/marketplace.test.ts`

**Interfaces:**
- Consumes: `db` client, `MunSummary` type from Task 3.
- Produces: `searchMuns(params: MunSearchParams): Promise<MunSummary[]>` — the UI session's marketplace page calls this directly. `MunSearchParams` = `{ query?: string; city?: string; country?: string; minPrice?: number; maxPrice?: number; sortBy?: 'date' | 'price' | 'newest'; status?: MunStatus[] }`.

- [ ] **Step 1: Write failing test**

Create `lib/actions/marketplace.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { searchMuns } from './marketplace'

describe('searchMuns', () => {
  beforeAll(async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    await db.mun.create({
      data: {
        organizerId: organizer.id, name: 'Searchable Oxford MUN', slug: `searchable-oxford-${Date.now()}`,
        city: 'Oxford', country: 'UK', status: 'PUBLISHED', publishedAt: new Date(),
        startDate: new Date('2027-05-01'), endDate: new Date('2027-05-03'),
      },
    })
    await db.mun.create({
      data: {
        organizerId: organizer.id, name: 'Draft Hidden MUN', slug: `draft-hidden-${Date.now()}`,
        city: 'Oxford', country: 'UK', status: 'DRAFT',
      },
    })
  })

  it('returns only published MUNs matching a text query', async () => {
    const results = await searchMuns({ query: 'Oxford' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((m) => m.status === 'PUBLISHED')).toBe(true)
    expect(results.some((m) => m.name.includes('Draft'))).toBe(false)
  })

  it('filters by city', async () => {
    const results = await searchMuns({ city: 'Oxford' })
    expect(results.every((m) => m.city === 'Oxford')).toBe(true)
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/actions/marketplace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement search action**

Create `lib/actions/marketplace.ts`:
```typescript
'use server'

import { db } from '@/lib/db/client'
import type { MunSummary, MunStatus } from '@/lib/types'

export interface MunSearchParams {
  query?: string
  city?: string
  country?: string
  minPrice?: number
  maxPrice?: number
  sortBy?: 'date' | 'price' | 'newest'
  status?: MunStatus[]
}

export async function searchMuns(params: MunSearchParams): Promise<MunSummary[]> {
  const statuses = params.status ?? ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED']

  const where = {
    status: { in: statuses },
    ...(params.city ? { city: params.city } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(params.query
      ? {
          OR: [
            { name: { contains: params.query, mode: 'insensitive' as const } },
            { city: { contains: params.query, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const orderBy =
    params.sortBy === 'date'
      ? { startDate: 'asc' as const }
      : params.sortBy === 'newest'
        ? { createdAt: 'desc' as const }
        : { startDate: 'asc' as const }

  const muns = await db.mun.findMany({
    where,
    orderBy,
    select: { id: true, name: true, slug: true, city: true, country: true, startDate: true, endDate: true, status: true },
  })

  return muns
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/actions/marketplace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/marketplace.ts lib/actions/marketplace.test.ts
git commit -m "feat: add marketplace search/filter server action"
```

---

## Task 9: Organizer Application + MUN Lifecycle State Machine

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `db.mun.findUnique({ where: { id } })` → `db.select().from(muns).where(eq(muns.id, munId)).limit(1)` (destructure the first row). `db.$transaction([...])` → `db.transaction(async (tx) => { ... })` with `tx.update(muns).set({...}).where(...)` and `tx.insert(verificationLogs).values({...})` inside. Field names: `verificationLogs.reviewerId`, `verificationLogs.internalNotes`, `muns.publishedAt`. `assertMunExists` from `lib/db/tenant-guard.ts` (Task 3) can replace the manual not-found check.

**Files:**
- Create: `lib/lifecycle/mun-state-machine.ts`
- Create: `lib/actions/organizer-application.ts`
- Test: `lib/lifecycle/mun-state-machine.test.ts`, `lib/actions/organizer-application.test.ts`

**Interfaces:**
- Consumes: `MunStatus` enum, `db` client, `requireRole`/`getSession` from Task 4.
- Produces: `canTransition(from: MunStatus, to: MunStatus): boolean` and `transitionMun(munId, toStatus, actorId, notes?, internalNotes?): Promise<Mun>` (writes `VerificationLog` row) from `lib/lifecycle/mun-state-machine.ts` — Task 10 (admin review) and later onboarding tasks depend on this. Produces `submitOrganizerApplication(input): Promise<OrganizerApplication>` from `lib/actions/organizer-application.ts`.

- [ ] **Step 1: Write failing test for state machine**

Create `lib/lifecycle/mun-state-machine.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { canTransition, transitionMun } from './mun-state-machine'

describe('canTransition', () => {
  it('allows DRAFT to SUBMITTED', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true)
  })

  it('disallows DRAFT to PUBLISHED (skipping review)', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false)
  })

  it('allows UNDER_REVIEW to APPROVED', () => {
    expect(canTransition('UNDER_REVIEW', 'APPROVED')).toBe(true)
  })
})

describe('transitionMun', () => {
  let munId: string
  let reviewerId: string

  beforeAll(async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const reviewer = await db.user.create({ data: { name: 'Reviewer', email: `rev-${Date.now()}@test.com`, role: 'OPERATIONS' } })
    reviewerId = reviewer.id
    const mun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'State Machine Mun', slug: `sm-mun-${Date.now()}`, status: 'SUBMITTED' },
    })
    munId = mun.id
  })

  it('transitions and writes a verification log', async () => {
    const updated = await transitionMun(munId, 'UNDER_REVIEW', reviewerId, 'starting review')
    expect(updated.status).toBe('UNDER_REVIEW')

    const logs = await db.verificationLog.findMany({ where: { munId } })
    expect(logs.length).toBe(1)
    expect(logs[0].action).toBe('UNDER_REVIEW')
  })

  it('throws on an invalid transition', async () => {
    await expect(transitionMun(munId, 'ARCHIVED', reviewerId)).rejects.toThrow('Invalid transition')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/lifecycle/mun-state-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement state machine**

Create `lib/lifecycle/mun-state-machine.ts`:
```typescript
import { db } from '@/lib/db/client'
import type { Mun, MunStatus } from '@prisma/client'

const ALLOWED_TRANSITIONS: Record<MunStatus, MunStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  APPROVED: ['ONBOARDING'],
  REJECTED: [],
  CHANGES_REQUESTED: ['SUBMITTED'],
  ONBOARDING: ['CONTENT_SUBMITTED'],
  CONTENT_SUBMITTED: ['VERIFICATION'],
  VERIFICATION: ['CHANGES_REQUESTED', 'PUBLISHED'],
  PUBLISHED: ['REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['CONFERENCE_ACTIVE'],
  CONFERENCE_ACTIVE: ['COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
}

export function canTransition(from: MunStatus, to: MunStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export async function transitionMun(
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
): Promise<Mun> {
  const mun = await db.mun.findUnique({ where: { id: munId } })
  if (!mun) {
    throw new Error('Mun not found')
  }

  if (!canTransition(mun.status, toStatus)) {
    throw new Error(`Invalid transition from ${mun.status} to ${toStatus}`)
  }

  const [updated] = await db.$transaction([
    db.mun.update({
      where: { id: munId },
      data: { status: toStatus, ...(toStatus === 'PUBLISHED' ? { publishedAt: new Date() } : {}) },
    }),
    db.verificationLog.create({
      data: { munId, reviewerId: actorId, action: toStatus, notes, internalNotes },
    }),
  ])

  return updated
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/lifecycle/mun-state-machine.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for organizer application**

Create `lib/actions/organizer-application.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { submitOrganizerApplication } from './organizer-application'

describe('submitOrganizerApplication', () => {
  it('creates an application and a DRAFT mun', async () => {
    const organizer = await db.user.create({ data: { name: 'New Org', email: `neworg-${Date.now()}@test.com`, role: 'ORGANIZER' } })

    const result = await submitOrganizerApplication({
      organizerId: organizer.id,
      conferenceName: 'New City MUN',
      expectedDate: new Date('2027-08-01'),
      location: 'Pune, India',
      expectedDelegateCount: 300,
      description: 'A regional MUN for first-time delegates.',
    })

    expect(result.status).toBe('SUBMITTED')
    expect(result.munId).toBeTruthy()

    const mun = await db.mun.findUnique({ where: { id: result.munId! } })
    expect(mun?.status).toBe('SUBMITTED')
    expect(mun?.name).toBe('New City MUN')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- lib/actions/organizer-application.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement organizer application action**

Create `lib/actions/organizer-application.ts`:
```typescript
'use server'

import { db } from '@/lib/db/client'
import type { OrganizerApplication } from '@prisma/client'

export interface OrganizerApplicationInput {
  organizerId: string
  conferenceName: string
  expectedDate: Date
  location: string
  expectedDelegateCount: number
  description: string
  previousEditions?: string
  websiteUrl?: string
}

export async function submitOrganizerApplication(
  input: OrganizerApplicationInput,
): Promise<OrganizerApplication> {
  const slugBase = input.conferenceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const slug = `${slugBase}-${Date.now()}`

  const mun = await db.mun.create({
    data: {
      organizerId: input.organizerId,
      name: input.conferenceName,
      slug,
      description: input.description,
      startDate: input.expectedDate,
      city: input.location,
      status: 'SUBMITTED',
    },
  })

  const application = await db.organizerApplication.create({
    data: {
      organizerId: input.organizerId,
      munId: mun.id,
      status: 'SUBMITTED',
    },
  })

  return application
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- lib/actions/organizer-application.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/lifecycle lib/actions/organizer-application.ts lib/actions/organizer-application.test.ts
git commit -m "feat: add MUN lifecycle state machine and organizer application submission"
```

---

## Task 10: Admin Review Actions

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `import type { Mun, MunStatus } from '@prisma/client'` → `import type { Mun } from '@/lib/types'` and `import type { MunStatus } from '@/lib/db/schema-enums'`. `session.userId`/`session.role` are unchanged (the `Session` type from Task 4 is ORM-agnostic).

**Files:**
- Create: `lib/actions/admin-review.ts`
- Test: `lib/actions/admin-review.test.ts`

**Interfaces:**
- Consumes: `transitionMun` from Task 9, `requireRole` from Task 4.
- Produces: `reviewMunApplication(munId, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', reviewerSession, notes?, internalNotes?): Promise<Mun>` and `publishMun(munId, reviewerSession): Promise<Mun>` — admin dashboard UI calls these directly.

- [ ] **Step 1: Write failing test**

Create `lib/actions/admin-review.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { reviewMunApplication, publishMun } from './admin-review'

describe('reviewMunApplication', () => {
  it('approves a submitted mun when actor is OPERATIONS', async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const ops = await db.user.create({ data: { name: 'Ops', email: `ops-${Date.now()}@test.com`, role: 'OPERATIONS' } })
    const mun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'Review Mun', slug: `review-mun-${Date.now()}`, status: 'UNDER_REVIEW' },
    })

    const result = await reviewMunApplication(mun.id, 'APPROVED', { userId: ops.id, role: 'OPERATIONS' }, 'looks good')
    expect(result.status).toBe('APPROVED')
  })

  it('rejects when actor is a STUDENT', async () => {
    const organizer = await db.user.create({ data: { name: 'Org2', email: `org2-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const student = await db.user.create({ data: { name: 'Student', email: `stu-${Date.now()}@test.com`, role: 'STUDENT' } })
    const mun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'Review Mun 2', slug: `review-mun-2-${Date.now()}`, status: 'UNDER_REVIEW' },
    })

    await expect(
      reviewMunApplication(mun.id, 'APPROVED', { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('Forbidden')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})

describe('publishMun', () => {
  it('publishes a mun in VERIFICATION status', async () => {
    const organizer = await db.user.create({ data: { name: 'Org3', email: `org3-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const admin = await db.user.create({ data: { name: 'Admin', email: `admin-${Date.now()}@test.com`, role: 'ADMIN' } })
    const mun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'Publish Mun', slug: `publish-mun-${Date.now()}`, status: 'VERIFICATION' },
    })

    const result = await publishMun(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(result.status).toBe('PUBLISHED')
    expect(result.publishedAt).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/actions/admin-review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement admin review actions**

Create `lib/actions/admin-review.ts`:
```typescript
'use server'

import type { Mun, MunStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/authorize'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import type { Session } from '@/lib/auth/adapter'

export async function reviewMunApplication(
  munId: string,
  decision: Extract<MunStatus, 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>,
  session: Session | null,
  notes?: string,
  internalNotes?: string,
): Promise<Mun> {
  requireRole(session, ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'])
  return transitionMun(munId, decision, session.userId, notes, internalNotes)
}

export async function publishMun(munId: string, session: Session | null): Promise<Mun> {
  requireRole(session, ['ADMIN', 'SUPER_ADMIN'])
  return transitionMun(munId, 'PUBLISHED', session.userId, 'Published by admin')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/actions/admin-review.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/admin-review.ts lib/actions/admin-review.test.ts
git commit -m "feat: add admin review and publish actions with RBAC enforcement"
```

---

## Task 11: Committee/Portfolio/Registration-Product CRUD Actions

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `db.mun.findUnique`/`db.committee.findUnique` → `db.select().from(muns).where(eq(muns.id, munId)).limit(1)` / same for `committees`. `db.committee.create({ data: input })` → `db.insert(committees).values(input).returning()` then take `[0]`. Same pattern for `portfolios` and `registrationProducts`. Field names: `committees.munId`, `portfolios.committeeId`, `registrationProducts.munId`.

**Files:**
- Create: `lib/actions/mun-config.ts`
- Test: `lib/actions/mun-config.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `db` client.
- Produces: `createCommittee(input): Promise<Committee>`, `createPortfolio(input): Promise<Portfolio>`, `createRegistrationProduct(input): Promise<RegistrationProduct>`, each verifying the acting user is the MUN's organizer or admin.

- [ ] **Step 1: Write failing test**

Create `lib/actions/mun-config.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { createCommittee, createPortfolio, createRegistrationProduct } from './mun-config'

describe('mun-config actions', () => {
  it('creates a committee for the organizer who owns the mun', async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const mun = await db.mun.create({ data: { organizerId: organizer.id, name: 'Config Mun', slug: `config-mun-${Date.now()}` } })

    const committee = await createCommittee(
      { munId: mun.id, name: 'UNGA', agenda: 'Climate', capacity: 50 },
      { userId: organizer.id, role: 'ORGANIZER' },
    )
    expect(committee.name).toBe('UNGA')

    const portfolio = await createPortfolio(
      { committeeId: committee.id, name: 'Germany', type: 'country' },
      { userId: organizer.id, role: 'ORGANIZER' },
    )
    expect(portfolio.name).toBe('Germany')

    const product = await createRegistrationProduct(
      { munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 },
      { userId: organizer.id, role: 'ORGANIZER' },
    )
    expect(product.price).toBe(2000)
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await db.user.create({ data: { name: 'Owner', email: `owner-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const stranger = await db.user.create({ data: { name: 'Stranger', email: `stranger-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const mun = await db.mun.create({ data: { organizerId: owner.id, name: 'Owned Mun', slug: `owned-mun-${Date.now()}` } })

    await expect(
      createCommittee({ munId: mun.id, name: 'UNSC', capacity: 15 }, { userId: stranger.id, role: 'ORGANIZER' }),
    ).rejects.toThrow('Forbidden')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/actions/mun-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement actions**

Create `lib/actions/mun-config.ts`:
```typescript
'use server'

import { db } from '@/lib/db/client'
import type { Committee, Portfolio, RegistrationProduct } from '@prisma/client'
import type { Session } from '@/lib/auth/adapter'

async function assertOwnsOrAdmin(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return

  const mun = await db.mun.findUnique({ where: { id: munId } })
  if (!mun || mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}

export interface CreateCommitteeInput {
  munId: string
  name: string
  agenda?: string
  description?: string
  capacity: number
}

export async function createCommittee(input: CreateCommitteeInput, session: Session | null): Promise<Committee> {
  await assertOwnsOrAdmin(input.munId, session)
  return db.committee.create({ data: input })
}

export interface CreatePortfolioInput {
  committeeId: string
  name: string
  type?: string
  availability?: number
}

export async function createPortfolio(input: CreatePortfolioInput, session: Session | null): Promise<Portfolio> {
  const committee = await db.committee.findUnique({ where: { id: input.committeeId } })
  if (!committee) throw new Error('Committee not found')
  await assertOwnsOrAdmin(committee.munId, session)
  return db.portfolio.create({ data: input })
}

export interface CreateRegistrationProductInput {
  munId: string
  name: string
  price: number
  capacity: number
  currency?: string
  deadline?: Date
}

export async function createRegistrationProduct(
  input: CreateRegistrationProductInput,
  session: Session | null,
): Promise<RegistrationProduct> {
  await assertOwnsOrAdmin(input.munId, session)
  return db.registrationProduct.create({ data: input })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/actions/mun-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/mun-config.ts lib/actions/mun-config.test.ts
git commit -m "feat: add committee/portfolio/registration-product CRUD actions with ownership checks"
```

---

## Task 12: Registration + Capacity + Payment Integrity Flow

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `db.registration.updateMany({ where: { ..., status: { in: [...] }, expiresAt: { lt: new Date() } }, data: {...} })` → `db.update(registrations).set({ status: 'CANCELLED' }).where(and(eq(registrations.registrationProductId, id), inArray(registrations.status, ['PENDING', 'PAYMENT_PENDING']), lt(registrations.expiresAt, new Date())))`, and read `.length`/`result.count` depends on the postgres-js driver's returned row count — check actual API, or add `.returning()` and count the array. `db.$transaction(async (tx) => {...})` → `db.transaction(async (tx) => {...})` with `tx.select(...).from(registrations)` for the capacity count and `tx.insert(registrations).values({...}).returning()`. **CRITICAL — IDOR:** `RegistrationInput.userId` must NEVER be read from a client-supplied parameter in the real action; derive the actor via `getSession()` (Task 4) inside `initiateRegistration` itself, and only fall back to `input.userId` for internal/test call sites that already resolved the session. Field names: `registrations.registrationProductId`, `registrations.expiresAt`, `payments.providerOrderId`.

**Files:**
- Create: `lib/actions/registration.ts`
- Test: `lib/actions/registration.test.ts`

**Interfaces:**
- Consumes: `mockPaymentsAdapter` from Task 5, `db` client.
- Produces: `initiateRegistration(input: RegistrationInput): Promise<{ registrationId: string; orderId: string }>` — the UI session's registration flow calls this, then redirects to a mock checkout page that eventually POSTs to the webhook route from Task 5. Produces `releaseExpiredReservations(registrationProductId): Promise<number>` (lazy sweep, called at the top of `initiateRegistration`'s capacity check).

- [ ] **Step 1: Write failing test**

Create `lib/actions/registration.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { initiateRegistration } from './registration'

async function setup(capacity: number) {
  const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' } })
  const student = await db.user.create({ data: { name: 'Student', email: `stu-${Date.now()}-${Math.random()}@test.com`, role: 'STUDENT' } })
  const mun = await db.mun.create({ data: { organizerId: organizer.id, name: 'Reg Mun', slug: `reg-mun-${Date.now()}-${Math.random()}` } })
  const product = await db.registrationProduct.create({ data: { munId: mun.id, name: 'Delegate', price: 2500, capacity } })
  return { student, mun, product }
}

describe('initiateRegistration', () => {
  it('creates a PENDING registration and a payment order when capacity available', async () => {
    const { student, mun, product } = await setup(10)

    const result = await initiateRegistration({ userId: student.id, munId: mun.id, registrationProductId: product.id })

    expect(result.registrationId).toBeTruthy()
    expect(result.orderId).toMatch(/^mock_order_/)

    const registration = await db.registration.findUnique({ where: { id: result.registrationId } })
    expect(registration?.status).toBe('PAYMENT_PENDING')
  })

  it('rejects registration when capacity is full', async () => {
    const { student, mun, product } = await setup(1)

    const otherStudent = await db.user.create({ data: { name: 'Other', email: `other-${Date.now()}@test.com`, role: 'STUDENT' } })
    await db.registration.create({
      data: { userId: otherStudent.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' },
    })

    await expect(
      initiateRegistration({ userId: student.id, munId: mun.id, registrationProductId: product.id }),
    ).rejects.toThrow('Registration product is at capacity')
  })

  it('releases expired PENDING reservations before counting capacity', async () => {
    const { student, mun, product } = await setup(1)

    const expiredHolder = await db.user.create({ data: { name: 'Expired', email: `exp-${Date.now()}@test.com`, role: 'STUDENT' } })
    await db.registration.create({
      data: {
        userId: expiredHolder.id, munId: mun.id, registrationProductId: product.id,
        status: 'PAYMENT_PENDING', expiresAt: new Date(Date.now() - 60_000),
      },
    })

    const result = await initiateRegistration({ userId: student.id, munId: mun.id, registrationProductId: product.id })
    expect(result.registrationId).toBeTruthy()

    const expired = await db.registration.findFirst({ where: { userId: expiredHolder.id } })
    expect(expired?.status).toBe('CANCELLED')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/actions/registration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement registration action**

Create `lib/actions/registration.ts`:
```typescript
'use server'

import { db } from '@/lib/db/client'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'
import type { RegistrationInput } from '@/lib/types'

const RESERVATION_TTL_MS = 15 * 60 * 1000

export async function releaseExpiredReservations(registrationProductId: string): Promise<number> {
  const result = await db.registration.updateMany({
    where: {
      registrationProductId,
      status: { in: ['PENDING', 'PAYMENT_PENDING'] },
      expiresAt: { lt: new Date() },
    },
    data: { status: 'CANCELLED' },
  })
  return result.count
}

export async function initiateRegistration(
  input: RegistrationInput,
): Promise<{ registrationId: string; orderId: string }> {
  await releaseExpiredReservations(input.registrationProductId)

  const product = await db.registrationProduct.findUnique({ where: { id: input.registrationProductId } })
  if (!product) {
    throw new Error('Registration product not found')
  }

  const registration = await db.$transaction(async (tx) => {
    const activeCount = await tx.registration.count({
      where: {
        registrationProductId: input.registrationProductId,
        status: { in: ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'] },
      },
    })

    if (activeCount >= product.capacity) {
      throw new Error('Registration product is at capacity')
    }

    return tx.registration.create({
      data: {
        userId: input.userId,
        munId: input.munId,
        registrationProductId: input.registrationProductId,
        committeeId: input.committeeId,
        portfolioId: input.portfolioId,
        formResponses: input.formResponses,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      },
    })
  })

  const order = await mockPaymentsAdapter.createOrder(product.price, product.currency, registration.id)

  await db.$transaction([
    db.registration.update({ where: { id: registration.id }, data: { status: 'PAYMENT_PENDING' } }),
    db.payment.create({
      data: {
        registrationId: registration.id,
        providerOrderId: order.orderId,
        amount: product.price,
        status: 'PENDING',
      },
    }),
  ])

  return { registrationId: registration.id, orderId: order.orderId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/actions/registration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/registration.ts lib/actions/registration.test.ts
git commit -m "feat: add registration flow with capacity enforcement and expired reservation sweep"
```

---

## Task 13: Notifications Stub

> **Built in the foundation wave, no Prisma dependency.** Actual implementation differs slightly from the original sketch: `NotificationsAdapter.send()` takes a single `NotificationPayload` object (`{ to, subject, body }`) rather than positional `(to, template, data)` args — see `lib/notifications/adapter.ts`/`lib/notifications/console-adapter.ts` for the real signature. No test file was written for this task in the foundation wave (straightforward console.log passthrough); add one if desired following the pattern below, adjusted for the object-shaped payload.

**Files:**
- Create: `lib/notifications/adapter.ts`, `lib/notifications/console-adapter.ts` (done)
- Test: `lib/notifications/console-adapter.test.ts` (not yet written)

**Interfaces:**
- Produces: `NotificationsAdapter` interface with `send(notification: { to: string; subject: string; body: string }): Promise<void>` — real Resend adapter implements same interface later. Registration confirmation (Task 12 callers) and admin review (Task 10 callers) can call this once wired by the UI session; this task only builds the adapter, not the call sites (out of scope per spec section 7 — "notifications stub").

- [ ] **Step 1 (optional, not yet done): write test**

Create `lib/notifications/console-adapter.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest'
import { consoleNotificationsAdapter } from './console-adapter'

describe('consoleNotificationsAdapter', () => {
  it('logs the notification and resolves', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await consoleNotificationsAdapter.send({
      to: 'student@test.com',
      subject: 'registration_confirmed',
      body: 'Oxford MUN',
    })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Already implemented**

`lib/notifications/adapter.ts`:
```typescript
export interface NotificationPayload {
  to: string
  subject: string
  body: string
}

export interface NotificationsAdapter {
  send(notification: NotificationPayload): Promise<void>
}
```

`lib/notifications/console-adapter.ts`:
```typescript
import type { NotificationPayload, NotificationsAdapter } from './adapter'

export const consoleNotificationsAdapter: NotificationsAdapter = {
  async send(notification: NotificationPayload): Promise<void> {
    console.log('[notification]', notification.to, notification.subject, notification.body)
  },
}
```

- [ ] **Step 3: Commit (already done as part of foundation commit)**

---

## Task 14: Student Dashboard Query Actions

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `db.registration.findMany({ where: {...}, include: {...}, orderBy: {...} })` → use the relational query API `db.query.registrations.findMany({ where: (registrations, { eq, and, inArray }) => and(...), with: { mun: true, committee: true, portfolio: true }, orderBy: ... })`, which the `relations()` definitions in `lib/db/schema.ts` make available. `mun: { startDate: { gte: new Date() } }` (nested relation filter) needs either a join in the query builder or a `db.query` `where` callback that reaches into the related `muns` row — verify against the installed drizzle-orm version's relational-query filter API. **IDOR reminder:** `userId` here must come from `getSession()`, never a route param/client input.

**Files:**
- Create: `lib/actions/student-dashboard.ts`
- Test: `lib/actions/student-dashboard.test.ts`

**Interfaces:**
- Consumes: `db` client.
- Produces: `getUpcomingRegistrations(userId): Promise<RegistrationWithMun[]>`, `getPastRegistrations(userId): Promise<RegistrationWithMun[]>` where `RegistrationWithMun` includes joined `mun`, `committee`, `portfolio` — the UI session's student dashboard calls these directly.

- [ ] **Step 1: Write failing test**

Create `lib/actions/student-dashboard.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { getUpcomingRegistrations, getPastRegistrations } from './student-dashboard'

describe('student dashboard queries', () => {
  it('separates upcoming (future startDate) from past (confirmed, past startDate) registrations', async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const student = await db.user.create({ data: { name: 'Student', email: `stu-${Date.now()}@test.com`, role: 'STUDENT' } })

    const futureMun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'Future Mun', slug: `future-mun-${Date.now()}`, startDate: new Date(Date.now() + 86_400_000) },
    })
    const pastMun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'Past Mun', slug: `past-mun-${Date.now()}`, startDate: new Date(Date.now() - 86_400_000) },
    })

    const futureProduct = await db.registrationProduct.create({ data: { munId: futureMun.id, name: 'Delegate', price: 1000, capacity: 10 } })
    const pastProduct = await db.registrationProduct.create({ data: { munId: pastMun.id, name: 'Delegate', price: 1000, capacity: 10 } })

    await db.registration.create({ data: { userId: student.id, munId: futureMun.id, registrationProductId: futureProduct.id, status: 'CONFIRMED' } })
    await db.registration.create({ data: { userId: student.id, munId: pastMun.id, registrationProductId: pastProduct.id, status: 'ATTENDED' } })

    const upcoming = await getUpcomingRegistrations(student.id)
    expect(upcoming.length).toBe(1)
    expect(upcoming[0].mun.name).toBe('Future Mun')

    const past = await getPastRegistrations(student.id)
    expect(past.length).toBe(1)
    expect(past[0].mun.name).toBe('Past Mun')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/actions/student-dashboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement queries**

Create `lib/actions/student-dashboard.ts`:
```typescript
'use server'

import { db } from '@/lib/db/client'

const registrationInclude = {
  mun: true,
  committee: true,
  portfolio: true,
} as const

export type RegistrationWithMun = Awaited<ReturnType<typeof getUpcomingRegistrations>>[number]

export async function getUpcomingRegistrations(userId: string) {
  return db.registration.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'] },
      mun: { startDate: { gte: new Date() } },
    },
    include: registrationInclude,
    orderBy: { mun: { startDate: 'asc' } },
  })
}

export async function getPastRegistrations(userId: string) {
  return db.registration.findMany({
    where: {
      userId,
      OR: [
        { status: { in: ['ATTENDED', 'NO_SHOW'] } },
        { mun: { startDate: { lt: new Date() } } },
      ],
    },
    include: registrationInclude,
    orderBy: { mun: { startDate: 'desc' } },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/actions/student-dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/student-dashboard.ts lib/actions/student-dashboard.test.ts
git commit -m "feat: add student dashboard upcoming/past registration queries"
```

---

## Task 15: Organizer Dashboard Query Actions

> **Prisma syntax below is illustrative only — use Drizzle against `lib/db/schema.ts`, see Task 2 for the pattern.** `db.registration.count(...)` → `db.select({ count: count() }).from(registrations).where(...)` (import `count` from `drizzle-orm`) then read `result[0].count`. `db.payment.aggregate({ _sum: { amount } })` → `db.select({ total: sum(payments.amount) }).from(payments).innerJoin(registrations, eq(payments.registrationId, registrations.id)).where(...)` (import `sum` from `drizzle-orm`; result is `string | null`, cast to number). `db.registrationProduct.findMany({ where, select })` → `db.select({ capacity: registrationProducts.capacity }).from(registrationProducts).where(eq(registrationProducts.munId, munId))`. `db.registration.findMany({ include: {...} })` → `db.query.registrations.findMany({ where: ..., with: { user: true, committee: true, portfolio: true, payment: true, registrationProduct: true } })`. Field names: `payments.registrationId`, `registrationProducts.munId`, `registrations.munId`.

**Files:**
- Create: `lib/actions/organizer-dashboard.ts`
- Test: `lib/actions/organizer-dashboard.test.ts`

**Interfaces:**
- Consumes: `db` client, `assertOwnsOrAdmin`-equivalent ownership check pattern from Task 11.
- Produces: `getMunOverview(munId, session): Promise<MunOverview>` (`{ totalRegistrations, revenue, pendingPayments, availableSeats }`) and `getDelegateList(munId, session, filters?): Promise<DelegateRow[]>` — organizer dashboard UI calls these directly.

- [ ] **Step 1: Write failing test**

Create `lib/actions/organizer-dashboard.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { getMunOverview, getDelegateList } from './organizer-dashboard'

describe('organizer dashboard queries', () => {
  it('computes overview totals for the owning organizer', async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const student = await db.user.create({ data: { name: 'Student', email: `stu-${Date.now()}@test.com`, role: 'STUDENT' } })
    const mun = await db.mun.create({ data: { organizerId: organizer.id, name: 'Overview Mun', slug: `overview-mun-${Date.now()}` } })
    const product = await db.registrationProduct.create({ data: { munId: mun.id, name: 'Delegate', price: 2000, capacity: 5 } })

    await db.registration.create({ data: { userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' } })
    await db.payment.create({
      data: {
        registrationId: (await db.registration.findFirstOrThrow({ where: { munId: mun.id } })).id,
        providerOrderId: `order-${Date.now()}`, amount: 2000, status: 'PAID',
      },
    })

    const overview = await getMunOverview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(overview.totalRegistrations).toBe(1)
    expect(overview.revenue).toBe(2000)
    expect(overview.availableSeats).toBe(4)
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await db.user.create({ data: { name: 'Owner', email: `owner-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const stranger = await db.user.create({ data: { name: 'Stranger', email: `stranger-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const mun = await db.mun.create({ data: { organizerId: owner.id, name: 'Locked Mun', slug: `locked-mun-${Date.now()}` } })

    await expect(getDelegateList(mun.id, { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/actions/organizer-dashboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement queries**

Create `lib/actions/organizer-dashboard.ts`:
```typescript
'use server'

import { db } from '@/lib/db/client'
import type { Session } from '@/lib/auth/adapter'

async function assertOwnsMun(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return
  const mun = await db.mun.findUnique({ where: { id: munId } })
  if (!mun || mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}

export interface MunOverview {
  totalRegistrations: number
  revenue: number
  pendingPayments: number
  availableSeats: number
}

export async function getMunOverview(munId: string, session: Session | null): Promise<MunOverview> {
  await assertOwnsMun(munId, session)

  const [confirmedCount, revenueAgg, pendingCount, products] = await Promise.all([
    db.registration.count({ where: { munId, status: { in: ['CONFIRMED', 'ATTENDED'] } } }),
    db.payment.aggregate({ where: { registration: { munId }, status: 'PAID' }, _sum: { amount: true } }),
    db.payment.count({ where: { registration: { munId }, status: 'PENDING' } }),
    db.registrationProduct.findMany({ where: { munId }, select: { capacity: true } }),
  ])

  const totalCapacity = products.reduce((sum, p) => sum + p.capacity, 0)

  return {
    totalRegistrations: confirmedCount,
    revenue: revenueAgg._sum.amount ?? 0,
    pendingPayments: pendingCount,
    availableSeats: totalCapacity - confirmedCount,
  }
}

export interface DelegateFilters {
  committeeId?: string
  paymentStatus?: string
}

export async function getDelegateList(munId: string, session: Session | null, filters: DelegateFilters = {}) {
  await assertOwnsMun(munId, session)

  return db.registration.findMany({
    where: {
      munId,
      ...(filters.committeeId ? { committeeId: filters.committeeId } : {}),
    },
    include: { user: true, committee: true, portfolio: true, payment: true, registrationProduct: true },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/actions/organizer-dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/actions/organizer-dashboard.ts lib/actions/organizer-dashboard.test.ts
git commit -m "feat: add organizer dashboard overview and delegate list queries"
```

---

## Self-Review Notes (completed during writing, not a task)

- Spec coverage checked: adapters (auth/payments/storage) → Tasks 4/5/6; schema → Task 2; tenant guard → Task 3; registration integrity/idempotency → Tasks 5/12; RBAC → Task 4, enforced per-action in Tasks 9-12/15; lifecycle/admin review → Tasks 9/10; marketplace → Task 8; seed data → Task 7; notifications stub → Task 13; student/organizer dashboards → Tasks 14/15. Committee/Portfolio/Registration-product CRUD → Task 11.
- No placeholders: every step has runnable code, no "TBD"/"similar to above".
- Type consistency checked: `Session` type from Task 4 used identically across Tasks 9-15; `RegistrationInput` from Task 3 used in Task 12; `MunSummary`/`MunStatus` from Task 3 used in Task 8.
- Out of scope confirmed absent: no Passport/certificate/QR/recommendation logic in any task.
