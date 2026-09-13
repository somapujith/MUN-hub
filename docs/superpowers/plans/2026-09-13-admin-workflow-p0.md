# Admin Workflow P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 7 new admin-workflow tracks from the P0 spec (nav shell,
general audit log, organizer management, MUN unpublish/suspend, registration
+payment monitoring, refunds, support tickets) on top of the existing
admin-review/verification/RBAC foundation.

**Architecture:** Drizzle schema additions in one migration, thin lifecycle
functions following the existing `transitionMun` row-lock pattern, Server
Actions gated by `requireRole`, App Router pages under `app/admin/*` nested
in a new layout.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM + `postgres`
driver, Tailwind/shadcn, Vitest (integration tests against local Docker
Postgres per `vitest.setup.ts`/`.env.test`).

**Spec:** `docs/superpowers/specs/2026-09-13-admin-workflow-p0-design.md`

## Global Constraints

- Never trust a client-supplied `userId` or role — derive actor identity
  from `getSession()` server-side only, gate every mutating action with
  `requireRole(session, [...])` from `lib/auth/authorize.ts`.
- Every state transition that has a row-lock hazard (two admins acting on
  the same row concurrently) must use `db.transaction` + `.for('update')`,
  matching `lib/lifecycle/mun-state-machine.ts:66-99`.
- `admin_actions` rows are append-only — insert only, inside the same
  transaction as the change they record, never a separate fire-and-forget
  write.
- Tests run via `npm test` against local Docker Postgres (`npm run db:up`
  first if not already running) — never against `.env`'s Neon URL. `tsc
  --noEmit` must stay clean.
- Migrations: generate with drizzle-kit, apply to local Docker first (for
  tests), then to Neon, per existing project convention.
- Money amounts are integers in paise, matching `payments.amount` /
  `registrationProducts` pricing already in the codebase.
- Commit format: `<type>: <description>` (feat/fix/refactor/docs/test/chore),
  ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## Task 1: Schema migration — new tables, enums, columns

**Files:**
- Modify: `lib/db/schema-enums.ts` (add 6 new enums, extend `munStatusEnum`)
- Modify: `lib/db/schema.ts` (add 3 new tables, 3 new columns on `users`)
- Create: migration via `npx drizzle-kit generate` (writes to existing
  `drizzle/` migrations folder — check `drizzle.config.ts` for exact path
  if unfamiliar)
- Test: `lib/db/schema.test.ts` (create if it doesn't exist — check first)

**Interfaces:**
- Produces: `adminActionEnum`/`AdminAction` type, `refundStatusEnum`/
  `RefundStatus` type, `supportCategoryEnum`/`SupportCategory` type,
  `supportPriorityEnum`/`SupportPriority` type, `supportStatusEnum`/
  `SupportStatus` type, extended `MunStatus` (adds `'SUSPENDED'`),
  `adminActions` table, `refundRequests` table, `supportTickets` table,
  `users.suspended`/`suspendedReason`/`suspendedAt` columns.

- [ ] **Step 1: Add new enums to schema-enums.ts**

Add after the existing `accommodationFieldTypeEnum` block (before the type
exports at the bottom):

```ts
export const adminActionEnum = pgEnum('admin_action', [
  'ORGANIZER_SUSPENDED',
  'ORGANIZER_REINSTATED',
  'MUN_UNPUBLISHED',
  'MUN_SUSPENDED',
  'REFUND_APPROVED',
  'REFUND_REJECTED',
  'TICKET_ASSIGNED',
  'TICKET_RESOLVED',
  'USER_SUSPENDED',
])

export const refundStatusEnum = pgEnum('refund_status', [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'REFUNDED',
])

export const supportCategoryEnum = pgEnum('support_category', [
  'REGISTRATION',
  'PAYMENT',
  'REFUND',
  'MUN_INFO',
  'ACCOUNT',
  'CERTIFICATE',
  'ORGANIZER',
  'TECHNICAL',
  'SAFETY_POLICY',
])

export const supportPriorityEnum = pgEnum('support_priority', [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
])

