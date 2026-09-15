# Next.js -> Vite/React SPA + Standalone Node API - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Next.js entirely. New frontend: Vite + React Router v7 (data-router mode) + TanStack Query. New backend: standalone Hono API on Node, decoupled from any frontend framework. `lib/` (actions, lifecycle, db, auth core, payments, storage, notifications, crypto) survives with minimal, mechanical changes.

**Spec:** `docs/superpowers/specs/2026-09-15-nextjs-to-react-spa-migration-design.md` — read it before touching code. This plan is its argument; the spec is the authority on every decision (framework choice, API shape, auth model, sequencing, effort estimate).

**Session split** (per spec Section 9): **this session (backend) owns Phases 0-2**; **mun-hub-b5 (frontend) owns Phases 3-6**; **both sessions do Phase 7 together** once Phase 6 is stable. Phases genuinely parallelize starting at Phase 3 — the frontend session can begin Phase 3 as soon as Phase 2's API contract is stable enough to build against (does not need to wait for 100% of Phase 2's endpoints, per the phase's own incremental nature), but Phase 1 must land first since it changes the `lib/actions/*` function signatures the frontend's typed client imports types from.

**Prerequisite, already satisfied:** the onboarding-go-live-pipeline branch (13 tasks, 30 commits) merged into main before this plan starts, per spec Section 9.6's hard sequencing requirement (refactoring 24 session call sites across two divergent branches was flagged as a security-blast-radius risk, not just a routine merge conflict).

## Global Constraints

