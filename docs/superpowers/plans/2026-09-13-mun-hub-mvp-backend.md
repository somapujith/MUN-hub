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

## Task 2: Prisma Schema (All MVP Entities + Enums)

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db/client.ts`
- Test: `lib/db/client.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var from Task 1.
- Produces: `PrismaClient` singleton export `import { db } from '@/lib/db/client'`. All later tasks import `db` from here — never instantiate `PrismaClient` directly elsewhere.
- Produces: Prisma models `User`, `Mun`, `Committee`, `Portfolio`, `RegistrationProduct`, `Registration`, `Payment`, `OrganizerApplication`, `VerificationLog`, `Certificate`, `Achievement` and enums `Role`, `MunStatus`, `RegistrationStatus`, `PaymentStatus`.

- [ ] **Step 1: Write the schema**

Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  STUDENT
  ORGANIZER
  OPERATIONS
  ADMIN
  SUPER_ADMIN
}

enum MunStatus {
  DRAFT
  SUBMITTED
  UNDER_REVIEW
  APPROVED
  REJECTED
  CHANGES_REQUESTED
  ONBOARDING
  CONTENT_SUBMITTED
  VERIFICATION
  PUBLISHED
  REGISTRATION_OPEN
  REGISTRATION_CLOSED
  CONFERENCE_ACTIVE
  COMPLETED
  ARCHIVED
}

enum RegistrationStatus {
  PENDING
  PAYMENT_PENDING
  CONFIRMED
  CANCELLED
  REFUNDED
  ATTENDED
  NO_SHOW
}

enum PaymentStatus {
  CREATED
  PENDING
  PAID
  FAILED
  REFUNDED
}

enum ApplicationStatus {
  SUBMITTED
  APPROVED
  REJECTED
  CHANGES_REQUESTED
}

model User {
  id             String    @id @default(cuid())
  name           String
  email          String    @unique
  phone          String?
  role           Role      @default(STUDENT)
  username       String?   @unique
  institution    String?
  profileImage   String?
  createdAt      DateTime  @default(now())

  organizedMuns       Mun[]                 @relation("MunOrganizer")
  registrations       Registration[]
  organizerApplications OrganizerApplication[]
  certificates        Certificate[]
  achievements        Achievement[]
  verificationLogs    VerificationLog[]      @relation("ReviewerLogs")
}

model Mun {
  id            String    @id @default(cuid())
  organizerId   String
  organizer     User      @relation("MunOrganizer", fields: [organizerId], references: [id])
  name          String
  slug          String    @unique
  edition       String?
  theme         String?
  description   String?
  startDate     DateTime?
  endDate       DateTime?
  venue         String?
  city          String?
  country       String?
  status        MunStatus @default(DRAFT)
  publishedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  committees            Committee[]
  registrationProducts  RegistrationProduct[]
  registrations         Registration[]
  certificates          Certificate[]
  achievements          Achievement[]
  verificationLogs      VerificationLog[]
  organizerApplication  OrganizerApplication?

  @@index([status])
  @@index([organizerId])
}

model Committee {
  id          String   @id @default(cuid())
  munId       String
  mun         Mun      @relation(fields: [munId], references: [id], onDelete: Cascade)
  name        String
  agenda      String?
  description String?
  capacity    Int      @default(0)
  createdAt   DateTime @default(now())

  portfolios     Portfolio[]
  registrations  Registration[]

  @@index([munId])
}

model Portfolio {
  id           String   @id @default(cuid())
  committeeId  String
  committee    Committee @relation(fields: [committeeId], references: [id], onDelete: Cascade)
  name         String
  type         String?
  availability Int      @default(1)
  createdAt    DateTime @default(now())

  registrations Registration[]

  @@index([committeeId])
}

model RegistrationProduct {
  id        String   @id @default(cuid())
  munId     String
  mun       Mun      @relation(fields: [munId], references: [id], onDelete: Cascade)
  name      String
  price     Int
  currency  String   @default("INR")
  capacity  Int
  deadline  DateTime?
  status    String   @default("active")
  createdAt DateTime @default(now())

  registrations Registration[]

  @@index([munId])
}

