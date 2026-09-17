# Autonomous run — working context (lead: mun-hub-62)

Read this before touching anything in this run. `PLAN.md` has lanes and gates; this file has
the facts every lane needs and the audit the work list came from.

## Environment facts

- One shared working tree at `A:\Coding\Projects\Mun-hub\MUN-hub`, branch `main`, remote
  `origin` (GitHub `somapujith/MUN-hub`). Several Claude sessions edit it concurrently.
  **Commit only your own paths**: `git commit -m "..." -- <paths>`; check `git diff <file>`
  first. Never `git add -A`, `git commit -a`, bare `git commit`, `git stash`, `git checkout --`.
- `.env` points at **production Neon**. Never run migrate/seed with it. Local Docker Postgres:
  `postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub` (container `mun-hub-db-1`).
  Vitest loads `.env.test` automatically. Run targeted tests with
  `npx vitest run <files> --no-file-parallelism`.
- Dev servers on :5174 (web) and :3001 (API) are shared — don't kill or restart them.
- Web: Vite + React Router v7 + TanStack Query (`web/`), checks: `npx tsc -b --noEmit`,
  `npx oxlint <paths>`. Server: Hono (`server/`), check: `npx tsc --noEmit -p tsconfig.json`.
- Workers never populate custom vars into `process.env`: in `/server` and any `lib/` module it
  imports, read custom vars only via `getRuntimeEnv('X')` (`lib/runtime-env.ts`).
- Never cache an I/O resource at module scope (Workers request isolation) — see CLAUDE.md.
- `cn()` (the `cn` package) drops custom `text-*` size tokens when a text colour follows; don't
  combine a custom size token and a colour through `cn`.
- Seeded demo accounts share password `munhub-demo` (`admin@munhub.test`,
  `student@munhub.test`, `organizer@munhub.test`, …) — local only.

## Audit summary (what this run fixes)

Launch blockers: mock checkout live in prod (free seats); nothing moves a MUN to
REGISTRATION_OPEN; organizers can't finish go-live (missing setup fields, portfolios UI,
branding UI, accommodation toggle, admin Gate-2 buttons); uploads discarded by mock storage;
security gaps (below); no delegate emails.

Security findings to close (severity from the scout):
- Critical: mock payment endpoint live; demo admin password public (prod DB unverified).
- High: in-memory per-isolate rate limiting (ineffective on Workers; login key allows password
  spraying across accounts); signup has no abuse controls.
- Medium: unpublished MUN data public (status param + by-id reads incl. contact person PII;
  unauthenticated write on GET form-fields); API trusts every `*.munhub.in` origin with
  credentials (confirmed live); no security headers; OPERATIONS can suspend admins; reset links
  built from request Origin + localhost trusted in prod + no per-email throttle; guardian
  consent optional, no deletion/export, staff PII reads not logged.
- Low: plaintext session/reset tokens, 30-day sessions, password change keeps other sessions;
  no admin 2FA; enumeration (signup 409, login timing); scrypt cost; latent open redirect
  (`/.//evil.com`); no URL/length validation on organizer fields; uploads trust declared type;
  AES-GCM tag length; NODE_ENV-dependent Secure cookie; console adapter logs OTP/reset links;
  unused Idempotency-Key; webhook has no amount check/replay window.

Out of scope for this run (Phase 2): MUN Passport, certificate issuance + verification page,
reviews, recommendations, saved MUNs, featured listings, team roles & permissions,
delegation/group registration, waitlist, bulk import, SSR/prerendering, two-person approval,
payout execution.

## Log

- 08:23 Run started. Legal/about pages committed (`39a6157`). Lanes assigned; f1 holds
  migration slot 0030. mun-hub-67 declined a lane (no direct user instruction) — payments
  moved to a lead agent.