- **Never accept a client-supplied `userId` or `role`.** This was already true; the migration must not weaken it. Every Hono handler resolves the actor from session middleware, never from the request body.
- **`lib/db/schema.ts` is byte-identical after this work.** Zero migrations. This is a framework migration, not a schema change.
- **No handler imports `db`.** Handlers are transport adapters only: parse -> validate (Zod, strict) -> call exactly one `lib/` function with the resolved session -> serialize the result or throw for the error middleware. Automatic review reject otherwise.
- **`vitest.setup.ts`'s `.env.test` pinning is a hard invariant, non-negotiable.** New API integration tests inherit it. Do not create a parallel Vitest config for `/server` that skips this — the project has a documented incident (472 junk MUNs written to live Neon) from exactly this class of mistake.
- **No Semgrep, anywhere, in any form.** Not the MCP tool, not a CI/guard script that would invoke it, not a review step that routes through it. If a task would otherwise need it, redesign the task instead (use the project's other review agents: red-team, adversarial-coach, or manual review).
- **Files 200-400 lines typical, 800 max.** One route file per existing action file (Phase 2) keeps this satisfiable.
- **Run `npx tsc --noEmit` and the full test suite before every commit.** Every phase in this plan ends green: tsc clean, full suite passing, the still-running Next app (until Phase 7) unaffected.
- **Known environment quirk:** `npm run <script>` and `npm install`/`npm ci` are gated by a misfiring Semgrep-Guardian-adjacent hook in this environment — use `npx <binary>` directly instead. If a plain Bash/Edit call is blocked by a stray "Not logged into Semgrep Guardian" message, never attempt to log in — retry the same command once, it is a known intermittent false positive.
- **`DATABASE_URL` for local Docker Postgres:** `postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub`. `.env` in this repo points at live Neon — never let a migration or seed command run against it without an explicit override.

---

## Phase 0 — Coordination and Layout (both sessions, do first)

### Task 0.1: Send the coordination message and get acknowledgement

- [ ] **Step 1:** Send mun-hub-b5 the exact breaking-change list from spec Section 9: the 9 files / 24 `getSession()` call sites that become explicit `session` parameters (`admin-review.ts`, `support.ts`, `organizer-admin.ts`, `admin-search.ts`, `student-dashboard.ts`, `registration.ts`, `organizer-dashboard.ts`, `audit-history.ts`, `organizer-application.ts`), the app/ freeze request (no new files under `app/` after this message — existing-page fixes are fine), what's still safe to work on (`components/`, design-system work, new `lib/` business logic, tests), and the phase-split proposal (this session: Phases 0-2; mun-hub-b5: Phases 3-6; both: Phase 7).
- [ ] **Step 2:** Wait for explicit acknowledgement before starting Task 1.1. Do not proceed on an assumption of agreement.

### Task 0.2: Update CLAUDE.md's locked decision

- [ ] **Step 1:** Read the current "Stack (locked decisions)" section in `/Users/psoma/Projects/mun-hub/CLAUDE.md`. It locks "App Router" and "Server Actions + Route Handlers only — no separate backend service."
- [ ] **Step 2:** Replace that locked entry with the new architecture: Vite + React Router v7 (data-router mode) + TanStack Query frontend in `/web`; standalone Hono API on Node in `/server`; `/lib` shared and framework-agnostic, imported by both. State the reversal explicitly and date it, so a future agent doesn't read the old lock and "correct" the migration back toward Next.js. Link this plan and the design spec.
- [ ] **Step 3:** Also update the "Session split" section describing the two sessions' territory — it currently describes the old backend/UI split by directory (`lib/*` vs `app/**`); note the new split is by phase (this session: Phases 0-2 of the migration, then Phase 2 hardening + Phase 6 in parallel with mun-hub-b5's Phases 3-5, per spec Section 10's "genuinely parallelize after Phase 2" note).
- [ ] **Step 4:** Commit this doc update as its own commit, in the same session as Phase 0's other step — spec Section 9 is explicit that this must land "in the same commit as Phase 0," not deferred.

### Task 0.3: Set up the three-directory layout

- [ ] **Step 1:** Create `/server` (empty, for Phase 2) and `/web` (empty, for Phase 3) at the repo root, alongside the existing `/lib` and `/app`.
- [ ] **Step 2:** Confirm the root `tsconfig.json`'s path alias (`@/*` or equivalent) already resolves to the repo root in a way all three directories can share without a package-manager workspace migration. Per spec Section 8.2, deliberately avoid introducing a monorepo tool (pnpm workspaces, turborepo, etc.) at this stage — "one less variable." If the existing single-package tsconfig genuinely cannot support three independent build targets (Next app, Hono server, Vite SPA) without one, flag this as a plan deviation requiring a ruling before proceeding, do not silently introduce a workspace tool.
- [ ] **Step 3:** Commit the empty directories (with `.gitkeep` or a one-line `README.md` each) so the layout is visible before any real code lands in them.

**CHECKPOINT — Phase 0 exit criteria (spec Section 8.2): both sessions have acknowledged; layout is committed; nothing else has changed. tsc clean, full suite green (unaffected).**

---

## Phase 1 — Decouple `lib/` from Next.js (this session)

This is, per the spec's own framing, "the single most valuable phase — after it, `lib/` is portable regardless of whether anything else finishes." Treat the session-parameter refactor as security-sensitive code under review, not a mechanical rename — per spec Section 12's reversibility table, it's a one-way door "needing the most scrutiny" even though it's technically recoverable.

### Task 1.1: Split `lib/auth/session.ts`

- [ ] **Step 1:** Read the current file in full. Extract `getSessionByToken(token: string): Promise<Session | null>` — the existing query body verbatim (session lookup, `expiresAt` check, `users.suspended` check), with zero logic changes, just removing the `cookies()` read that currently supplies the token.
- [ ] **Step 2:** Delete `getSession()` entirely — its cookie-read responsibility moves to Hono middleware in Phase 2, not into this file. `createSession(userId)` and `destroySession(token)` are unchanged.
- [ ] **Step 3:** Confirm zero `next/headers` imports remain in this file after the edit.
- [ ] **Step 4:** Extend `lib/auth/session.test.ts` to test `getSessionByToken` directly (session lookup, expiry, suspension) — per the spec, this is easier to test than the cookie-coupled version was, so this should be a net addition to coverage, not a like-for-like swap.

### Task 1.2: Refactor `lib/actions/auth.ts`

- [ ] **Step 1:** `signIn(email)` currently sets a cookie internally via `cookies()`. Change its return type to `{userId, role, token, expiresAt}` (per spec Section 4.8's recommended additive `AuthAdapter` signature) — it creates the session row and returns everything the caller needs, but does NOT touch cookies itself.
- [ ] **Step 2:** `signOut()` currently reads the cookie directly. Change it to accept a `token: string` parameter instead of reading `cookies()` internally.
- [ ] **Step 3:** Confirm `lib/auth/adapter.ts`'s `AuthAdapter` interface still holds per spec Section 4.8 — it should, since every method becomes token-in/token-out with no ambient request context. Apply the one recommended additive change to the interface (`signIn` returning `{session, token, expiresAt}` rather than just `Session`). Do NOT add any cookie-related method to the adapter — cookie handling stays in the HTTP layer (Next's route handler today, Hono middleware after Phase 2), per the spec's explicit "deliberately NOT added" note.
- [ ] **Step 4:** Update the Next.js route handler(s) that currently call `signIn`/`signOut` expecting the old cookie-setting behavior — they now need to call `setCookie`/clear-cookie themselves using the returned token/expiry. This is the one place in Phase 1 where a Next-side file changes, and it's mechanical (the page/route already has access to `cookies()`, it just wasn't calling it directly before).