model Registration {
  id                     String              @id @default(cuid())
  userId                 String
  user                   User                @relation(fields: [userId], references: [id])
  munId                  String
  mun                    Mun                 @relation(fields: [munId], references: [id])
  registrationProductId  String
  registrationProduct    RegistrationProduct @relation(fields: [registrationProductId], references: [id])
  committeeId            String?
  committee              Committee?          @relation(fields: [committeeId], references: [id])
  portfolioId            String?
  portfolio              Portfolio?          @relation(fields: [portfolioId], references: [id])
  formResponses          Json?
  status                 RegistrationStatus  @default(PENDING)
  expiresAt              DateTime?
  createdAt              DateTime            @default(now())
  updatedAt              DateTime            @updatedAt

  payment  Payment?
  certificates Certificate[]
  achievements Achievement[]

  @@index([munId, status])
  @@index([registrationProductId, status])
  @@index([userId])
}

model Payment {
  id                 String        @id @default(cuid())
  registrationId     String        @unique
  registration       Registration  @relation(fields: [registrationId], references: [id])
  provider           String        @default("mock_razorpay")
  providerOrderId    String        @unique
  providerPaymentId  String?
  amount             Int
  status             PaymentStatus @default(CREATED)
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
}

model Certificate {
  id                  String   @id @default(cuid())
  userId              String
  user                User     @relation(fields: [userId], references: [id])
  munId               String
  mun                 Mun      @relation(fields: [munId], references: [id])
  registrationId      String
  registration        Registration @relation(fields: [registrationId], references: [id])
  certificateUrl      String?
  verificationStatus  String   @default("unverified")
  createdAt           DateTime @default(now())
}

model Achievement {
  id                  String   @id @default(cuid())
  userId              String
  user                User     @relation(fields: [userId], references: [id])
  munId               String
  mun                 Mun      @relation(fields: [munId], references: [id])
  registrationId      String
  registration        Registration @relation(fields: [registrationId], references: [id])
  committee           String?
  portfolio            String?
  award                String?
  verificationStatus  String   @default("unverified")
  createdAt           DateTime @default(now())
}

model OrganizerApplication {
  id           String             @id @default(cuid())
  organizerId  String             @unique
  organizer    User               @relation(fields: [organizerId], references: [id])
  munId        String?            @unique
  mun          Mun?               @relation(fields: [munId], references: [id])
  status       ApplicationStatus  @default(SUBMITTED)
  reviewNotes  String?
  submittedAt  DateTime           @default(now())
}

model VerificationLog {
  id          String   @id @default(cuid())
  munId       String
  mun         Mun      @relation(fields: [munId], references: [id], onDelete: Cascade)
  reviewerId  String
  reviewer    User     @relation("ReviewerLogs", fields: [reviewerId], references: [id])
  action      String
  notes       String?
  internalNotes String?
  createdAt   DateTime @default(now())

  @@index([munId])
}
```

- [ ] **Step 2: Run migration**

Run: `npm run db:up && npm run db:migrate -- --name init`
Expected: migration succeeds, `prisma/migrations/` created, no errors.

- [ ] **Step 3: Write DB client singleton**

Create `lib/db/client.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
```

- [ ] **Step 4: Write failing test for client connectivity**

Create `lib/db/client.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { db } from './client'

