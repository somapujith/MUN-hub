@AGENTS.md

# MUN Hub — Project Context

Living context doc. Update this file whenever architecture, scope, or session-split decisions change — future sessions/agents read this first.

## What this is

Curated MUN (Model United Nations) marketplace + registration + organizer management platform. Full spec: `MUN_Marketplace_PRD.md`. First prototype scope: **PRD Section 28 MVP only** (student MVP + organizer MVP + admin MVP). No Passport, certificates, QR pass, reviews, recommendations — those are Phase 2+, explicitly deferred.

Design/plan docs:
- `docs/superpowers/specs/2026-09-13-mun-hub-mvp-backend-design.md` — architecture decisions
- `docs/superpowers/plans/2026-09-13-mun-hub-mvp-backend.md` — task-by-task implementation plan (backend/data)

## Stack (locked decisions, don't re-litigate without asking user)

- Next.js App Router, TypeScript, Tailwind, shadcn/ui
- Server Actions + Route Handlers only — no separate backend service
- **Drizzle ORM** (not Prisma — user corrected this mid-build) + `postgres` driver
- **Neon** is the target cloud Postgres provider (not Supabase Postgres) — local Docker Postgres for dev now, swap `DATABASE_URL` to Neon connection string later, no schema changes needed
- Auth/Payments/Storage: mock adapters behind interfaces (`lib/auth/adapter.ts`, `lib/payments/adapter.ts`, `lib/storage/adapter.ts`) — real providers (Razorpay confirmed for payments; auth/storage provider undecided) drop in later without touching call sites
- Routing: path-based `/mun/[slug]` — wildcard subdomains deferred

## Session split (two parallel Claude Code sessions on this repo)

This session (**mun-hub-b2**) owns backend/data:
- `prisma/` — n/a, removed. Schema lives in `lib/db/schema.ts` (Drizzle)
- `lib/db/`, `lib/auth/`, `lib/payments/`, `lib/storage/`, `lib/lifecycle/`, `lib/actions/`, `lib/types/`, `lib/notifications/`

Other session (**mun-hub-93**) owns UI/pages/components:
- `app/**/page.tsx`, `app/**/*.tsx` (except route handlers under `app/api/`), `components/` (beyond base shadcn primitives)

**Contract surface** (backend session lands these, UI session imports them, never edits them): `lib/types/*.ts`, `lib/actions/*.ts`, `lib/db/schema.ts`.

Coordinate via SendMessage before touching the other side's files. Both sessions run full-autonomous, caveman-terse commit/PR text stays normal (not caveman) per user's global caveman rules.

## Known corrections mid-build (so future agents don't repeat the mistake)

- Do NOT use Prisma. User explicitly said no, twice.
- Do NOT assume Supabase Postgres — DB is Neon.
- Auth provider is NOT decided yet (was drafted as Supabase Auth in early spec, not confirmed) — keep behind adapter interface until user confirms.

## Registration integrity (critical invariant)

Capacity check + reservation + payment order + webhook + confirm must happen inside DB transactions per `docs/superpowers/specs/2026-09-13-mun-hub-mvp-backend-design.md` Section 3. Never trust client-supplied `userId` in any action that reads/writes a specific user's data — derive actor identity from `getSession()` server-side only (IDOR risk flagged by UI-session review, fixed in Drizzle rewrite).
