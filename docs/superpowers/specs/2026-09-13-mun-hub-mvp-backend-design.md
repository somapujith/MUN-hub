# MUN Hub MVP — Backend/Data Design

**Status:** Approved
**Scope:** Section 28 MVP only (Student MVP + Organizer MVP + Admin MVP). No Passport, certificates, QR, reviews, recommendations (Phase 2+).
**Session split:** This session owns backend/data (feature-vertical, full-stack slices where a vertical needs it). Parallel session owns UI/pages/components. Both share `/prisma/schema.prisma`, `/lib/types`, `/lib/actions/*` as the contract.

## 1. Stack

- Next.js (App Router, current stable via create-next-app), TypeScript, Tailwind, shadcn/ui
- Server Actions + Route Handlers only — no separate Express backend (PRD Section 22)
- Drizzle ORM + `postgres` driver + Postgres. Local Postgres (Docker) for dev now; swaps to **Neon** (cloud Postgres, user's actual target — not Supabase Postgres) later via connection-string swap only, no schema rewrite (Drizzle schema is plain SQL-shaped, portable across any Postgres).
- Auth: mock adapter behind `lib/auth/adapter.ts` interface — swaps to a real provider later (Supabase Auth or other — undecided, adapter isolates the choice).
- Payments: mock Razorpay adapter behind `lib/payments/adapter.ts` — swaps to real Razorpay later. Webhook signature verification stubbed but structurally real (HMAC check against a mock secret) so swap-in is drop-in.
- Storage: mock adapter behind `lib/storage/adapter.ts` — swaps to Cloudflare R2 later.
- Routing: path-based `/mun/[slug]` — no wildcard subdomain middleware yet (PRD Section 15 deferred).

**Correction note:** original draft of this spec specified Prisma. User corrected mid-build: no Prisma, cloud DB is Neon, ORM is Drizzle. This version supersedes.

## 2. Data Model (Prisma schema, from PRD Section 24)

Entities: `User`, `Mun`, `Committee`, `Portfolio`, `RegistrationProduct`, `Registration`, `Payment`, `OrganizerApplication`, `VerificationLog`. (Certificate/Achievement tables scaffolded in schema per PRD but no logic/UI in MVP — keeps Phase 2 migration-free.)

Key enums:
- `MunStatus`: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CHANGES_REQUESTED, ONBOARDING, CONTENT_SUBMITTED, VERIFICATION, PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED, CONFERENCE_ACTIVE, COMPLETED, ARCHIVED (PRD Section 14)
- `RegistrationStatus`: PENDING, PAYMENT_PENDING, CONFIRMED, CANCELLED, REFUNDED, ATTENDED, NO_SHOW (PRD Section 18)
- `Role`: STUDENT, ORGANIZER, OPERATIONS, ADMIN, SUPER_ADMIN (PRD Section 21)

Tenant isolation: every tenant-scoped query filters by `mun_id`; enforced in a shared `lib/db/tenant-guard.ts` helper, not left to callers.

## 3. Registration Integrity (PRD Section 38)

Reservation → payment order → webhook → verify → confirm, as a single Prisma transaction per step:
1. Check capacity (`RegistrationProduct.capacity` vs confirmed+pending count) inside transaction.
2. Create `Registration` row status `PENDING`, with a reservation TTL (expires_at).
3. Create mock payment order, `Registration` → `PAYMENT_PENDING`.
4. Mock webhook fires → server-side verify (HMAC) → `Registration` → `CONFIRMED`, `Payment` → `status: paid`.
5. Expired PENDING/PAYMENT_PENDING reservations released by a sweep function (cron-less: checked lazily on next capacity read, since no queue infra yet).

Idempotency: webhook handler keyed on `provider_order_id`, unique constraint prevents double-confirm.

## 4. RBAC

Middleware-level guard reading role from mock auth session, plus per-action authorization checks in every server action (never trust client role claims). Ops/Admin/Super Admin distinctions per PRD Section 21 enforced as role checks in `lib/auth/authorize.ts`.

## 5. MUN Lifecycle & Admin Review (PRD Section 12, 14, 37)

State machine in `lib/lifecycle/mun-state-machine.ts`: explicit allowed-transitions map, every transition writes a `VerificationLog` row (actor, action, notes, timestamp). Organizer-visible notes vs internal-only notes are separate fields.

## 6. What this session builds (backend verticals)

1. **Foundation (solo, blocking)**: Next.js scaffold, Prisma schema + migrations, shared types (`lib/types`), mock adapters (auth/payments/storage), seed script.
2. Marketplace query layer (search/filter/sort server actions + data fetchers)
3. Organizer application + admin review/publish workflow (state machine + actions)
4. Committee/Portfolio/Registration-product CRUD actions
5. Registration + capacity + idempotent payment flow
6. Mock payment adapter + webhook route handler
7. RBAC/authorize helpers + mock auth adapter
8. Notifications stub (logs to console/DB table, real email later)
9. Seed/fixture data for realistic demo (MUNs, committees, portfolios, users)
10. Test coverage per vertical (integration tests hitting real local Postgres, not mocked DB)

## 7. Explicitly out of scope (MVP)

MUN Passport, public student profiles, certificates/achievements logic, QR pass generation, saved MUNs, recommendations, reviews/ratings, wildcard subdomains, real Razorpay/Supabase/R2 keys (adapters ready, keys pending from user), background job infra (Cloudflare Queues), analytics/monitoring wiring (PostHog/Sentry).

## 8. Contract with parallel UI session

- `prisma/schema.prisma` — source of truth for all data shapes
- `lib/types/*.ts` — derived/shared TS types
- `lib/actions/*.ts` — server actions the UI session calls directly (documented JSDoc per action: inputs, outputs, thrown errors)
- These three land in the first commit before fanout begins so the other session can build against them immediately.
