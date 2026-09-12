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
- **Neon** is the target cloud Postgres provider (not Supabase Postgres). **Live as of 2026-09-13** — `.env`'s `DATABASE_URL` now points at the user's real Neon instance (not local Docker), migrated + seeded. Local `docker-compose.yml` Postgres still works as a fallback if `.env` gets pointed back at it, but the default dev DB is now Neon. Tests pass against it (95/95) but run noticeably slower (~15s vs <1s local) since every query is now a real network round-trip — worth knowing if a test run feels slow, it's not broken.
- Auth/Payments/Storage: mock adapters behind interfaces (`lib/auth/adapter.ts`, `lib/payments/adapter.ts`, `lib/storage/adapter.ts`) — real providers (Razorpay confirmed for payments; auth/storage provider undecided) drop in later without touching call sites
- Routing: path-based `/mun/[slug]` — wildcard subdomains deferred

## Session split (two parallel Claude Code sessions on this repo)

This session (**mun-hub-b2**) owns backend/data:
- `prisma/` — n/a, removed. Schema lives in `lib/db/schema.ts` (Drizzle)
- `lib/db/`, `lib/auth/`, `lib/payments/`, `lib/storage/`, `lib/lifecycle/`, `lib/actions/`, `lib/types/`, `lib/notifications/`

UI/pages/components ownership:
- `app/**/page.tsx`, `app/**/*.tsx` (except route handlers under `app/api/`), `components/` (beyond base shadcn primitives)
- **mun-hub-93** built the first UI pass ("Diplomatic Modernism" design). **2026-09-13**: user asked for a full frontend rebuild against a new Airtable-style editorial design system (`DESIGN-airtable.md` — coral/forest/dark-navy signature cards, Haas Grotesk, replaces Diplomatic Modernism entirely). **mun-hub-02** took over and owns UI going forward; mun-hub-93 stood down cleanly. If a third UI session ever spins up, it inherits from mun-hub-02's state, not mun-hub-93's.

**Contract surface** (backend session lands these, UI session imports them, never edits them): `lib/types/*.ts`, `lib/actions/*.ts`, `lib/db/schema.ts`.

Coordinate via SendMessage before touching the other side's files. Both sessions run full-autonomous, caveman-terse commit/PR text stays normal (not caveman) per user's global caveman rules.

## Known corrections mid-build (so future agents don't repeat the mistake)

- Do NOT use Prisma. User explicitly said no, twice.
- Do NOT assume Supabase Postgres — DB is Neon.
- Auth provider is NOT decided yet (was drafted as Supabase Auth in early spec, not confirmed) — keep behind adapter interface until user confirms.

## UI status (mun-hub-02 rebuild, 2026-09-13 — supersedes the mun-hub-93 "Diplomatic Modernism" notes below)

Full frontend rebuilt against `DESIGN-airtable.md`. All 8 pages done: homepage, marketplace/`muns`, MUN detail, registration funnel (`/register/[slug]`), student dashboard, organizer dashboard + application, admin review queue, sign-in. 4 required review agents run (design-critic, a11y-architect, integration-enforcer, adversarial-coach) with findings fixed — button-contrast tailwind-merge collisions (two instances, both fixed with dedicated variants, not `!important` hacks), dark-mode CTA band invisibility, an open-redirect backslash bypass in login, orphaned components deleted, a11y focus/error-handling gaps. adversarial-coach also found 3 real backend bugs during this pass (see Registration integrity section below) — cross-session review catching backend issues is a good sign the review discipline is working, not just rubber-stamping.

Committed as `fde91a2` (71 files) on mun-hub-02's side. tsc clean, 97/97 tests passing.

<details><summary>Superseded: original mun-hub-93 "Diplomatic Modernism" notes (kept for history, not current)</summary>