describe('db client', () => {
  it('connects and can run a query', async () => {
    const result = await db.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`
    expect(result[0].ok).toBe(1)
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/db/client.test.ts`
Expected: PASS (requires `npm run db:up` and `npm run db:migrate` already run).

- [ ] **Step 6: Commit**

```bash
git add prisma lib/db
git commit -m "feat: add Prisma schema for all MVP entities and DB client singleton"
```

---

## Task 3: Shared Types + Tenant Guard

**Files:**
- Create: `lib/types/mun.ts`, `lib/types/registration.ts`, `lib/types/user.ts`, `lib/types/index.ts`
- Create: `lib/db/tenant-guard.ts`
- Test: `lib/db/tenant-guard.test.ts`

**Interfaces:**
- Consumes: Prisma models from Task 2 (`db` client).
- Produces: `withTenant<T>(munId: string, query: (tx: typeof db) => Promise<T>): Promise<T>` — every tenant-scoped read/write in later tasks wraps its query with this. Produces re-exported types `MunSummary`, `MunDetail`, `RegistrationInput`, `PublicUser` from `lib/types/index.ts` for the UI session to import.

- [ ] **Step 1: Write failing test for tenant guard**

Create `lib/db/tenant-guard.test.ts`:
```typescript
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from './client'
import { assertMunExists } from './tenant-guard'

describe('tenant-guard', () => {
  let munId: string

  beforeAll(async () => {
    const organizer = await db.user.create({
      data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' },
    })
    const mun = await db.mun.create({
      data: { organizerId: organizer.id, name: 'Test Mun', slug: `test-mun-${Date.now()}` },
    })
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
    await db.$disconnect()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/db/tenant-guard.test.ts`
Expected: FAIL — `assertMunExists` not defined.

- [ ] **Step 3: Implement tenant guard**

Create `lib/db/tenant-guard.ts`:
```typescript
import { db } from './client'
import type { Mun } from '@prisma/client'

export async function assertMunExists(munId: string): Promise<Mun> {
  const mun = await db.mun.findUnique({ where: { id: munId } })
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
import type { Mun, MunStatus } from '@prisma/client'

export type MunSummary = Pick<Mun, 'id' | 'name' | 'slug' | 'city' | 'country' | 'startDate' | 'endDate' | 'status'>

export type MunDetail = Mun & {
  committees: Array<{ id: string; name: string; capacity: number }>
  registrationProducts: Array<{ id: string; name: string; price: number; capacity: number }>
}

export type { MunStatus }
```

Create `lib/types/registration.ts`:
```typescript
import type { RegistrationStatus } from '@prisma/client'

export interface RegistrationInput {
  userId: string
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
import type { Role } from '@prisma/client'

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

**Files:**
- Create: `lib/auth/adapter.ts`, `lib/auth/mock-adapter.ts`, `lib/auth/authorize.ts`, `lib/auth/session.ts`
- Test: `lib/auth/authorize.test.ts`

**Interfaces:**
- Consumes: `Role` enum from Task 2, `db` client.
- Produces: `getSession(): Promise<{ userId: string; role: Role } | null>` from `lib/auth/session.ts` — every server action in later tasks calls this to identify the actor. Produces `requireRole(session, allowedRoles: Role[]): void` from `lib/auth/authorize.ts` — throws `Error('Forbidden')` if role not allowed. Produces `AuthAdapter` interface with `signIn`, `signOut`, `getCurrentUserId` methods — real Supabase adapter implements same interface later.

- [ ] **Step 1: Write failing test for authorize**

Create `lib/auth/authorize.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
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
import type { Role } from '@prisma/client'

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

- [ ] **Step 4: Implement mock adapter**

Create `lib/auth/mock-adapter.ts`:
```typescript
import { db } from '@/lib/db/client'
import type { AuthAdapter, Session } from './adapter'

export const mockAuthAdapter: AuthAdapter = {
  async signIn(email: string): Promise<Session> {
    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      throw new Error('Invalid credentials')
    }
    return { userId: user.id, role: user.role }
  },

  async signOut(): Promise<void> {
    return
  },

  async getCurrentUserId(sessionToken: string): Promise<string | null> {
    return sessionToken || null
  },
}
```

- [ ] **Step 5: Implement session + authorize helpers**

Create `lib/auth/session.ts`:
```typescript
import { cookies } from 'next/headers'
import { db } from '@/lib/db/client'
import type { Session } from './adapter'

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const userId = cookieStore.get('mun_hub_session')?.value
  if (!userId) return null

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return null

  return { userId: user.id, role: user.role }
}
```

Create `lib/auth/authorize.ts`:
```typescript
import type { Role } from '@prisma/client'
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
git commit -m "feat: add mock auth adapter and role authorization helper"
```

---

## Task 5: Mock Payments Adapter + Webhook Route

**Files:**
- Create: `lib/payments/adapter.ts`, `lib/payments/mock-adapter.ts`
- Create: `app/api/webhooks/payments/route.ts`
- Test: `lib/payments/mock-adapter.test.ts`, `app/api/webhooks/payments/route.test.ts`

**Interfaces:**
- Consumes: `db` client, `Payment`/`Registration` models from Task 2.
- Produces: `PaymentsAdapter` interface with `createOrder(amount, currency, registrationId): Promise<{ orderId: string }>` and `verifyWebhookSignature(payload, signature): boolean` — real Razorpay adapter implements same interface later. Produces route handler `POST /api/webhooks/payments` that later tasks' registration flow triggers indirectly (mock adapter self-fires it in dev/test via direct call, not HTTP, to keep tests fast).

- [ ] **Step 1: Write failing test for mock adapter**

Create `lib/payments/mock-adapter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { mockPaymentsAdapter } from './mock-adapter'
import crypto from 'node:crypto'

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

- [ ] **Step 4: Implement mock adapter**

Create `lib/payments/mock-adapter.ts`:
```typescript
import crypto from 'node:crypto'
import type { PaymentsAdapter, PaymentOrder } from './adapter'

function getWebhookSecret(): string {
  const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('MOCK_PAYMENT_WEBHOOK_SECRET not configured')
  }
  return secret
}

export const mockPaymentsAdapter: PaymentsAdapter = {
  async createOrder(_amount: number, _currency: string, registrationId: string): Promise<PaymentOrder> {
    return { orderId: `mock_order_${registrationId}_${Date.now()}` }
  },

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', getWebhookSecret()).update(payload).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.padEnd(expected.length, '0').slice(0, expected.length)))
      && expected === signature
  },
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/payments/mock-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Write failing test for webhook route**

Create `app/api/webhooks/payments/route.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import { db } from '@/lib/db/client'
import { POST } from './route'

describe('POST /api/webhooks/payments', () => {
  let registrationId: string
  let orderId: string

  beforeAll(async () => {
    const organizer = await db.user.create({ data: { name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' } })
    const student = await db.user.create({ data: { name: 'Student', email: `student-${Date.now()}@test.com`, role: 'STUDENT' } })
    const mun = await db.mun.create({ data: { organizerId: organizer.id, name: 'Webhook Mun', slug: `webhook-mun-${Date.now()}` } })
    const product = await db.registrationProduct.create({ data: { munId: mun.id, name: 'Delegate', price: 2500, capacity: 10 } })
    const registration = await db.registration.create({
      data: { userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PAYMENT_PENDING' },
    })
    registrationId = registration.id
    orderId = `mock_order_${registrationId}_test`
    await db.payment.create({
      data: { registrationId, providerOrderId: orderId, amount: 2500, status: 'PENDING' },
    })
  })

  it('confirms registration on valid signed webhook', async () => {
    const body = JSON.stringify({ orderId, status: 'paid', providerPaymentId: 'mock_pay_1' })
    const signature = crypto.createHmac('sha256', process.env.MOCK_PAYMENT_WEBHOOK_SECRET!).update(body).digest('hex')

    const req = new Request('http://localhost/api/webhooks/payments', {
      method: 'POST',
      headers: { 'x-mock-signature': signature, 'content-type': 'application/json' },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const registration = await db.registration.findUnique({ where: { id: registrationId } })
    expect(registration?.status).toBe('CONFIRMED')

    const payment = await db.payment.findUnique({ where: { registrationId } })
    expect(payment?.status).toBe('PAID')
  })

  it('rejects webhook with invalid signature', async () => {
    const body = JSON.stringify({ orderId, status: 'paid' })
    const req = new Request('http://localhost/api/webhooks/payments', {
      method: 'POST',
      headers: { 'x-mock-signature': 'invalid', 'content-type': 'application/json' },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  afterAll(async () => {
    await db.$disconnect()
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test -- app/api/webhooks/payments/route.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 8: Implement webhook route handler**

Create `app/api/webhooks/payments/route.ts`:
```typescript
import { db } from '@/lib/db/client'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'

export async function POST(req: Request): Promise<Response> {
  const body = await req.text()
  const signature = req.headers.get('x-mock-signature') ?? ''

  if (!mockPaymentsAdapter.verifyWebhookSignature(body, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const { orderId, providerPaymentId } = JSON.parse(body) as { orderId: string; providerPaymentId?: string }

  const payment = await db.payment.findUnique({ where: { providerOrderId: orderId } })
  if (!payment) {
    return Response.json({ error: 'Payment not found' }, { status: 404 })
  }

  if (payment.status === 'PAID') {
    return Response.json({ ok: true, alreadyConfirmed: true }, { status: 200 })
  }

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', providerPaymentId },
    }),
    db.registration.update({
      where: { id: payment.registrationId },
      data: { status: 'CONFIRMED' },
    }),
  ])

  return Response.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test -- app/api/webhooks/payments/route.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add lib/payments app/api/webhooks
git commit -m "feat: add mock payments adapter and idempotent webhook handler"
```

---

## Task 6: Mock Storage Adapter

**Files:**
- Create: `lib/storage/adapter.ts`, `lib/storage/mock-adapter.ts`
- Test: `lib/storage/mock-adapter.test.ts`

**Interfaces:**
- Produces: `StorageAdapter` interface with `upload(file: Buffer, key: string, contentType: string): Promise<{ url: string }>` and `delete(key: string): Promise<void>` — real R2 adapter implements same interface later.

- [ ] **Step 1: Write failing test**

Create `lib/storage/mock-adapter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
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
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/storage
git commit -m "feat: add mock storage adapter"
```

---

## Task 7: Seed Script

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (add `tsx` dependency)

**Interfaces:**
- Consumes: all Prisma models from Task 2.
- Produces: `npm run db:seed` populates 3 users (1 admin, 1 organizer, 1 student), 2 published MUNs each with 2 committees, 2 portfolios per committee, 2 registration products. UI session and later backend tasks rely on this fixture data existing for manual testing.

- [ ] **Step 1: Install tsx**

```bash
npm install -D tsx
```

- [ ] **Step 2: Write seed script**

Create `prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const admin = await db.user.upsert({
    where: { email: 'admin@munhub.test' },
    update: {},
    create: { name: 'Platform Admin', email: 'admin@munhub.test', role: 'ADMIN' },
  })

  const organizer = await db.user.upsert({
    where: { email: 'organizer@munhub.test' },
    update: {},
    create: { name: 'Oxford MUN Society', email: 'organizer@munhub.test', role: 'ORGANIZER' },
  })

  await db.user.upsert({
    where: { email: 'student@munhub.test' },
    update: {},
    create: { name: 'Asha Verma', email: 'student@munhub.test', role: 'STUDENT', institution: 'VIT Vellore', city: 'Vellore' } as never,
  })

  for (const [i, name] of ['Oxford MUN 2027', 'VIT MUN 2027'].entries()) {
    const mun = await db.mun.upsert({
      where: { slug: `mun-${i}-${name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: {
        organizerId: organizer.id,
        name,
        slug: `mun-${i}-${name.toLowerCase().replace(/\s+/g, '-')}`,
        edition: '2027',
        theme: 'Diplomacy in a Fractured World',
        description: `${name} brings together delegates from across the region.`,
        startDate: new Date('2027-03-10'),
        endDate: new Date('2027-03-12'),
        city: i === 0 ? 'Oxford' : 'Vellore',
        country: i === 0 ? 'UK' : 'India',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    })

    for (const committeeName of ['UNSC', 'UNHRC']) {
      const committee = await db.committee.create({
        data: { munId: mun.id, name: committeeName, agenda: 'Sample agenda', capacity: 30 },
      })

      await db.portfolio.createMany({
        data: [
          { committeeId: committee.id, name: 'United States', type: 'country', availability: 1 },
          { committeeId: committee.id, name: 'France', type: 'country', availability: 1 },
        ],
      })
    }

    await db.registrationProduct.createMany({
      data: [
        { munId: mun.id, name: 'Delegate', price: 2500, capacity: 200 },
        { munId: mun.id, name: 'Press', price: 1500, capacity: 20 },
      ],
    })
  }

  console.log('Seed complete. Admin:', admin.email)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
```

- [ ] **Step 3: Run seed and verify**

Run: `npm run db:seed`
Expected: "Seed complete. Admin: admin@munhub.test" logged, no errors.

Verify: `npm run db:studio` opens Prisma Studio, shows 3 users, 2 MUNs, 4 committees, 8 portfolios, 4 registration products.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts package.json package-lock.json
git commit -m "feat: add seed script with demo MUNs, committees, portfolios"
```

---

## Task 8: Marketplace Query Layer (Search/Filter/Sort)

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

**Files:**
- Create: `lib/notifications/adapter.ts`, `lib/notifications/console-adapter.ts`
- Test: `lib/notifications/console-adapter.test.ts`

**Interfaces:**
- Produces: `NotificationsAdapter` interface with `send(to: string, template: string, data: Record<string, unknown>): Promise<void>` — real Resend adapter implements same interface later. Registration confirmation (Task 12 callers) and admin review (Task 10 callers) can call this once wired by the UI session; this task only builds the adapter, not the call sites (out of scope per spec section 7 — "notifications stub").

- [ ] **Step 1: Write failing test**

Create `lib/notifications/console-adapter.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { consoleNotificationsAdapter } from './console-adapter'

describe('consoleNotificationsAdapter', () => {
  it('logs the notification and resolves', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await consoleNotificationsAdapter.send('student@test.com', 'registration_confirmed', { munName: 'Oxford MUN' })

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('registration_confirmed'),
      expect.objectContaining({ munName: 'Oxford MUN' }),
    )
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/notifications/console-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement adapter**

Create `lib/notifications/adapter.ts`:
```typescript
export interface NotificationsAdapter {
  send(to: string, template: string, data: Record<string, unknown>): Promise<void>
}
```

Create `lib/notifications/console-adapter.ts`:
```typescript
import type { NotificationsAdapter } from './adapter'

export const consoleNotificationsAdapter: NotificationsAdapter = {
  async send(to: string, template: string, data: Record<string, unknown>): Promise<void> {
    console.log(`[notify] to=${to} template=${template}`, data)
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/notifications/console-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/notifications
git commit -m "feat: add console-logging notifications adapter stub"
```

---

## Task 14: Student Dashboard Query Actions

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