export const supportStatusEnum = pgEnum('support_status', [
  'NEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING',
  'RESOLVED',
  'CLOSED',
])
```

Modify `munStatusEnum` — add `'SUSPENDED'` right after `'CANCELLED'`:

```ts
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
  'SUSPENDED',
])
```

Add to the type exports at the bottom of the file:

```ts
export type AdminAction = (typeof adminActionEnum.enumValues)[number]
export type RefundStatus = (typeof refundStatusEnum.enumValues)[number]
export type SupportCategory = (typeof supportCategoryEnum.enumValues)[number]
export type SupportPriority = (typeof supportPriorityEnum.enumValues)[number]
export type SupportStatus = (typeof supportStatusEnum.enumValues)[number]
```

- [ ] **Step 2: Add users suspension columns in schema.ts**

Modify the `users` table definition (around `lib/db/schema.ts:28-38`), add
before the closing `})`:

```ts
  suspended: boolean('suspended').notNull().default(false),
  suspendedReason: text('suspended_reason'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
```

- [ ] **Step 3: Add admin_actions, refund_requests, support_tickets tables**

Add near the bottom of `lib/db/schema.ts`, importing the new enums at the
top of the file (add `adminActionEnum, refundStatusEnum, supportCategoryEnum,
supportPriorityEnum, supportStatusEnum` to the existing `from
'./schema-enums'` import):

```ts
// ---------------------------------------------------------------------------
// admin_actions (general audit log — append-only)
// ---------------------------------------------------------------------------

export const adminActions = pgTable(
  'admin_actions',
  {
    id: id(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: adminActionEnum('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_actions_target_idx').on(table.targetType, table.targetId),
    index('admin_actions_actor_id_idx').on(table.actorId),
  ],
)

export const adminActionsRelations = relations(adminActions, ({ one }) => ({
  actor: one(users, { fields: [adminActions.actorId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// refund_requests
// ---------------------------------------------------------------------------

export const refundRequests = pgTable(
  'refund_requests',
  {
    id: id(),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    amount: integer('amount').notNull(),
    status: refundStatusEnum('status').notNull().default('REQUESTED'),
    approverId: text('approver_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    providerRefundId: text('provider_refund_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refund_requests_registration_id_idx').on(table.registrationId),
    index('refund_requests_status_idx').on(table.status),
  ],
)

export const refundRequestsRelations = relations(refundRequests, ({ one }) => ({
  registration: one(registrations, {
    fields: [refundRequests.registrationId],
    references: [registrations.id],
  }),
  payment: one(payments, { fields: [refundRequests.paymentId], references: [payments.id] }),
  requester: one(users, { fields: [refundRequests.requestedBy], references: [users.id] }),
  approver: one(users, { fields: [refundRequests.approverId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// support_tickets
// ---------------------------------------------------------------------------

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    category: supportCategoryEnum('category').notNull(),
    priority: supportPriorityEnum('priority').notNull().default('NORMAL'),
    status: supportStatusEnum('status').notNull().default('NEW'),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    assignedTo: text('assigned_to').references(() => users.id),
    relatedRegistrationId: text('related_registration_id').references(() => registrations.id),
    relatedMunId: text('related_mun_id').references(() => muns.id),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_tickets_status_idx').on(table.status),
    index('support_tickets_assigned_to_idx').on(table.assignedTo),
  ],
)

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  creator: one(users, { fields: [supportTickets.createdBy], references: [users.id] }),
  assignee: one(users, { fields: [supportTickets.assignedTo], references: [users.id] }),
  registration: one(registrations, {
    fields: [supportTickets.relatedRegistrationId],
    references: [registrations.id],
  }),
  mun: one(muns, { fields: [supportTickets.relatedMunId], references: [muns.id] }),
}))
```

- [ ] **Step 4: Generate and apply migration**

Run: `npx drizzle-kit generate`
Expected: a new SQL file appears under the project's migrations folder
(check `drizzle.config.ts` `out` path — follow existing convention, look at
the most recent migration file's location if unsure).

Run: `npm run db:up` (ensure local Docker Postgres is running), then apply
the migration the way existing migrations are applied in this repo — check
`package.json` scripts for a `db:migrate` command, or run the drizzle-kit
migrate/push command already used for prior migrations (look at git log for
`drizzle/` changes to confirm the exact command).

- [ ] **Step 5: Verify with tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/schema-enums.ts drizzle/
git commit -m "feat: add admin_actions, refund_requests, support_tickets tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Audit log helper + suspended-user login enforcement

**Files:**
- Create: `lib/audit/log.ts`
- Create: `lib/audit/log.test.ts`
- Modify: `lib/auth/session.ts:19-34` (`getSession`)
- Modify: `lib/actions/auth.ts` (`signIn`)
- Test: `lib/auth/session.test.ts` (create if none exists)

**Interfaces:**
- Consumes: `adminActions` table + `AdminAction` type from Task 1.
- Produces: `recordAdminAction(tx, actorId: string, action: AdminAction,
  targetType: string, targetId: string, reason?: string, metadata?:
  Record<string, unknown>): Promise<void>` — takes a Drizzle transaction
  handle (`tx`) as first arg so callers insert inside their own transaction,
  never a separate connection. `getSession()` now returns `null` for a
  suspended user (same signature, no consumer changes needed). `signIn`
  throws `Error('Account suspended')` for a suspended user.

- [ ] **Step 1: Write the failing test for recordAdminAction**

```ts
// lib/audit/log.test.ts
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { recordAdminAction } from './log'

describe('recordAdminAction', () => {
  it('inserts an admin_actions row with the given fields', async () => {
    const [actor] = await db
      .insert(users)
      .values({ name: 'Test Admin', email: `admin-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    await db.transaction(async (tx) => {
      await recordAdminAction(tx, actor.id, 'MUN_SUSPENDED', 'mun', 'some-mun-id', 'policy violation')
    })

    const [row] = await db.select().from(adminActions).where(eq(adminActions.actorId, actor.id))
    expect(row.action).toBe('MUN_SUSPENDED')
    expect(row.targetType).toBe('mun')
    expect(row.targetId).toBe('some-mun-id')
    expect(row.reason).toBe('policy violation')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/audit/log.test.ts`
Expected: FAIL — `./log` module not found.

- [ ] **Step 3: Implement recordAdminAction**

```ts
// lib/audit/log.ts
import type { db } from '@/lib/db/client'
import { adminActions } from '@/lib/db/schema'
import type { AdminAction } from '@/lib/db/schema-enums'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Inserts one append-only admin_actions row. Always call this inside the
 * same transaction (`tx`) as the state change it records — never as a
 * separate fire-and-forget write, so a rollback of the change also rolls
 * back its audit row.
 */
export async function recordAdminAction(
  tx: Tx,
  actorId: string,
  action: AdminAction,
  targetType: string,
  targetId: string,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(adminActions).values({ actorId, action, targetType, targetId, reason, metadata })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/audit/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for suspended-user session rejection**

```ts
// lib/auth/session.test.ts (add to existing file, or create it)
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { createSession } from './session'
import { getSession } from './session'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME } from './session'

describe('getSession with suspended user', () => {
  it('returns null for a suspended user even with a valid session token', async () => {
    const [user] = await db
      .insert(users)
      .values({
        name: 'Suspended Organizer',
        email: `suspended-${crypto.randomUUID()}@test.dev`,
        role: 'ORGANIZER',
        suspended: true,
      })
      .returning()

    const { token } = await createSession(user.id)
    const cookieStore = await cookies()
    cookieStore.set(SESSION_COOKIE_NAME, token)

    const session = await getSession()
    expect(session).toBeNull()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/auth/session.test.ts`
Expected: FAIL — session is returned (not null) because `getSession` doesn't
check `suspended` yet.

- [ ] **Step 7: Update getSession to reject suspended users**

Modify `lib/auth/session.ts:24-33`:

```ts
  const [row] = await db
    .select({
      userId: users.id,
      role: users.role,
      expiresAt: sessions.expiresAt,
      suspended: users.suspended,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1)

  if (!row || row.suspended) return null

  return { userId: row.userId, role: row.role }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run lib/auth/session.test.ts`
Expected: PASS.

- [ ] **Step 9: Update signIn to reject suspended users at login**

Modify `lib/actions/auth.ts` — after the existing `if (!user) { throw new
Error('User not found') }` check, add:

```ts
  if (user.suspended) {
    throw new Error('Account suspended')
  }
```

- [ ] **Step 10: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 type errors.

- [ ] **Step 11: Commit**

```bash
git add lib/audit/ lib/auth/session.ts lib/auth/session.test.ts lib/actions/auth.ts
git commit -m "feat: add admin_actions audit helper, reject suspended users at login

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Organizer management (list, suspend, reinstate)

**Files:**
- Create: `lib/actions/organizer-admin.ts`
- Create: `lib/actions/organizer-admin.test.ts`
- Create: `app/admin/organizers/page.tsx`
- Create: `app/admin/organizers/organizer-row.tsx`
- Create: `app/admin/organizers/suspend-dialog.tsx`

**Interfaces:**
- Consumes: `requireRole` (`lib/auth/authorize.ts`), `getSession`
  (`lib/auth/session.ts`), `recordAdminAction` (Task 2), `users` table.
- Produces: `listOrganizers(params?: {limit?: number; offset?: number}):
  Promise<{results: OrganizerRow[], total: number}>`,
  `suspendOrganizer(userId: string, reason: string): Promise<void>`,
  `reinstateOrganizer(userId: string): Promise<void>` — both derive actor
  from `getSession()` internally, not passed as a param (matches the "never
  trust client-supplied userId" rule — the ACTOR is server-derived; the
  TARGET `userId` being suspended is a legitimate action parameter, distinct
  from actor identity).

- [ ] **Step 1: Write failing tests for suspendOrganizer/reinstateOrganizer**

```ts
// lib/actions/organizer-admin.test.ts
import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users, adminActions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { suspendOrganizer, reinstateOrganizer, listOrganizers } from './organizer-admin'

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}))
import { getSession } from '@/lib/auth/session'

describe('suspendOrganizer', () => {
  it('sets suspended=true, suspendedReason, suspendedAt, and logs the action', async () => {
    const [admin] = await db
      .insert(users)
      .values({ name: 'Admin', email: `admin-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
      .returning()

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })

    await suspendOrganizer(organizer.id, 'policy violation')

    const [updated] = await db.select().from(users).where(eq(users.id, organizer.id))
    expect(updated.suspended).toBe(true)
    expect(updated.suspendedReason).toBe('policy violation')
    expect(updated.suspendedAt).not.toBeNull()

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, organizer.id))
    expect(log.action).toBe('ORGANIZER_SUSPENDED')
    expect(log.actorId).toBe(admin.id)
  })

  it('throws Forbidden for a non-admin session', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org2', email: `org2-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
      .returning()
    vi.mocked(getSession).mockResolvedValue({ userId: 'someone', role: 'STUDENT' })

    await expect(suspendOrganizer(organizer.id, 'x')).rejects.toThrow('Forbidden')
  })
})

describe('reinstateOrganizer', () => {
  it('clears suspended fields and logs ORGANIZER_REINSTATED', async () => {
    const [admin] = await db
      .insert(users)
      .values({ name: 'Admin2', email: `admin2-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const [organizer] = await db
      .insert(users)
      .values({
        name: 'Org3',
        email: `org3-${crypto.randomUUID()}@test.dev`,
        role: 'ORGANIZER',
        suspended: true,
        suspendedReason: 'x',
        suspendedAt: new Date(),
      })
      .returning()

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await reinstateOrganizer(organizer.id)

    const [updated] = await db.select().from(users).where(eq(users.id, organizer.id))
    expect(updated.suspended).toBe(false)
    expect(updated.suspendedReason).toBeNull()
  })
})

describe('listOrganizers', () => {
  it('returns paginated organizers with total count', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-x', role: 'OPERATIONS' })
    const { results, total } = await listOrganizers({ limit: 5, offset: 0 })
    expect(Array.isArray(results)).toBe(true)
    expect(typeof total).toBe('number')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/organizer-admin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/actions/organizer-admin.ts**

```ts
'use server'

import { and, count, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import type { User } from '@/lib/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type OrganizerRow = Pick<
  User,
  'id' | 'name' | 'email' | 'suspended' | 'suspendedReason' | 'suspendedAt'
>

/** Paginated list of organizer accounts, newest first is not guaranteed — ordered by id. */
export async function listOrganizers(
  params: { limit?: number; offset?: number } = {},
): Promise<{ results: OrganizerRow[]; total: number }> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0

  const [results, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        suspended: users.suspended,
        suspendedReason: users.suspendedReason,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.role, 'ORGANIZER'))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(users).where(eq(users.role, 'ORGANIZER')),
  ])

  return { results, total }
}

/** Blocks the organizer's login (does NOT touch their MUNs — admin reviews those separately). */
export async function suspendOrganizer(userId: string, reason: string): Promise<void> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ suspended: true, suspendedReason: reason, suspendedAt: new Date() })
      .where(eq(users.id, userId))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_SUSPENDED', 'user', userId, reason)
  })
}

/** Clears the suspension, restoring login access. */
export async function reinstateOrganizer(userId: string): Promise<void> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ suspended: false, suspendedReason: null, suspendedAt: null })
      .where(eq(users.id, userId))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_REINSTATED', 'user', userId)
  })
}
```

Check `lib/types/index.ts` (or wherever `User` is exported) for the exact
`User` type shape before importing it — if `suspended`/`suspendedReason`/
`suspendedAt` aren't already on that type (they're new DB columns from Task
1), add them there so the `Pick<User, ...>` compiles.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/organizer-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the organizers list page**

```tsx
// app/admin/organizers/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { listOrganizers } from '@/lib/actions/organizer-admin'
import { OrganizerRow } from './organizer-row'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

export default async function OrganizersPage() {
  const session = await getSession()
  // Real boundary is requireRole() inside listOrganizers — this redirect is
  // just so a non-admin doesn't see the page shell before the action throws.
  if (!session || !REVIEW_ROLES.includes(session.role)) {
    redirect('/')
  }

  const { results } = await listOrganizers({ limit: 50 })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Organizers</h1>
      <div className="divide-y rounded-md border">
        {results.map((organizer) => (
          <OrganizerRow key={organizer.id} organizer={organizer} />
        ))}
      </div>
    </div>
  )
}
```

```tsx
// app/admin/organizers/organizer-row.tsx
'use client'

import { useState } from 'react'
import type { OrganizerRow as OrganizerRowType } from '@/lib/actions/organizer-admin'
import { SuspendDialog } from './suspend-dialog'

export function OrganizerRow({ organizer }: { organizer: OrganizerRowType }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center justify-between p-4">
      <div>
        <p className="font-medium">{organizer.name}</p>
        <p className="text-sm text-muted-foreground">{organizer.email}</p>
        {organizer.suspended && (
          <p className="text-sm text-destructive">Suspended: {organizer.suspendedReason}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm underline"
      >
        {organizer.suspended ? 'Reinstate' : 'Suspend'}
      </button>
      {open && (
        <SuspendDialog
          organizer={organizer}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
```

```tsx
// app/admin/organizers/suspend-dialog.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { suspendOrganizer, reinstateOrganizer, type OrganizerRow } from '@/lib/actions/organizer-admin'

export function SuspendDialog({
  organizer,
  onClose,
}: {
  organizer: OrganizerRow
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const isSuspending = !organizer.suspended

  const handleConfirm = () => {
    startTransition(async () => {
      if (isSuspending) {
        await suspendOrganizer(organizer.id, reason)
      } else {
        await reinstateOrganizer(organizer.id)
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm space-y-4 rounded-md bg-background p-6">
        <p className="font-medium">
          {isSuspending ? `Suspend ${organizer.name}?` : `Reinstate ${organizer.name}?`}
        </p>
        {isSuspending && (
          <>
            <p className="text-sm text-muted-foreground">
              This blocks their login. Existing MUNs are not affected — review them separately.
            </p>
            <textarea
              className="w-full rounded border p-2 text-sm"
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || (isSuspending && !reason.trim())}
            onClick={handleConfirm}
            className="rounded bg-destructive px-3 py-1 text-sm text-destructive-foreground disabled:opacity-50"
          >
            {isSuspending ? 'Confirm Suspension' : 'Confirm Reinstate'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/organizer-admin.ts lib/actions/organizer-admin.test.ts app/admin/organizers/
git commit -m "feat: add organizer management — list, suspend, reinstate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: MUN unpublish/suspend/reinstate actions

**Files:**
- Modify: `lib/lifecycle/mun-state-machine.ts` (extend `ALLOWED_TRANSITIONS`)
- Modify: `lib/lifecycle/mun-state-machine.test.ts` (extend existing tests)
- Modify: `lib/actions/admin-review.ts` (add `unpublishMun`, `suspendMun`, `reinstateMun`)
- Modify: `lib/actions/admin-review.test.ts` (add tests)
- Modify: whichever admin MUN detail page currently renders the publish
  button (find via `grep -rn "publishMun" app/admin/`) — add unpublish/
  suspend buttons alongside it.

**Interfaces:**
- Consumes: `transitionMun` (existing), `recordAdminAction` (Task 2).
- Produces: `unpublishMun(munId: string): Promise<Mun>`,
  `suspendMun(munId: string, reason: string): Promise<Mun>`,
  `reinstateMun(munId: string): Promise<Mun>` — all derive actor from
  `getSession()` internally like the existing `publishMun`.

- [ ] **Step 1: Write failing transition-table tests**

Add to `lib/lifecycle/mun-state-machine.test.ts` (find the existing
`canTransition` test block and add alongside it):

```ts
describe('SUSPENDED transitions', () => {
  it('allows PUBLISHED -> SUSPENDED', () => {
    expect(canTransition('PUBLISHED', 'SUSPENDED')).toBe(true)
  })
  it('allows REGISTRATION_OPEN -> SUSPENDED', () => {
    expect(canTransition('REGISTRATION_OPEN', 'SUSPENDED')).toBe(true)
  })
  it('allows SUSPENDED -> VERIFICATION (reinstate re-runs verification)', () => {
    expect(canTransition('SUSPENDED', 'VERIFICATION')).toBe(true)
  })
  it('allows SUSPENDED -> CANCELLED', () => {
    expect(canTransition('SUSPENDED', 'CANCELLED')).toBe(true)
  })
  it('rejects DRAFT -> SUSPENDED', () => {
    expect(canTransition('DRAFT', 'SUSPENDED')).toBe(false)
  })
})

describe('unpublish transition', () => {
  it('allows PUBLISHED -> VERIFIED (unpublish)', () => {
    expect(canTransition('PUBLISHED', 'VERIFIED')).toBe(true)
  })
  it('rejects REGISTRATION_OPEN -> VERIFIED (registrations exist, must suspend instead)', () => {
    expect(canTransition('REGISTRATION_OPEN', 'VERIFIED')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/lifecycle/mun-state-machine.test.ts`
Expected: FAIL — new transitions not yet in `ALLOWED_TRANSITIONS`.

- [ ] **Step 3: Extend ALLOWED_TRANSITIONS**

Modify `lib/lifecycle/mun-state-machine.ts:23-44`:

```ts
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
  PUBLISHED: ['REGISTRATION_OPEN', 'VERIFICATION', 'VERIFIED', 'SUSPENDED', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'VERIFICATION', 'SUSPENDED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CONFERENCE_ACTIVE', 'SUSPENDED', 'CANCELLED'],
  CONFERENCE_ACTIVE: ['RESULTS_PENDING', 'SUSPENDED', 'CANCELLED'],
  RESULTS_PENDING: ['RESULTS_UNDER_REVIEW'],
  RESULTS_UNDER_REVIEW: ['COMPLETED', 'RESULTS_PENDING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: [],
  SUSPENDED: ['VERIFICATION', 'CANCELLED'],
}
```

Also update the doc comment above it (lines 7-22) to mention `PUBLISHED ->
VERIFIED` (unpublish, visibility-only toggle) and the new `SUSPENDED` state
(admin-only pause, reachable from PUBLISHED onward, reinstates via
re-verification) — keep the existing comment style, append rather than
rewrite the whole block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/lifecycle/mun-state-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for unpublishMun/suspendMun/reinstateMun**

Add to `lib/actions/admin-review.test.ts` (find the existing `publishMun`
test block for the pattern — session mocking, seeded mun):

```ts
describe('unpublishMun', () => {
  it('transitions PUBLISHED -> VERIFIED and logs MUN_UNPUBLISHED', async () => {
    const mun = await seedMunWithStatus('PUBLISHED') // use existing test helper if one exists; otherwise insert directly via db.insert(muns)
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })

    const updated = await unpublishMun(mun.id)
    expect(updated.status).toBe('VERIFIED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, mun.id))
    expect(log.action).toBe('MUN_UNPUBLISHED')
  })
})

describe('suspendMun', () => {
  it('transitions REGISTRATION_OPEN -> SUSPENDED with reason, logs MUN_SUSPENDED', async () => {
    const mun = await seedMunWithStatus('REGISTRATION_OPEN')
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })

    const updated = await suspendMun(mun.id, 'safety concern')
    expect(updated.status).toBe('SUSPENDED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, mun.id))
    expect(log.action).toBe('MUN_SUSPENDED')
    expect(log.reason).toBe('safety concern')
  })

  it('two concurrent suspend calls on the same mun serialize (row lock)', async () => {
    const mun = await seedMunWithStatus('PUBLISHED')
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })

    const [r1, r2] = await Promise.allSettled([
      suspendMun(mun.id, 'reason A'),
      suspendMun(mun.id, 'reason B'),
    ])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    const rejected = [r1, r2].filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })
})

describe('reinstateMun', () => {
  it('transitions SUSPENDED -> VERIFICATION', async () => {
    const mun = await seedMunWithStatus('SUSPENDED')
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })

    const updated = await reinstateMun(mun.id)
    expect(updated.status).toBe('VERIFICATION')
  })
})
```

Check the top of `lib/actions/admin-review.test.ts` for how existing tests
seed a mun at a given status and mock `getSession` — reuse that exact
helper/pattern instead of inventing a new one; the snippet above assumes a
`seedMunWithStatus` helper exists (per the file's existing `publishMun`
tests) — if it doesn't, insert directly via `db.insert(muns).values({...})`
matching the shape other tests in that file already use.

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run lib/actions/admin-review.test.ts`
Expected: FAIL — functions not exported yet.

- [ ] **Step 7: Implement unpublishMun/suspendMun/reinstateMun**

Add to `lib/actions/admin-review.ts`, near the existing `publishMun` (reuse
its `PUBLISH_ROLES` constant at the top of the file):

```ts
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import { recordAdminAction } from '@/lib/audit/log'
import { db } from '@/lib/db/client'

/** Pulls a PUBLISHED mun back to VERIFIED — pure visibility toggle, no re-verification needed. */
export async function unpublishMun(munId: string): Promise<Mun> {
  const session = await getSession()
  requireRole(session, PUBLISH_ROLES)

  return db.transaction(async (tx) => {
    const updated = await transitionMun(munId, 'VERIFIED', session.userId, undefined, undefined, tx)
    await recordAdminAction(tx, session.userId, 'MUN_UNPUBLISHED', 'mun', munId)
    return updated
  })
}

/** Suspends a mun (reversible hide + stop new registrations). Requires a reason. */
export async function suspendMun(munId: string, reason: string): Promise<Mun> {
  const session = await getSession()
  requireRole(session, PUBLISH_ROLES)

  return db.transaction(async (tx) => {
    const updated = await transitionMun(munId, 'SUSPENDED', session.userId, undefined, reason, tx)
    await recordAdminAction(tx, session.userId, 'MUN_SUSPENDED', 'mun', munId, reason)
    return updated
  })
}

/** Reinstates a suspended mun — sends it back through VERIFICATION before it can go live again. */
export async function reinstateMun(munId: string): Promise<Mun> {
  const session = await getSession()
  requireRole(session, PUBLISH_ROLES)

  return transitionMun(munId, 'VERIFICATION', session.userId)
}
```

**Important:** `transitionMun` (`lib/lifecycle/mun-state-machine.ts:59-100`)
currently opens its own `db.transaction` internally and does not accept an
external `tx`. To call it from inside `unpublishMun`/`suspendMun`'s own
transaction (so the `admin_actions` insert is atomic with the status
change), refactor `transitionMun` to accept an optional `tx` parameter:

```ts
export async function transitionMun(
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
  externalTx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<Mun> {
  const run = async (tx: typeof db extends { transaction: infer T } ? never : never) => { /* placeholder, see below */ }
```

Simplify instead of the placeholder above — extract the existing transaction
body into a helper and call it either with the passed-in `tx` or a
freshly-opened one:

```ts
async function runTransition(
  tx: any, // matches the transaction-callback param type already used at mun-state-machine.ts:66
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
): Promise<Mun> {
  const [mun] = await tx.select().from(muns).where(eq(muns.id, munId)).for('update').limit(1)
  if (!mun) {
    throw new Error('Mun not found')
  }
  if (!canTransition(mun.status, toStatus)) {
    throw new Error(`Invalid transition from ${mun.status} to ${toStatus}`)
  }
  const [updated] = await tx
    .update(muns)
    .set({
      status: toStatus,
      updatedAt: new Date(),
      ...(toStatus === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
    })
    .where(eq(muns.id, munId))
    .returning()
  await tx.insert(verificationLogs).values({ munId, reviewerId: actorId, action: toStatus, notes, internalNotes })
  return updated
}

export async function transitionMun(
  munId: string,
  toStatus: MunStatus,
  actorId: string,
  notes?: string,
  internalNotes?: string,
  externalTx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<Mun> {
  if (externalTx) {
    return runTransition(externalTx, munId, toStatus, actorId, notes, internalNotes)
  }
  return db.transaction((tx) => runTransition(tx, munId, toStatus, actorId, notes, internalNotes))
}
```

Replace the `any` type with the actual Drizzle transaction param type used
elsewhere in this file if a named type is available (check imports at the
top of `mun-state-machine.ts` — Drizzle's `postgres-js` driver exposes this
as `PgTransaction<...>`; use whatever the codebase's existing convention is,
grep other files for `db.transaction(async (tx` to see if a shared `Tx`
type already exists before introducing `any`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run lib/actions/admin-review.test.ts lib/lifecycle/mun-state-machine.test.ts`
Expected: PASS, including the concurrency test.

- [ ] **Step 9: Add unpublish/suspend buttons to the admin MUN detail page**

Run: `grep -rn "publishMun" app/admin/` to find the exact file/line where
the existing publish button lives. Add sibling buttons following the exact
same component pattern (likely a `publish-button.tsx` — create
`unpublish-button.tsx` and `suspend-button.tsx` alongside it, or extend the
existing component to accept an `action` prop) that call `unpublishMun`/
`suspendMun` with the same confirmation-dialog pattern used in Task 3's
`suspend-dialog.tsx`.

- [ ] **Step 10: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 11: Commit**

```bash
git add lib/lifecycle/mun-state-machine.ts lib/lifecycle/mun-state-machine.test.ts lib/actions/admin-review.ts lib/actions/admin-review.test.ts app/admin/
git commit -m "feat: add MUN unpublish/suspend/reinstate admin actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Registration + payment monitoring (search, exceptions)

**Files:**
- Create: `lib/actions/admin-search.ts`
- Create: `lib/actions/admin-search.test.ts`
- Create: `app/admin/registrations/page.tsx`
- Create: `app/admin/registrations/search-form.tsx`
- Create: `app/admin/payments/page.tsx`

**Interfaces:**
- Consumes: `registrations`, `payments`, `muns`, `users`, `committees`,
  `portfolios` tables (all existing).
- Produces: `searchRegistrations(query: string): Promise<RegistrationSearchResult[]>`,
  `listPaymentExceptions(): Promise<PaymentExceptionRow[]>`.

- [ ] **Step 1: Write failing tests**

```ts
// lib/actions/admin-search.test.ts
import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users, muns, registrations, registrationProducts, payments } from '@/lib/db/schema'
import { searchRegistrations, listPaymentExceptions } from './admin-search'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

async function seedRegistrationWithPayment(paymentStatus: 'PAID' | 'FAILED', registrationStatus: 'CONFIRMED' | 'PAYMENT_PENDING') {
  const [organizer] = await db.insert(users).values({ name: 'Org', email: `o-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' }).returning()
  const [student] = await db.insert(users).values({ name: 'Student', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
  const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Test Mun', slug: `test-mun-${crypto.randomUUID()}` }).returning()
  const [product] = await db.insert(registrationProducts).values({ munId: mun.id, name: 'Delegate', price: 50000, capacity: 10 }).returning()
  const [registration] = await db.insert(registrations).values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: registrationStatus }).returning()
  await db.insert(payments).values({ registrationId: registration.id, providerOrderId: `order-${crypto.randomUUID()}`, amount: 50000, status: paymentStatus })
  return { mun, student, registration }
}

describe('searchRegistrations', () => {
  it('finds a registration by student name substring', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'OPERATIONS' })
    const { student, registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')

    const results = await searchRegistrations(student.name)
    expect(results.some((r) => r.registrationId === registration.id)).toBe(true)
  })

  it('throws Forbidden for a student session', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'x', role: 'STUDENT' })
    await expect(searchRegistrations('anything')).rejects.toThrow('Forbidden')
  })
})

describe('listPaymentExceptions', () => {
  it('includes a FAILED payment', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'OPERATIONS' })
    const { registration } = await seedRegistrationWithPayment('FAILED', 'PAYMENT_PENDING')

    const exceptions = await listPaymentExceptions()
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(true)
  })

  it('includes a PAID payment whose registration is not CONFIRMED (webhook/registration mismatch)', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'OPERATIONS' })
    const { registration } = await seedRegistrationWithPayment('PAID', 'CANCELLED')

    const exceptions = await listPaymentExceptions()
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(true)
  })

  it('excludes a normal PAID + CONFIRMED pair', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'OPERATIONS' })
    const { registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')

    const exceptions = await listPaymentExceptions()
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(false)
  })
})
```

Check `registrationProducts` table's exact column names (`price`/`capacity`
or similar) via `grep -n "registrationProducts = pgTable" -A 15
lib/db/schema.ts` before finalizing the seed helper — adjust field names in
the test to match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/admin-search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/actions/admin-search.ts**

```ts
'use server'

import { and, eq, ilike, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, payments, portfolios, registrations, users } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export interface RegistrationSearchResult {
  registrationId: string
  studentName: string
  munName: string
  committeeName: string | null
  portfolioName: string | null
  paymentStatus: string | null
  registrationStatus: string
}

/**
 * Matches PRD section 24 fields: registration ID, student, mun, committee,
 * portfolio, payment/order ID. One ILIKE-based search across the joined
 * view — exact-ID matches (registration.id, payment.providerOrderId) also
 * fall out of the same ILIKE since IDs are UUID/text.
 */
export async function searchRegistrations(query: string): Promise<RegistrationSearchResult[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const pattern = `%${query}%`

  const rows = await db
    .select({
      registrationId: registrations.id,
      studentName: users.name,
      munName: muns.name,
      committeeName: committees.name,
      portfolioName: portfolios.name,
      paymentStatus: payments.status,
      registrationStatus: registrations.status,
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .leftJoin(committees, eq(registrations.committeeId, committees.id))
    .leftJoin(portfolios, eq(registrations.portfolioId, portfolios.id))
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(
      or(
        ilike(users.name, pattern),
        ilike(muns.name, pattern),
        eq(registrations.id, query),
        ilike(payments.providerOrderId, pattern),
      ),
    )
    .limit(50)

  return rows
}

export interface PaymentExceptionRow {
  registrationId: string
  paymentId: string
  reason: 'PAYMENT_FAILED' | 'CONFIRMATION_MISMATCH'
  amount: number
  studentName: string
  munName: string
}

/**
 * Computed, not a stored state (matches project convention — the webhook
 * handler's refundOwed logic already treats this as derived). Two cases:
 * a FAILED payment, or a PAID payment whose registration isn't CONFIRMED
 * (the registration expired/was cancelled after the webhook fired — see
 * CLAUDE.md "Registration integrity" section for the underlying webhook
 * behavior this surfaces).
 */
export async function listPaymentExceptions(): Promise<PaymentExceptionRow[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const rows = await db
    .select({
      registrationId: registrations.id,
      paymentId: payments.id,
      paymentStatus: payments.status,
      registrationStatus: registrations.status,
      amount: payments.amount,
      studentName: users.name,
      munName: muns.name,
    })
    .from(payments)
    .innerJoin(registrations, eq(payments.registrationId, registrations.id))
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(
      or(
        eq(payments.status, 'FAILED'),
        and(eq(payments.status, 'PAID'), ne(registrations.status, 'CONFIRMED')),
      ),
    )

  return rows.map((row) => ({
    registrationId: row.registrationId,
    paymentId: row.paymentId,
    reason: row.paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : 'CONFIRMATION_MISMATCH',
    amount: row.amount,
    studentName: row.studentName,
    munName: row.munName,
  }))
}
```

Verify `committees`/`portfolios` table column is actually named `name` via
`grep -n "export const committees = pgTable\|export const portfolios =
pgTable" -A 10 lib/db/schema.ts` — adjust the select if different.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/admin-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Build registrations search page**

```tsx
// app/admin/registrations/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { searchRegistrations } from '@/lib/actions/admin-search'
import { SearchForm } from './search-form'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await getSession()
  if (!session || !REVIEW_ROLES.includes(session.role)) redirect('/')

  const { q } = await searchParams
  const results = q ? await searchRegistrations(q) : []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Registrations</h1>
      <SearchForm initialQuery={q ?? ''} />
      <div className="divide-y rounded-md border">
        {results.map((r) => (
          <div key={r.registrationId} className="p-4 text-sm">
            <p className="font-medium">{r.studentName} — {r.munName}</p>
            <p className="text-muted-foreground">
              {r.committeeName ?? '—'} / {r.portfolioName ?? '—'} · {r.registrationStatus} ·
              payment: {r.paymentStatus ?? 'none'}
            </p>
          </div>
        ))}
        {q && results.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No matches.</p>
        )}
      </div>
    </div>
  )
}
```

```tsx
// app/admin/registrations/search-form.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SearchForm({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery)
  const router = useRouter()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        router.push(`/admin/registrations?q=${encodeURIComponent(value)}`)
      }}
      className="flex gap-2"
    >
      <input
        className="flex-1 rounded border p-2 text-sm"
        placeholder="Student, MUN, committee, portfolio, or order ID"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
        Search
      </button>
    </form>
  )
}
```

- [ ] **Step 6: Build payments exceptions page**

```tsx
// app/admin/payments/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { listPaymentExceptions } from '@/lib/actions/admin-search'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

export default async function PaymentsPage() {
  const session = await getSession()
  if (!session || !REVIEW_ROLES.includes(session.role)) redirect('/')

  const exceptions = await listPaymentExceptions()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Payment Exceptions</h1>
      <div className="divide-y rounded-md border">
        {exceptions.map((e) => (
          <div key={e.paymentId} className="flex justify-between p-4 text-sm">
            <div>
              <p className="font-medium">{e.studentName} — {e.munName}</p>
              <p className="text-muted-foreground">₹{(e.amount / 100).toFixed(2)}</p>
            </div>
            <span className="rounded bg-destructive/10 px-2 py-1 text-destructive">{e.reason}</span>
          </div>
        ))}
        {exceptions.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No exceptions.</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/admin-search.ts lib/actions/admin-search.test.ts app/admin/registrations/ app/admin/payments/
git commit -m "feat: add registration search and payment exception monitoring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Refund workflow

**Files:**
- Modify: `lib/payments/adapter.ts` (add `refund` method)
- Modify: mock payments adapter implementation (find via `grep -rn
  "PaymentsAdapter" lib/payments/` — likely `lib/payments/mock-adapter.ts`)
- Create: `lib/lifecycle/refund.ts`
- Create: `lib/lifecycle/refund.test.ts`
- Create: `app/admin/refunds/page.tsx`
- Create: `app/admin/refunds/refund-row.tsx`

**Interfaces:**
- Consumes: `PaymentsAdapter` (extended), `refundRequests`/`registrations`/
  `payments` tables, `recordAdminAction` (Task 2).
- Produces: `requestRefund(registrationId: string, reason: string):
  Promise<RefundRequest>`, `approveRefund(refundRequestId: string):
  Promise<RefundRequest>`, `rejectRefund(refundRequestId: string, reason:
  string): Promise<RefundRequest>`, `listRefundRequests(): Promise<RefundRequestRow[]>`.
  `approveRefund` internally calls `executeRefund` — not exposed separately,
  approval and execution happen atomically in one action per the spec (no
  separate provider-confirmation step in this mock-adapter world).

- [ ] **Step 1: Add refund() to PaymentsAdapter interface**

Modify `lib/payments/adapter.ts`:

```ts
export interface PaymentOrder {
  orderId: string
}

export interface RefundResult {
  providerRefundId: string
}

/**
 * Payments provider interface. Mock Razorpay-shaped implementation now; a
 * real Razorpay adapter implements the same interface later, call sites
 * unchanged.
 */
export interface PaymentsAdapter {
  createOrder(amount: number, currency: string, registrationId: string): Promise<PaymentOrder>
  verifyWebhookSignature(payload: string, signature: string): boolean
  refund(providerPaymentId: string, amount: number): Promise<RefundResult>
}
```

- [ ] **Step 2: Implement refund() in the mock adapter**

Run: `grep -rln "implements PaymentsAdapter\|: PaymentsAdapter" lib/payments/`
to find the mock implementation file. Add the method following the same
style as the existing `createOrder` mock (likely returns a fake ID
immediately):

```ts
async refund(providerPaymentId: string, amount: number): Promise<RefundResult> {
  return { providerRefundId: `mock_refund_${crypto.randomUUID()}` }
}
```

- [ ] **Step 3: Write failing tests for the refund state machine**

```ts
// lib/lifecycle/refund.test.ts
import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users, muns, registrationProducts, registrations, payments, refundRequests, adminActions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requestRefund, approveRefund, rejectRefund } from './refund'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

async function seedPaidRegistration() {
  const [organizer] = await db.insert(users).values({ name: 'Org', email: `o-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' }).returning()
  const [student] = await db.insert(users).values({ name: 'Student', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
  const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Refund Mun', slug: `refund-mun-${crypto.randomUUID()}` }).returning()
  const [product] = await db.insert(registrationProducts).values({ munId: mun.id, name: 'Delegate', price: 50000, capacity: 10 }).returning()
  const [registration] = await db.insert(registrations).values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' }).returning()
  const [payment] = await db.insert(payments).values({ registrationId: registration.id, providerOrderId: `order-${crypto.randomUUID()}`, providerPaymentId: `pay-${crypto.randomUUID()}`, amount: 50000, status: 'PAID' }).returning()
  return { student, registration, payment }
}

describe('requestRefund', () => {
  it('creates a REQUESTED refund_requests row', async () => {
    const { student, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const req = await requestRefund(registration.id, 'conference cancelled')
    expect(req.status).toBe('REQUESTED')
    expect(req.paymentId).toBe(payment.id)
    expect(req.amount).toBe(50000)
  })
})

describe('approveRefund', () => {
  it('transitions REQUESTED -> REFUNDED, updates registration and payment status, logs REFUND_APPROVED', async () => {
    const { student, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'conference cancelled')

    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })
    const approved = await approveRefund(req.id)
    expect(approved.status).toBe('REFUNDED')
    expect(approved.providerRefundId).toBeTruthy()

    const [updatedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updatedRegistration.status).toBe('REFUNDED')

    const [updatedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(updatedPayment.status).toBe('REFUNDED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, req.id))
    expect(log.action).toBe('REFUND_APPROVED')
  })

  it('throws Forbidden for a student session', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    await expect(approveRefund(req.id)).rejects.toThrow('Forbidden')
  })

  it('two concurrent approvals on the same request serialize (row lock, only one REFUNDED)', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })
    const [r1, r2] = await Promise.allSettled([approveRefund(req.id), approveRefund(req.id)])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
  })
})

describe('rejectRefund', () => {
  it('transitions REQUESTED -> REJECTED, logs REFUND_REJECTED, does not touch registration/payment', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })
    const rejected = await rejectRefund(req.id, 'not eligible')
    expect(rejected.status).toBe('REJECTED')

    const [reg] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(reg.status).toBe('CONFIRMED')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run lib/lifecycle/refund.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement lib/lifecycle/refund.ts**

```ts
'use server'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments, refundRequests, registrations } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { paymentsAdapter } from '@/lib/payments' // adjust to the actual export path/name used by other callers — check how initiateRegistration/webhook code imports the adapter instance

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type RefundRequestRow = typeof refundRequests.$inferSelect

/** Any authenticated user can request a refund on their own registration's payment. */
export async function requestRefund(registrationId: string, reason: string): Promise<RefundRequestRow> {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

  const [payment] = await db.select().from(payments).where(eq(payments.registrationId, registrationId)).limit(1)
  if (!payment) throw new Error('No payment found for this registration')

  const [request] = await db
    .insert(refundRequests)
    .values({
      registrationId,
      paymentId: payment.id,
      requestedBy: session.userId,
      reason,
      amount: payment.amount,
    })
    .returning()

  return request
}

/** Approves and immediately executes the refund (mock provider — no separate confirmation step). */
export async function approveRefund(refundRequestId: string): Promise<RefundRequestRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundRequestId))
      .for('update')
      .limit(1)
    if (!request) throw new Error('Refund request not found')
    if (request.status !== 'REQUESTED') throw new Error(`Invalid transition from ${request.status} to REFUNDED`)

    const [payment] = await tx.select().from(payments).where(eq(payments.id, request.paymentId)).for('update').limit(1)
    if (!payment?.providerPaymentId) throw new Error('Payment has no provider payment id')

    const { providerRefundId } = await paymentsAdapter.refund(payment.providerPaymentId, request.amount)

    const [updated] = await tx
      .update(refundRequests)
      .set({ status: 'REFUNDED', approverId: session.userId, approvedAt: new Date(), providerRefundId, updatedAt: new Date() })
      .where(eq(refundRequests.id, refundRequestId))
      .returning()

    await tx.update(payments).set({ status: 'REFUNDED', updatedAt: new Date() }).where(eq(payments.id, request.paymentId))
    await tx.update(registrations).set({ status: 'REFUNDED' }).where(eq(registrations.id, request.registrationId))

    await recordAdminAction(tx, session.userId, 'REFUND_APPROVED', 'refund_request', refundRequestId)

    return updated
  })
}

export async function rejectRefund(refundRequestId: string, reason: string): Promise<RefundRequestRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundRequestId))
      .for('update')
      .limit(1)
    if (!request) throw new Error('Refund request not found')
    if (request.status !== 'REQUESTED') throw new Error(`Invalid transition from ${request.status} to REJECTED`)

    const [updated] = await tx
      .update(refundRequests)
      .set({ status: 'REJECTED', approverId: session.userId, updatedAt: new Date() })
      .where(eq(refundRequests.id, refundRequestId))
      .returning()

    await recordAdminAction(tx, session.userId, 'REFUND_REJECTED', 'refund_request', refundRequestId, reason)

    return updated
  })
}

export async function listRefundRequests(): Promise<RefundRequestRow[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])
  return db.select().from(refundRequests).where(eq(refundRequests.status, 'REQUESTED'))
}
```

Before finalizing the import at the top, run `grep -rn "PaymentsAdapter"
lib/actions/ lib/payments/` to find the exact name/path other call sites
(e.g. the registration/webhook code) use to get an adapter instance — match
that exactly instead of guessing `lib/payments` as a barrel import.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/lifecycle/refund.test.ts`
Expected: PASS, including concurrency test.

- [ ] **Step 7: Build refunds admin page**

```tsx
// app/admin/refunds/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { listRefundRequests } from '@/lib/lifecycle/refund'
import { RefundRow } from './refund-row'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

export default async function RefundsPage() {
  const session = await getSession()
  if (!session || !REVIEW_ROLES.includes(session.role)) redirect('/')

  const requests = await listRefundRequests()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Refund Requests</h1>
      <div className="divide-y rounded-md border">
        {requests.map((r) => (
          <RefundRow key={r.id} request={r} />
        ))}
        {requests.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No pending refund requests.</p>
        )}
      </div>
    </div>
  )
}
```

```tsx
// app/admin/refunds/refund-row.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveRefund, rejectRefund, type RefundRequestRow } from '@/lib/lifecycle/refund'

export function RefundRow({ request }: { request: RefundRequestRow }) {
  const [pending, startTransition] = useTransition()
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const router = useRouter()

  return (
    <div className="space-y-2 p-4 text-sm">
      <p className="font-medium">₹{(request.amount / 100).toFixed(2)} — {request.reason}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => { await approveRefund(request.id); router.refresh() })}
          className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
        >
          Approve
        </button>
        <button type="button" onClick={() => setShowReject(true)} className="rounded border px-3 py-1">
          Reject
        </button>
      </div>
      {showReject && (
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border p-1"
            placeholder="Rejection reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <button
            type="button"
            disabled={pending || !rejectReason.trim()}
            onClick={() =>
              startTransition(async () => {
                await rejectRefund(request.id, rejectReason)
                router.refresh()
              })
            }
            className="rounded bg-destructive px-3 py-1 text-destructive-foreground disabled:opacity-50"
          >
            Confirm Reject
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add lib/payments/ lib/lifecycle/refund.ts lib/lifecycle/refund.test.ts app/admin/refunds/
git commit -m "feat: add refund request/approval workflow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Support tickets

**Files:**
- Create: `lib/actions/support.ts`
- Create: `lib/actions/support.test.ts`
- Create: `app/admin/support/page.tsx`
- Create: `app/admin/support/ticket-row.tsx`
- Create: `app/support/new/page.tsx` (student/organizer-facing "contact support" entry)
- Create: `app/support/new/support-form.tsx`

**Interfaces:**
- Consumes: `supportTickets` table, `recordAdminAction` (Task 2).
- Produces: `createTicket(input: {category: SupportCategory; priority?:
  SupportPriority; subject: string; description: string;
  relatedRegistrationId?: string; relatedMunId?: string}):
  Promise<SupportTicketRow>`, `listTickets(filters?: {status?:
  SupportStatus}): Promise<SupportTicketRow[]>`, `assignTicket(ticketId:
  string, assigneeId: string): Promise<SupportTicketRow>`,
  `updateTicketStatus(ticketId: string, status: SupportStatus,
  resolutionNotes?: string): Promise<SupportTicketRow>`.

- [ ] **Step 1: Write failing tests**

```ts
// lib/actions/support.test.ts
import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users, supportTickets, adminActions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTicket, listTickets, assignTicket, updateTicketStatus } from './support'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

describe('createTicket', () => {
  it('creates a NEW ticket with default NORMAL priority', async () => {
    const [student] = await db.insert(users).values({ name: 'S', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const ticket = await createTicket({ category: 'PAYMENT', subject: 'Payment failed', description: 'x' })
    expect(ticket.status).toBe('NEW')
    expect(ticket.priority).toBe('NORMAL')
    expect(ticket.createdBy).toBe(student.id)
  })

  it('throws Forbidden with no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(createTicket({ category: 'PAYMENT', subject: 'x', description: 'x' })).rejects.toThrow('Forbidden')
  })
})

describe('assignTicket', () => {
  it('sets assignedTo and status ASSIGNED, logs TICKET_ASSIGNED', async () => {
    const [student] = await db.insert(users).values({ name: 'S2', email: `s2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
    const [admin] = await db.insert(users).values({ name: 'A', email: `a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' }).returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const assigned = await assignTicket(ticket.id, admin.id)
    expect(assigned.status).toBe('ASSIGNED')
    expect(assigned.assignedTo).toBe(admin.id)

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(log.action).toBe('TICKET_ASSIGNED')
  })
})

describe('updateTicketStatus', () => {
  it('transitions to RESOLVED with resolution notes, logs TICKET_RESOLVED', async () => {
    const [student] = await db.insert(users).values({ name: 'S3', email: `s3-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
    const [admin] = await db.insert(users).values({ name: 'A2', email: `a2-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' }).returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const resolved = await updateTicketStatus(ticket.id, 'RESOLVED', 'fixed it')
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.resolutionNotes).toBe('fixed it')
  })

  it('throws Forbidden for a student trying to resolve a ticket', async () => {
    const [student] = await db.insert(users).values({ name: 'S4', email: `s4-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    await expect(updateTicketStatus(ticket.id, 'RESOLVED')).rejects.toThrow('Forbidden')
  })
})

describe('listTickets', () => {
  it('filters by status', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-x', role: 'OPERATIONS' })
    const results = await listTickets({ status: 'NEW' })
    expect(Array.isArray(results)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/support.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/actions/support.ts**

```ts
'use server'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportTickets } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import type { SupportCategory, SupportPriority, SupportStatus } from '@/lib/db/schema-enums'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type SupportTicketRow = typeof supportTickets.$inferSelect

export interface CreateTicketInput {
  category: SupportCategory
  priority?: SupportPriority
  subject: string
  description: string
  relatedRegistrationId?: string
  relatedMunId?: string
}

/** Any authenticated user (student/organizer/admin) can open a ticket. */
export async function createTicket(input: CreateTicketInput): Promise<SupportTicketRow> {
  const session = await getSession()
  if (!session) throw new Error('Forbidden')

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      createdBy: session.userId,
      category: input.category,
      priority: input.priority ?? 'NORMAL',
      subject: input.subject,
      description: input.description,
      relatedRegistrationId: input.relatedRegistrationId,
      relatedMunId: input.relatedMunId,
    })
    .returning()

  return ticket
}

export async function listTickets(filters: { status?: SupportStatus } = {}): Promise<SupportTicketRow[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  if (filters.status) {
    return db.select().from(supportTickets).where(eq(supportTickets.status, filters.status))
  }
  return db.select().from(supportTickets)
}

export async function assignTicket(ticketId: string, assigneeId: string): Promise<SupportTicketRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(supportTickets)
      .set({ assignedTo: assigneeId, status: 'ASSIGNED', updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId))
      .returning()

    await recordAdminAction(tx, session.userId, 'TICKET_ASSIGNED', 'support_ticket', ticketId)

    return updated
  })
}

export async function updateTicketStatus(
  ticketId: string,
  status: SupportStatus,
  resolutionNotes?: string,
): Promise<SupportTicketRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(supportTickets)
      .set({ status, resolutionNotes, updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId))
      .returning()

    if (status === 'RESOLVED') {
      await recordAdminAction(tx, session.userId, 'TICKET_RESOLVED', 'support_ticket', ticketId, resolutionNotes)
    }

    return updated
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/support.test.ts`
Expected: PASS.

- [ ] **Step 5: Build admin support pages**

```tsx
// app/admin/support/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { listTickets } from '@/lib/actions/support'
import { TicketRow } from './ticket-row'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

export default async function SupportPage() {
  const session = await getSession()
  if (!session || !REVIEW_ROLES.includes(session.role)) redirect('/')

  const tickets = await listTickets()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Support Tickets</h1>
      <div className="divide-y rounded-md border">
        {tickets.map((t) => (
          <TicketRow key={t.id} ticket={t} />
        ))}
        {tickets.length === 0 && <p className="p-4 text-sm text-muted-foreground">No tickets.</p>}
      </div>
    </div>
  )
}
```

```tsx
// app/admin/support/ticket-row.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateTicketStatus, type SupportTicketRow } from '@/lib/actions/support'

export function TicketRow({ ticket }: { ticket: SupportTicketRow }) {
  const [pending, startTransition] = useTransition()
  const [notes, setNotes] = useState('')
  const router = useRouter()

  return (
    <div className="space-y-2 p-4 text-sm">
      <p className="font-medium">{ticket.subject} — {ticket.category} — {ticket.priority}</p>
      <p className="text-muted-foreground">{ticket.description}</p>
      <p className="text-xs">Status: {ticket.status}</p>
      {ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && (
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border p-1"
            placeholder="Resolution notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateTicketStatus(ticket.id, 'RESOLVED', notes)
                router.refresh()
              })
            }
            className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Build student/organizer-facing "contact support" entry**

```tsx
// app/support/new/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { SupportForm } from './support-form'

export default async function NewSupportTicketPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Contact Support</h1>
      <SupportForm />
    </div>
  )
}
```

```tsx
// app/support/new/support-form.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTicket } from '@/lib/actions/support'
import type { SupportCategory } from '@/lib/db/schema-enums'

const CATEGORIES: SupportCategory[] = [
  'REGISTRATION', 'PAYMENT', 'REFUND', 'MUN_INFO', 'ACCOUNT', 'CERTIFICATE', 'ORGANIZER', 'TECHNICAL', 'SAFETY_POLICY',
]

export function SupportForm() {
  const [category, setCategory] = useState<SupportCategory>('TECHNICAL')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (submitted) {
    return <p className="text-sm">Ticket submitted. Our team will follow up.</p>
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          await createTicket({ category, subject, description })
          setSubmitted(true)
        })
      }}
      className="space-y-3"
    >
      <select
        className="w-full rounded border p-2 text-sm"
        value={category}
        onChange={(e) => setCategory(e.target.value as SupportCategory)}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <input
        className="w-full rounded border p-2 text-sm"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        required
      />
      <textarea
        className="w-full rounded border p-2 text-sm"
        placeholder="Describe the issue"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        Submit
      </button>
    </form>
  )
}
```

- [ ] **Step 7: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/support.ts lib/actions/support.test.ts app/admin/support/ app/support/
git commit -m "feat: add support ticket lifecycle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Admin nav shell, overview dashboard, audit history view

**Files:**
- Create: `app/admin/layout.tsx`
- Modify: `app/admin/page.tsx` (create if it doesn't exist — check first)
- Create: `lib/actions/audit-history.ts`
- Create: `lib/actions/audit-history.test.ts`
- Create: `app/admin/audit/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-7 (`listOrganizers` counts,
  `getReviewQueue`, `getModuleReviewQueue`, `listTickets`,
  `listPaymentExceptions`, `listRefundRequests`, `adminActions` +
  `verificationLogs` tables).
- Produces: `getAuditHistory(targetType: string, targetId: string):
  Promise<AuditEntry[]>` — merged, timestamp-sorted view.

- [ ] **Step 1: Write failing test for getAuditHistory**

```ts
// lib/actions/audit-history.test.ts
import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users, muns, adminActions, verificationLogs } from '@/lib/db/schema'
import { getAuditHistory } from './audit-history'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

describe('getAuditHistory', () => {
  it('merges admin_actions and verification_logs for a mun, sorted by timestamp', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' })

    const [admin] = await db.insert(users).values({ name: 'A', email: `a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' }).returning()
    const [organizer] = await db.insert(users).values({ name: 'O', email: `o-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' }).returning()
    const [mun] = await db.insert(muns).values({ organizerId: organizer.id, name: 'Audit Mun', slug: `audit-mun-${crypto.randomUUID()}` }).returning()

    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'PUBLISHED' })
    await db.insert(adminActions).values({ actorId: admin.id, action: 'MUN_SUSPENDED', targetType: 'mun', targetId: mun.id, reason: 'x' })

    const history = await getAuditHistory('mun', mun.id)
    expect(history.length).toBe(2)
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['PUBLISHED', 'MUN_SUSPENDED']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/actions/audit-history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/actions/audit-history.ts**

```ts
'use server'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, verificationLogs } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export interface AuditEntry {
  action: string
  actorId: string
  reason: string | null
  createdAt: Date
}

/**
 * Merges admin_actions (general admin actions) and verification_logs (mun
 * lifecycle transitions) for one target, sorted oldest-first. Only 'mun'
 * targetType has verification_logs entries — other target types return
 * admin_actions rows only.
 */
export async function getAuditHistory(targetType: string, targetId: string): Promise<AuditEntry[]> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const generalActions = await db
    .select({
      action: adminActions.action,
      actorId: adminActions.actorId,
      reason: adminActions.reason,
      createdAt: adminActions.createdAt,
    })
    .from(adminActions)
    .where(eq(adminActions.targetId, targetId))

  const lifecycleActions =
    targetType === 'mun'
      ? await db
          .select({
            action: verificationLogs.action,
            actorId: verificationLogs.reviewerId,
            reason: verificationLogs.notes,
            createdAt: verificationLogs.createdAt,
          })
          .from(verificationLogs)
          .where(eq(verificationLogs.munId, targetId))
      : []

  return [...generalActions, ...lifecycleActions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/actions/audit-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the admin nav shell**

```tsx
// app/admin/layout.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/review', label: 'Applications' },
  { href: '/admin/verification', label: 'Verification' },
  { href: '/admin/registrations', label: 'Registrations' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/refunds', label: 'Refunds' },
  { href: '/admin/organizers', label: 'Organizers' },
  { href: '/admin/support', label: 'Support' },
  { href: '/admin/audit', label: 'Audit Log' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session || !REVIEW_ROLES.includes(session.role)) redirect('/')

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 shrink-0 border-r p-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="block rounded px-2 py-1 text-sm hover:bg-muted">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

Run: `grep -rln "app/admin/review/page.tsx\|app/admin/verification/page.tsx"
-e "REVIEW_ROLES"` first to check whether those existing pages ALSO redirect
individually — if so, that's fine (defense in depth, matches existing
comment "the real boundary is requireRole in the server actions, not the
page"), no need to remove their own checks.

- [ ] **Step 6: Build overview dashboard**

Check if `app/admin/page.tsx` already exists (`ls app/admin/page.tsx`). If
it doesn't:

```tsx
// app/admin/page.tsx
import { getReviewQueue, getModuleReviewQueue } from '@/lib/actions/admin-review'
import { listTickets } from '@/lib/actions/support'
import { listPaymentExceptions } from '@/lib/actions/admin-search'
import { listRefundRequests } from '@/lib/lifecycle/refund'

export default async function AdminOverviewPage() {
  const [applications, modules, tickets, exceptions, refunds] = await Promise.all([
    getReviewQueue({ limit: 1 }),
    getModuleReviewQueue({ limit: 1 }),
    listTickets({ status: 'NEW' }),
    listPaymentExceptions(),
    listRefundRequests(),
  ])

  const cards = [
    { label: 'Pending Applications', value: applications.total },
    { label: 'Pending Module Reviews', value: modules.total },
    { label: 'Open Tickets', value: tickets.length },
    { label: 'Payment Exceptions', value: exceptions.length },
    { label: 'Pending Refunds', value: refunds.length },
  ]

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-md border p-4">
            <p className="text-2xl font-semibold">{c.value}</p>
            <p className="text-sm text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

If `app/admin/page.tsx` already exists, read it first and merge these cards
into whatever it currently renders rather than overwriting.

- [ ] **Step 7: Build audit log viewer**

```tsx
// app/admin/audit/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']

export default async function AuditLogPage() {
  const session = await getSession()
  if (!session || !REVIEW_ROLES.includes(session.role)) redirect('/')

  const rows = await db
    .select({
      id: adminActions.id,
      action: adminActions.action,
      targetType: adminActions.targetType,
      targetId: adminActions.targetId,
      reason: adminActions.reason,
      createdAt: adminActions.createdAt,
      actorName: users.name,
    })
    .from(adminActions)
    .innerJoin(users, eq(adminActions.actorId, users.id))
    .orderBy(desc(adminActions.createdAt))
    .limit(100)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit Log</h1>
      <div className="divide-y rounded-md border">
        {rows.map((row) => (
          <div key={row.id} className="p-4 text-sm">
            <p className="font-medium">{row.action} — {row.targetType}/{row.targetId}</p>
            <p className="text-muted-foreground">
              {row.actorName} · {row.createdAt.toLocaleString()} {row.reason ? `· ${row.reason}` : ''}
            </p>
          </div>
        ))}
        {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No admin actions yet.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run full test suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 9: Manual smoke check**

Run: `npm run dev`, sign in as `admin@munhub.test` (seeded per project
memory), visit `/admin`, confirm the nav shell renders all 9 links and each
page loads without error. Stop the dev server after checking.

- [ ] **Step 10: Commit**

```bash
git add app/admin/layout.tsx app/admin/page.tsx app/admin/audit/ lib/actions/audit-history.ts lib/actions/audit-history.test.ts
git commit -m "feat: add admin nav shell, overview dashboard, audit log viewer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan Self-Review Notes

- **Spec coverage:** all 7 tracks from the spec (section 1) map to Tasks
  2-8; Task 1 is the shared schema foundation the spec's section 7 calls
  for. Section 3's data model (all 3 new tables, `SUSPENDED` status, users
  columns) covered in Task 1. Section 4's action list covered across Tasks
  2-8. Section 5's UI list covered — 9 of the 10 nav items spec calls out
  (all but "Applications"/"Verification" which already existed pre-spec).
  Section 6 testing requirements (row-lock concurrency tests, suspended
  login rejection, audit-row-per-action) covered in Tasks 2/3/4/6. Section 7
  migration covered in Task 1. Section 8 dependency order followed:
  Task 1→2 foundation, Tasks 3/4/5/7 parallel-safe, Task 6 depends on
  Task 5's schema but not its code, Task 8 last (depends on all).
- **Type consistency check:** `recordAdminAction`'s `tx` first-arg signature
  (Task 2) is used identically in Tasks 3/4/6/7. `AdminAction`/`RefundStatus`/
  `SupportCategory`/`SupportPriority`/`SupportStatus` types from Task 1 are
  imported, never redefined, in later tasks. `getSession`/`requireRole`
  call pattern (`const session = await getSession(); requireRole(session,
  [...])`) kept identical to the existing `lib/actions/admin-review.ts`
  style throughout.
- **Known implementer judgment calls flagged inline:** exact drizzle-kit
  migration command (Task 1 Step 4), exact transaction-type name to replace
  `any` with (Task 4 Step 7), exact `PaymentsAdapter` instance import path
  (Task 6 Step 5), and whether `app/admin/page.tsx` pre-exists (Task 8 Step
  6) — each calls out a `grep`/`ls` check rather than guessing, since this
  plan was written without shell access to re-verify every file at task
  time.