Design tokens landed in `app/globals.css` — deep blue primary, brass accent, navy dark mode (never near-black — keep dark bg chroma >= 0.05 or it reads charcoal). Fraunces (display) + Inter (body, tabular nums) + JetBrains Mono (technical). `lib/mun-status.ts` held the 15-state MunStatus → {label, tone, icon} mapping — 3-channel encoding (color + icon + label) since 15 states collapse to 6 tones, badge text used dedicated `--{tone}-text` tokens not `-foreground`. This entire visual system was replaced by the Airtable rebuild above; the *pattern* (don't reuse foreground tokens for tinted-background text, 3-channel status encoding) may still be worth preserving if you're building a new status indicator, but the actual tokens/colors are gone.

</details>

## Registration integrity (critical invariant)

Capacity check + reservation + payment order + webhook + confirm must happen inside DB transactions per `docs/superpowers/specs/2026-09-13-mun-hub-mvp-backend-design.md` Section 3. Never trust client-supplied `userId` in any action that reads/writes a specific user's data — derive actor identity from `getSession()` server-side only (IDOR risk flagged by UI-session review, fixed in Drizzle rewrite).

`initiateRegistration`'s capacity check row-locks the registration product (`.for('update')`) inside the transaction — without this, concurrent registrations for the same product all read the same pre-insert count under Postgres READ COMMITTED and oversell. Covered by a concurrency regression test (`lib/actions/registration.test.ts`, 10 concurrent callers vs capacity 3). The payments webhook only confirms a registration that is still `PAYMENT_PENDING` (never resurrects a TTL-expired/cancelled one) and releases the seat (sets `CANCELLED`) on a failed payment instead of leaving it stuck.

**2026-09-13 follow-up (found by mun-hub-02's adversarial-coach, fixed same day):** the row lock only serialized the capacity count — it did NOT stop the *same* user from holding multiple simultaneous active registrations for one product (double-charge risk). Fixed: `initiateRegistration` now also checks, inside the same locked transaction, whether the caller already has an active (PENDING/PAYMENT_PENDING/CONFIRMED) registration for that product and rejects a second one. Separately, the webhook's `paid` branch used to mark the payment `PAID` unconditionally even if the registration had already expired/been cancelled — money moved but the registration stayed dead, silently orphaning the charge. Fixed: webhook now row-locks the registration, and only marks the payment `PAID` + confirms if the registration is still `PAYMENT_PENDING`; otherwise marks it `REFUNDED` (honest — a refund is owed) and leaves the registration alone. Response body now includes `refundOwed: boolean`. Same missing-row-lock bug existed in `transitionMun` (two admins deciding the same mun concurrently) — fixed with the same `.for('update')` pattern.

## Backend status: all 7 MVP verticals landed (2026-09-13)

Foundation (schema/adapters/types), mun-config CRUD, student/organizer dashboards, marketplace+`getMunBySlug`, admin-review+auth, seed data, organizer-application+lifecycle, registration+payment (incl. the overbooking fix above) — all committed to `main`, 95/95 tests passing, `tsc --noEmit` clean.

**Known gap, not yet fixed:** `signIn(email)` in `lib/actions/auth.ts` is passwordless mock auth (looks up by email, no password check) — flagged by its own red-team review as a genuine unauthenticated-admin-takeover path. Fine for local dev/demo only. Must not be reachable from any environment exposed to the internet before real auth (password or OAuth) replaces it.

## Deploy config (scaffolded, not yet deployed)

`@opennextjs/cloudflare` + wrangler installed, `wrangler.jsonc` + `open-next.config.ts` added, `cf:preview`/`cf:deploy` npm scripts wired. No deploy has been run — waiting on the user's Cloudflare API token (paste it directly in whichever session needs it; **never relay secrets between sessions** — a peer session correctly refused to relay one and routed the user back to paste it directly, that's the right call) and on the frontend rebuild finishing (now done, so deploy is unblocked pending the token). `.dev.vars.example` mirrors `.env.example` for Cloudflare's local-secrets convention.

## Test/dev DB isolation (critical, learn from this)

**`.env` points at the team's live Neon instance — tests must NEVER read it.** Vitest loads `.env.test` (committed, safe mock-only values, pinned to local Docker Postgres) via `vitest.setup.ts`, regardless of what `.env` says. This exists because a test suite ran against Neon before this was caught and wrote 472 junk MUNs + 941 junk users into the DB the dev server (and anyone browsing it) reads from — cleaned up once with user confirmation (mass-delete on shared cloud data, correctly blocked by the auto-mode classifier until confirmed). If you ever see `.env.test` deleted or `vitest.setup.ts` pointed back at `.env`, that's a regression — fix it before running tests.

Local Docker Postgres (`docker-compose.yml`, `npm run db:up`) is what tests actually run against. It's accumulated a lot of historical test-run junk data of its own — harmless since nobody browses it, but don't be surprised by hundreds of "Config Mun"/"Test Mun"/etc rows if you inspect it directly.

## Seed data

`npm run db:seed` (idempotent — safe to re-run) currently seeds:
- 3 fixed users: `admin@munhub.test` (ADMIN), `student@munhub.test` (STUDENT, VIT Vellore), plus one ORGANIZER account per MUN (email pattern `organizer-<slug-ish>@munhub.test`)
- 2 placeholder demo MUNs: Oxford MUN 2027, VIT MUN 2027 (generic UNSC/UNHRC committees, fictional)
- **6 real Hyderabad MUN conferences** (added 2026-09-13, user's focus market): BITSMUN Hyderabad '25, CBITMUN 2026, Shri HMUN 2026, Vista MUN 2025, St. Francis College MUN 2025, M-UN 2025 — real names/dates/themes/committees researched via web search (see commit `c12b14b` for sources), each with its own seeded organizer. Registration fees are plausible placeholders (no conference in this circuit publicly discloses fees — confirmed by research). Deliberately excluded lower-confidence finds (ISB MUN, OU MUN, JNTUH MUN, SymbiMUN, Resolve MUN) since their dates/committees couldn't be confirmed — don't add them without re-researching and confirming first, seeding an unconfirmed date as if real defeats the point.
- `MunSeed` supports per-conference overrides (`theme`, `description`, `startDate`/`endDate`, `committees`, `registrationProducts`) with fallback to generic defaults — add new real MUNs by adding a `MUN_SEEDS` entry with an `organizer` (name + email), not by hand-wiring a new organizer block in `main()`.
- `seedMun` backfills `organizerId` on re-seed if it's changed (doesn't silently skip a stale value on existing rows).