### Task 1.3: Refactor the 24 `getSession()` call sites across 9 files

Use the detailed call-site audit already produced for this plan (each function's exact line, current behavior, and any per-site complication) rather than re-deriving it from scratch. Known complications to handle explicitly, not generically:

- [ ] **Step 1: `lib/actions/admin-review.ts` (8 sites)** — `getReviewQueue`, `getMunForReview`, `reviewMunApplication`, `publishMun`, `unpublishMun`, `suspendMun`, `reinstateMun`, `getModuleReviewQueue` all become `(...args, session: Session | null)`, with `requireRole`/`session.userId` usage otherwise unchanged. `publishMun` already passes the whole `Session` object through to `publishFromQueue` — confirm that function's signature is untouched (it's Pattern A already).
- [ ] **Step 2: `lib/actions/organizer-admin.ts` (3 sites)** — `listOrganizers`, `suspendOrganizer`, `reinstateOrganizer` become explicit-session, mechanical.
- [ ] **Step 3: `lib/actions/organizer-dashboard.ts` (1 physical call site, 2 exported functions)** — this file has a LOCAL `assertOwnsOrAdmin` helper duplicating the shared `lib/auth/ownership.ts` one, with a real behavioral difference: the shared version throws `'Mun not found'` for a missing mun, this local version folds not-found into `'Forbidden'`. **Delete the local helper and import the shared one** — this consolidates a known, previously-deferred duplication (flagged in the onboarding pipeline's own final review as correctly-deferred-but-not-forgotten) as a natural side effect of this refactor. Before deleting, check `lib/actions/organizer-dashboard.test.ts` for any assertion on the old Forbidden-on-missing-mun string and update it to expect `'Mun not found'` instead — this is a deliberate, disclosed behavior change, not an accidental one. Then `getMunOverview` and `getDelegateList` both become `(munId, ..., session: Session | null)`.
- [ ] **Step 4: `lib/actions/student-dashboard.ts` (2 sites)** — `getUpcomingRegistrations`, `getPastRegistrations` become `(session: Session | null)` (no other params today). Mechanical.
- [ ] **Step 5: `lib/actions/admin-search.ts` (2 sites)** — `searchRegistrations`, `listPaymentExceptions` become explicit-session, mechanical.
- [ ] **Step 6: `lib/actions/audit-history.ts` (1 site)** — `getAuditHistory` becomes explicit-session, mechanical.
- [ ] **Step 7: `lib/actions/support.ts` (4 sites)** — `listTickets`, `assignTicket`, `updateTicketStatus` become explicit-session, mechanical. **`createTicket` is the one call site in the whole set of 24 without an already-session-aware server frame above it** — its only production caller is a client component (`app/support/new/support-form.tsx`) binding it directly as a form action. Handle this explicitly: either add a thin wrapper server action in the Next app that calls `getSession()` (still legal in Next-app code, which keeps `next/headers` until Phase 7) and forwards it to the now-parameterized `createTicket`, or leave a documented TODO for Phase 2 where the Hono route naturally supplies the session. Do not silently skip this call site.
- [ ] **Step 8: `lib/actions/registration.ts` (2 of its functions)** — `initiateRegistration` becomes `(input, session: Session | null)`; `getRegistrationById` becomes `(id, session: Session | null)`. **`getRegistrationById` has 3 production call sites** (`app/register/[slug]/actions.ts`, `app/register/[slug]/pay/page.tsx`, `app/register/[slug]/confirmation/page.tsx`) — update all 3 together, and verify each of those 3 route segments actually has its own nearby session read to source the parameter from (unlike the `/admin/*` cluster, there's no shared layout guaranteed to already hold one for `/register/[slug]/*`). `releaseExpiredReservations`/`getProductAvailability`/`getProductsAvailability` are unaffected — no `getSession()` call, out of scope.
- [ ] **Step 9: `lib/actions/organizer-application.ts` (1 site)** — `submitOrganizerApplication` takes a trusted `organizerId: string` directly in its input today (documented in-file as an intentional exception: caller must have already verified the session). Confirm whether this should also convert to an explicit `session` parameter for consistency with the rest of the plan, or whether the documented exception is deliberate enough to keep as-is — read the file's own comment before deciding, and if converting, verify its single caller still derives `organizerId` from a real verified session, not client input.
- [ ] **Step 10:** Update the systemic parallel-call sites this refactor naturally unlocks — `app/admin/page.tsx` calls 4 of these functions (`getReviewQueue`, `getModuleReviewQueue`, `listTickets`, `listPaymentExceptions`) via `Promise.all`, each currently doing its own redundant `getSession()`/cookie read, with an explicit code comment (lines 14-32) stating this redundancy is exactly why the page can't shed `force-dynamic`. Once these 4 signatures accept `session` explicitly, update this page to call `getSession()` once and pass it to all 4, and revise/remove the now-stale comment. Same opportunity, lower priority, in `app/dashboard/page.tsx`'s parallel `getUpcomingRegistrations`/`getPastRegistrations` calls.

### Task 1.4: Remove the `'use server'` directive

- [ ] **Step 1:** Once every function in `lib/actions/*` is Pattern A (explicit session, no ambient context), remove the `'use server'` directive from these files — they become plain TypeScript modules. The Next app's own route-local `actions.ts` wrapper files keep their own `'use server'` directive (they're staying, for now, as the Next app's call boundary) and now explicitly resolve the session via `getSession()` (still legal there, since `next/headers` still exists in Next-app code until Phase 7) and pass it into the `lib/actions/*` function they wrap.

### Task 1.5: Verify and commit

- [ ] **Step 1:** `grep -r "next/headers" lib/` must return zero results.
- [ ] **Step 2:** Run the full test suite. All existing tests (579 baseline, per the spec's measured count) must still pass — some may need signature updates at call sites within their own test files (mechanical, compiler-caught), but no test's actual assertions about behavior should change except the one deliberate `organizer-dashboard.ts` not-found-message change from Step 3, which must be called out explicitly in the commit message.
- [ ] **Step 3:** Run `npx tsc --noEmit` — zero new errors beyond whatever pre-existing baseline exists at this point.
- [ ] **Step 4:** Manually verify the Next app still runs and its existing pages still work end-to-end for at least one flow per session-pattern (an admin page, an organizer dashboard page, the registration funnel) — this phase must not break the still-primary Next app.
- [ ] **Step 5:** Commit. Given the security sensitivity, consider splitting into 2-3 commits (session.ts split; the 24-call-site refactor; the organizer-dashboard.ts consolidation) rather than one large commit, so each is independently reviewable.

**CHECKPOINT — Phase 1 exit criteria (spec Section 8.2): `grep -r "next/headers" lib/` returns zero; the Next app still works; the full test suite passes. This is the single most valuable phase — after it, `lib/` is portable regardless of whether anything else finishes.**

---

## Phase 2 — Standalone API Service (this session)

### Task 2.1: Hono app skeleton and middleware stack

- [ ] **Step 1:** Set up Hono with `@hono/node-server` in `/server`. Install `hono`, `@hono/node-server`, `@hono/zod-validator` (Zod is already a dependency).
- [ ] **Step 2:** Build the middleware stack in this exact order (spec Section 8.2): request-id -> logger -> CORS -> cookie/session resolution -> CSRF-origin check -> rate-limit -> routes -> error handler. Order matters: the webhook route must be mounted OUTSIDE the CSRF middleware and outside `/api/v1` entirely (spec Section 4.4) — an external caller has no Origin header and would otherwise get a confusing 403.
- [ ] **Step 3:** Session middleware (`server/middleware/session.ts`): reads the `mun_hub_session` cookie via `hono/cookie`'s `getCookie`, calls `getSessionByToken` (Phase 1's new function), sets `c.set('session', session | null)` on every request. Define the Hono `Variables` type per spec Section 13's contract: `{ session: Session | null; requestId: string }`.
- [ ] **Step 4:** `require-auth` middleware: 401 when `c.get('session')` is null. `require-role` middleware: wraps the existing `requireRole()` from `lib/auth/authorize.ts` unchanged, 403 on mismatch.
- [ ] **Step 5:** CSRF: Origin/Referer allowlist middleware on every POST/PATCH/PUT/DELETE under `/api/v1` (not the webhook route). Mismatch -> 403.
- [ ] **Step 6:** Rate limiting: verify `hono-rate-limiter` works correctly on the Node adapter specifically (spec Section 2's stated con — verify before relying on it). If inadequate, use `rate-limiter-flexible` as custom middleware (~20 lines, runtime-agnostic). Apply the limits from spec Section 4.6's table (`POST /auth/session`: 5/min/IP+email; `POST /registrations`: 10/min/session; `GET /products/availability`: 60/min/IP — note this GET does write work via a lazy sweep, rate-limit accordingly; `GET /muns`: 120/min/IP; global default 300/min/IP; webhook is IP-allowlisted, not rate-limited). Document the limit as per-instance (no Redis yet, per spec Section 11.9).
- [ ] **Step 7:** Error middleware (`server/middleware/error.ts`) implementing the exact taxonomy from spec Section 3.4 — the string-to-status mapping table, with the three hard rules: 500 responses never expose `error.message`/stack/SQL (log server-side with a request id, return only the request id); a dedicated test asserts every known thrown string maps to its expected status (so a future message-string rename that isn't reflected here fails a test, not silently misroutes); response body shape is `{ "error": { "code": "...", "message": "..." } }`.
- [ ] **Step 8:** Hard production boot-guard per spec Section 4.7: the API must refuse to start when `NODE_ENV === 'production'` and no real auth adapter is configured (mirroring `lib/crypto/field-encryption.ts`'s precedent of throwing at module load on a missing `PAYMENT_FIELD_KEY`, rather than silently running the passwordless mock in prod). This is mandatory, not optional — the spec calls it the difference between a known dev-only mock and a shipped vulnerability.

### Task 2.2: Route files, 1:1 with action files

- [ ] **Step 1:** One route file per `lib/actions/*` file (per spec Section 3.1's principle 3), following the route tree in spec Section 3.2 and the representative mappings in Section 3.3. Each handler: parse -> Zod-validate (strict mode on every body) -> call exactly one `lib/` function, passing `c.get('session')` -> serialize or throw. No handler imports `db`.
- [ ] **Step 2:** `lib/actions/mun-config.ts` -> `server/routes/mun-config.ts` (14 endpoints) — use spec Section 3.3's table as the literal mapping, including the flat-vs-nested child-route rule (create/list nest under the parent, update/delete are flat since the child id is globally unique).
- [ ] **Step 3: Fix the pre-existing bug the mapping surfaced (spec Section 3.3.1)** — `listRegistrationProducts(munId, {includeInactive:true})` is documented public/no-auth, but as a real HTTP query parameter, `includeInactive=true` must require `assertOwnsOrAdmin` and silently default to active-only for anonymous callers. This is not optional cleanup — it's a live IDOR-shaped risk this migration makes real that wasn't reachable before.
- [ ] **Step 4:** `lib/actions/registration.ts` -> `server/routes/registrations.ts` (spec Section 3.3's table) — `initiateRegistration`'s Zod schema must be `.strict()` so a stray `userId` field in the body is a 400, not silently ignored; require an `Idempotency-Key` header (Section 6.4's guarantee depends on this existing route-side, ahead of any frontend work). `getProductsAvailability`'s batched form stays primary — cap the `ids` query param length (~50) since an unbounded `inArray` becomes a real DoS vector once public (commit `8fdc449` already fixed the N+1 this replaces; don't let the HTTP layer reintroduce a variant of it).
- [ ] **Step 5:** `lib/lifecycle/go-live.ts` -> `server/routes/go-live.ts` — the highest-stakes mapping (spec Section 3.3's dedicated subsection). **`submitMunForReview` returns HTTP 200 with `{passed:false, blockers:[...]}` on validation failure — this is NOT a 4xx.** Get this wrong and the frontend's React Query treats a successful, committed operation as an error and discards the blocker list — the spec calls this "the single most likely migration bug in this file." `reviewSubmission`'s Zod schema needs a `superRefine` requiring non-empty `reason` when `decision === 'REJECTED'`, mirroring (not replacing) the existing lib-level guard. `publishFromQueue` REQUIRES the `Idempotency-Key` header (400 if absent) — do not preserve today's "optional, server-generated when missing" behavior, since that makes a network-retry replay unreachable for a caller that never sent one; read spec Section 6.4 for why this matters before implementing. `getGoLiveQueue` gets `Cache-Control: no-store` since its SLA state is computed on read.
- [ ] **Step 6:** Continue the 1:1 mapping for the remaining ~16 action/lifecycle files not given a dedicated worked example above, using the same principles (resource-oriented CRUD, action-oriented state transitions, flat child routes, strict Zod bodies, `Idempotency-Key` header not body field for any function taking an idempotency key).
- [ ] **Step 7: The trusted-parameter audit (spec Section 3.3.1's stated Phase-2 deliverable)** — across all ~75 HTTP-exposed functions, audit every options/flags parameter for the same class of risk `includeInactive` demonstrated: an internal parameter implicitly trusted by a same-process caller becoming externally controlled once it's a public query parameter or body field. Produce this as an explicit checklist artifact (which functions were checked, which needed a guard added), not an informal pass — the spec is explicit this is "Phase 2's most important security output."
- [ ] **Step 8:** Port the payments webhook (`app/api/webhooks/payments/route.ts` -> a Hono route) — the raw-body-before-parse signature verification must survive exactly; per spec Section 2, this should port with an import-only change since both Next's route handlers and Hono use the standard `Request`/`Response` API. Verify the raw body capture happens before any global JSON body-parsing middleware would consume the stream (spec's own Hono research flagged this exact ordering footgun).
- [ ] **Step 9:** Port `app/sitemap.ts` -> `GET /sitemap.xml` and `app/robots.ts` -> `GET /robots.txt`, reusing `listPublicMunSlugs()` unchanged. Small task, do not skip it — losing the sitemap is a bigger SEO hit than losing SSR.

### Task 2.3: The typed API client (recovering tRPC ergonomics without the coupling)

- [ ] **Step 1:** `web/src/api/client.ts` — actually lands in Phase 3's directory since it's frontend-consumed, but the shape depends on Phase 2's error taxonomy and response envelope, so design it now (spec Section 3.5) and coordinate with mun-hub-b5 on the exact contract before they build against a moving target. `request<T>(method, path, opts?): Promise<T>`, throwing `ApiError{code, message, status}` on non-2xx, injecting `Idempotency-Key` when present, sending `credentials: include`.
- [ ] **Step 2:** The date-revival reviver (spec Section 6.6) — a ~15-line reviver over a known key allowlist (suffix `At`/`Date`/`deadline`), not a blanket regex over every ISO-looking string (which would corrupt legitimate string fields). This is small and easy to skip; don't. Cover with a test asserting a `Date` in equals a `Date` out through a real HTTP round-trip.
- [ ] **Step 3:** Add the ESLint rule banning non-type imports from `@/lib/**` inside `web/src/**` (spec Section 3.5, and flagged again in the risk table as Critical) — one careless value import pulls the DB driver and `PAYMENT_FIELD_KEY` handling into a browser bundle. This is a lint rule, not a code-review convention, because convention alone is explicitly called out as insufficient.

### Task 2.4: Integration tests

- [ ] **Step 1:** Integration tests hitting real HTTP against real local Postgres (`.env.test`, never `.env`) — not mocked handlers. Max 2 mocks per test; never mock the system under test. These are additive to the existing 579+ tests, not a replacement.
- [ ] **Step 2:** Cover at minimum: the `submitMunForReview` 200-with-`passed:false` contract explicitly (a test asserting the status code, per the risk table); the `publishFromQueue` idempotency-key-required behavior (400 without it, 200-with-replay on a repeat with the same key); the error-taxonomy mapping test (every known thrown string -> expected status); the trusted-parameter audit's `includeInactive` fix (an anonymous request with `includeInactive=true` must NOT see inactive products).
- [ ] **Step 3:** Verify `vitest.setup.ts`'s `.env.test` pinning covers any new test files/config for `/server` — do not create a parallel Vitest config that skips it.

### Task 2.5: Verify and commit

- [ ] **Step 1:** Run the full test suite (existing + new integration tests) and `npx tsc --noEmit` across both `/lib` and `/server`.
- [ ] **Step 2:** Manually verify the API serves at least one representative endpoint per resource group via a real HTTP request (curl or equivalent) against a running local instance.
- [ ] **Step 3:** Commit. The Next app remains untouched and still primary at this point — Phase 2's exit criterion is that the API is independently verifiable before anything depends on it, not that anything has cut over yet.

**CHECKPOINT — Phase 2 exit criteria (spec Section 8.2): the API serves every route with tests; the Next app is untouched and still primary. Message mun-hub-b5 that Phase 2 is stable enough to build Phase 3 against — send the finalized API contract (route tree, error taxonomy, the typed client's `request<T>` shape) even if the trusted-parameter audit or a few lower-traffic routes are still being hardened, since the spec notes the phases "genuinely parallelize after Phase 2."**

---

## Phase 3 — Vite SPA Skeleton + Public Routes (mun-hub-b5)

Owned by the frontend session. Listed here for this plan's completeness and so this session knows what to expect/coordinate on, not as this session's own task list.

- [ ] Vite + React + Tailwind v4 (`@tailwindcss/vite`) + React Router v7 (data-router mode, NOT framework mode — framework mode reintroduces SSR/loaders, the thing being escaped) + TanStack Query.
- [ ] Port `globals.css` and design tokens as-is.
- [ ] Build the typed API client (coordinate the exact shape with this session per Task 2.3), the `queryKeys` factory module (spec Section 6.1 — hierarchical arrays, coarse to fine, enforced via typed builders, no inline key literals), the date reviver (Task 2.3 Step 2, shared).
- [ ] Lift `components/ui` and the shared component tree — import swaps only (`next/link` -> `Link to`, `useRouter().push()` -> `useNavigate()`, etc, per spec Section 5.4's full equivalence table).
- [ ] Build homepage, marketplace, mun detail (with 404 handling), login (with `?redirect=` preservation), and `RootLayout`.
- [ ] Stand up the reverse proxy (Caddy, nginx, or edge-platform routing — decide based on eventual deployment target): public routes to the new SPA, everything else still to the Next app.

**Exit:** public marketplace served by the SPA in production. This validates the proxy, cookies, and CORS on real traffic before anything transactional depends on the new stack.

---

## Phase 4 — Authenticated Read-Heavy Routes (mun-hub-b5)

- [ ] Student dashboard, the 3-step register funnel, support intake.
- [ ] `RequireAuth`/`RequireRole` guard components (spec Section 5.3) — client guards are UX only, never security; every guard's implementation must carry a comment stating this explicitly, since it's exactly the kind of thing a future contributor "optimizes" by trusting the client.
- [ ] `useSession()` hook over `useQuery(['session'])`, `staleTime: Infinity`, invalidated only on sign-in/sign-out.
- [ ] The registration funnel needs the full Section 6.4 treatment: idempotency key generated once per user intent (not per request — a `useRef` UUID created when the confirm dialog opens, reused across retries, reset only on dialog close/reopen), availability polling (`staleTime: 0`, `refetchInterval: 15_000` while the funnel is open), `retry: 0` on all mutations, and treating a `409 CONFLICT_ACTIVE_SUBMISSION`-shaped response as a probable success requiring a refetch-and-check rather than a bare error toast.

**Exit:** students fully on the new stack.

---

## Phase 5 — Organizer Workspace (mun-hub-b5, largest phase)

- [ ] 17 workspace sections (spec Section 5.2's route tree), nested layouts (`WorkspaceLayout` pathless, `MunWorkspaceLayout` per-mun), `MunSwitcher`.
- [ ] The onboarding/go-live pipeline UI with every Section 6.4 guarantee: multi-step flow state rendered FROM server state (`getMunProgress`/`mun.status`), never a local `currentStep`; `{passed:false, blockers:[]}` branches to a success-shaped UI showing the blocker list, never an error toast; optimistic updates allowed for simple CRUD (committee rename, portfolio add/delete) but forbidden anywhere in the lifecycle pipeline itself (never optimistically show `PUBLISHED` before the server's PUBLISH-stage revalidation has actually run).
- [ ] Retire `submitMunForVerification` in favor of building the new setup page directly against `submitFinalConfirmation` (spec Section 3.3.2) — the shim's own docstring says it can likely be deleted once nothing calls it; this migration is the cheapest moment to actually delete it rather than port it forward.

**Exit:** organizers fully migrated.

---

## Phase 6 — Admin Console (mun-hub-b5)

- [ ] 9 admin routes, plus a NEW `/admin/go-live-queue` page — `getGoLiveQueue` already exists and was given tests in the onboarding pipeline's Task 13 but has zero UI; per this project's own connectivity rule, a backend endpoint with no UI is dead code, and the spec explicitly calls this out as the one net-new UI surface in the whole migration (not a new feature, just finally wiring up something that already exists).
- [ ] Lowest traffic, highest privilege — done last so the pattern from Phases 3-5 is well-established before touching it.

**Exit:** all traffic on the SPA.

---

## Phase 7 — Retire the Old Framework (both sessions, together)

- [ ] **One-way door — do this last, after Phase 6 has been stable in production for a meaningful period** (spec Section 12's reversibility table flags this explicitly).
- [ ] Removal list: the `app/` directory, the framework's config file, its lint preset, the framework package itself, and the edge-deploy scaffolding (`@opennextjs/cloudflare`, `wrangler.jsonc`, `open-next.config.ts` — framework-specific, dead weight once Next is gone).
- [ ] Collapse the reverse proxy if a simpler topology suffices once nothing routes to the old app anymore.
- [ ] Update CLAUDE.md, the README, and `package.json`'s scripts to remove every reference to the old framework.
- [ ] Exit: `grep -ri "next" package.json` (excluding legitimate matches like people's names or unrelated words) and a repo-wide search for the framework's import specifier both return zero results outside historical git log / docs referencing the migration itself.

---

## Self-Review Notes

- **Spec coverage:** Section 1 (inventory) informs every phase's scope; Section 2 (Hono) -> Phase 2 Task 2.1; Section 3 (API surface) -> Phase 2 Task 2.2; Section 4 (auth) -> Phase 1 + Phase 2 Task 2.1; Section 5 (routing) -> Phase 3; Section 6 (data-fetching) -> Phases 3-5 (owned by mun-hub-b5, referenced here for completeness); Section 7 (SEO) -> Phase 3 (the on-demand crawler-prerendering service is new infrastructure not yet assigned a task above — **flag for mun-hub-b5 to scope as part of Phase 3**, since spec Section 7.2's recommended D1 approach is ~150-250 lines and belongs wherever the public-route serving lives); Section 8 (sequencing) -> this plan's phase structure directly; Section 9 (coordination) -> Phase 0; Section 10 (estimate) -> not a task, a planning input; Section 11 (non-goals) -> deliberately has no corresponding tasks; Section 12 (risks) -> mitigations are woven into the relevant task steps above (idempotency-key requirements, the boot-guard, the lint rule, the trusted-parameter audit) rather than listed separately.
- **Highest-risk items, called out at the task level, not just in the spec:** the session-parameter refactor (Task 1.3) touches auth and should be reviewed as security code; the `submitMunForReview`/`publishFromQueue` HTTP status contracts (Task 2.2 Step 5) are the spec's own pick for "single most likely migration bug"; the trusted-parameter audit (Task 2.2 Step 7) is explicitly the highest-value security deliverable of Phase 2.
- **Deliberate scope boundary:** this plan covers Phases 0-2 in full task detail (this session's ownership) and Phases 3-6 at a lighter, coordination-oriented level of detail (mun-hub-b5's ownership, who should expand their own task-level plan from the same spec once they pick this up) — writing a full SDD-style task breakdown for the frontend phases from this session would be presuming detail decisions that belong to whoever actually implements them.
- **No CI guard scripts, anywhere in this plan, referencing Semgrep or any tool the user has excluded** — verification steps throughout use direct `npx tsc --noEmit` / `npx vitest run` / manual HTTP checks only.
