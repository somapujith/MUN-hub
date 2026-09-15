# Next.js -> Vite/React SPA + Standalone Node API - Migration Design

**Status:** Proposed
**Date:** 2026-09-15
**Forcing function:** Next.js SSR/framework overhead is unacceptable for this product's latency budget. That diagnosis (genuine framework overhead, not a fixable caching/N+1 bug) is settled and not re-litigated here.
**Scope:** Replace Next.js entirely with (a) Vite + React Router + TanStack Query frontend, (b) a standalone Node HTTP API.
**Non-scope:** Rewriting business logic. See Section 11.

---

## 0. TL;DR for whoever reads only one section

The good news, measured not guessed: **`lib/` is already 98% framework-agnostic.** Exactly two files in `lib/` import anything from `next`:

- `lib/auth/session.ts` -> `import { cookies } from 'next/headers'`
- `lib/actions/auth.ts` -> `import { cookies } from 'next/headers'`

Everything else in `lib/actions/` (21 files, ~110 exported functions) and `lib/lifecycle/` (10 files) only carries a `'use server'` directive - a string literal a non-Next bundler ignores. The transactions, row locks, idempotency keys, validation engine, SLA math, notification pipeline and field encryption all survive untouched.

The bad news, also measured: **~16,900 LOC under `app/`** and **~8,100 LOC under `components/`**, of which **44 page/layout files are React Server Components doing direct DB reads**, plus **49 `redirect()`, 37 `revalidatePath()`, 13 `notFound()`, 42 `next/link`, 39 `next/navigation`** call sites. That is the real work.

Recommended: **Hono**, **REST with a typed client**, **opaque session cookie keeping the existing `sessions` table (NOT JWT)**, **incremental strangler migration behind a reverse proxy**, and **on-demand crawler prerendering for the 3 public SEO routes**. Estimated **55-85 working days** (~6-9 calendar weeks with the two sessions in parallel), phased so every boundary is shippable.

---

## 1. Current-state inventory (read, not assumed)

### 1.1 Backend surface that must survive

| Layer | Files | Next.js coupling |
|---|---|---|
| `lib/actions/` | 21 (~3,900 LOC) | `use server` only, except `auth.ts` |
| `lib/lifecycle/` | 10 (~2,900 LOC) | **none** |
| `lib/lifecycle/validators/` | 5 | **none** |
| `lib/db/` (schema, client, migrate, seed, tenant-guard) | 8, **29 pgTables** | **none** |
| `lib/auth/` | 5 | `session.ts` only |
| `lib/payments/`, `lib/storage/`, `lib/notifications/`, `lib/crypto/`, `lib/audit/` | 9 | **none** |
| `app/api/webhooks/payments/route.ts` | 1 (~120 LOC) | `NextResponse` - trivial port |

**Exported functions per file** (the real surface to map):

```
mun-config 14 . admin-review 8 . accommodation 8 . registration-form 6 .
registration 5 . go-live 5 . module-verification 5 . marketplace 4 .
mun-branding 4 . mun-schedule 4 . executive-board 4 . support 4 .
reverification 4 . module-completion 4 . organizer-admin 3 .
payment-settlement 3 . mun-documents 3 . validation 3 . admin-search 2 .
auth 2 . mun-contact 2 . organizer-dashboard 2 . student-dashboard 2 .
organizer-confirmation 2 . sla 2 . mun-state-machine 2 . audit-history 1 .
go-live-dashboard 1 . organizer-application 1 . module-registry 1
```

~ **110 exported functions**, of which roughly **75 are genuine HTTP-callable operations**. The rest are internal pure helpers (`computeSlaState`, `addBusinessDays`, `detectHighImpactChange`, `getModuleDefinition`) the API never exposes.

### 1.2 The session-resolution split - the single most important finding

The action layer is **not consistent** about how it obtains the actor, and this determines per-file migration difficulty.

**Pattern A - `session: Session | null` as an explicit parameter (framework-agnostic, zero work):**
`mun-config.ts`, `go-live.ts`, `module-verification.ts`, `organizer-confirmation.ts`, `go-live-dashboard.ts`, `accommodation.ts`, `mun-branding.ts`, `mun-schedule.ts`, `mun-contact.ts`, `mun-documents.ts`, `executive-board.ts`, `registration-form.ts`, `payment-settlement.ts`.

```ts
export async function createCommittee(input, session: Session | null): Promise<Committee>
export async function publishFromQueue(munId, session: Session | null, idempotencyKey?): Promise<...>
```

These already have exactly the right shape for an HTTP handler. The Hono handler resolves the session from the cookie and passes it down. **No change to these files at all.**

**Pattern B - calls `await getSession()` internally (transitively imports `next/headers`):**

| File | getSession() call sites |
|---|---|
| `lib/actions/admin-review.ts` | 8 |
| `lib/actions/support.ts` | 4 |
| `lib/actions/organizer-admin.ts` | 3 |
| `lib/actions/admin-search.ts` | 2 |
| `lib/actions/student-dashboard.ts` | 2 |
| `lib/actions/registration.ts` | 2 |
| `lib/actions/organizer-dashboard.ts` | 1 |
| `lib/actions/audit-history.ts` | 1 |
| `lib/actions/organizer-application.ts` | 1 |

**24 call sites across 9 files.** Each must become an explicit `session` parameter - a mechanical, compiler-enforced refactor, but it is a **signature change on the frozen contract surface** the UI session imports. See Section 9.

**Decision: convert all of Pattern B to Pattern A. Do not preserve `getSession()`-inside-the-action via AsyncLocalStorage.**

*Alternative considered:* Node's `AsyncLocalStorage` can replicate Next's ambient request context, letting `getSession()` keep working with zero action-file changes. **Rejected.** It preserves the exact implicit-context coupling this migration exists to remove; it is invisible to the type system (a missing `run()` wrapper yields a runtime `null` session - in the worst case a silent auth anomaly - rather than a compile error); and it makes the action layer untestable without a context shim. The 24-site refactor is roughly a day and is compiler-verified.

*Trade-off accepted:* a one-time breaking change to 9 files on the shared contract surface, requiring the coordination in Section 9.

### 1.3 Frontend surface that must be rebuilt

| Metric | Count |
|---|---|
| Files under `app/` | 132 |
| LOC under `app/` | ~16,900 |
| LOC under `components/` | ~8,100 |
| page.tsx/layout.tsx that are **Server Components** (no use client) | **44** |
| Files with `use client` | 57 |
| `redirect()` | 49 |
| `revalidatePath()` | 37 |
| `notFound()` | 13 |
| `useActionState` | 11 |
| `useFormStatus` | 8 |
| `useRouter` / `usePathname` / `useSearchParams` | 14 / 12 / 8 |
| `next/link` | 42 |
| `loading.tsx` (Suspense fallbacks) | 24 |
| Route-local `actions.ts` wrappers | 9 |
| Files exporting `metadata`/`generateMetadata` | 41 |

**Key structural insight:** the 57 `use client` files and the interactive dialogs/forms are **already ordinary React** - they port with import swaps (`next/link` -> react-router `Link`, `useRouter().push` -> `useNavigate()`). The **44 Server Components are the genuine rewrite**: `async function Page()` bodies that `await` DB reads directly must become `useQuery` hooks.

**The 9 route-local `actions.ts` files are a gift.** `app/organizer/dashboard/[munId]/committees/actions.ts` already does exactly what an HTTP handler does: resolve session, call the lib action, catch thrown errors, map them to a discriminated `ActionResult<T> = {ok:true,data} | {ok:false,error}`. Its `toErrorMessage()` mapping (`Forbidden` -> user-facing copy, `Committee not found` -> another) is **the error taxonomy the HTTP layer should adopt directly** (Section 3.4). These files get deleted, but their logic moves to two places: error mapping -> server middleware; user-facing copy -> the client.

### 1.4 Concurrency/correctness invariants the new layer must not weaken

Non-negotiable, from the last three design slices:

1. `initiateRegistration` - `.for('update')` row lock on the registration product **and** the accommodation option, in one transaction; rejects a second active registration by the same user.
2. `submitMunForReview` - row-locks the mun; `mun_submissions_active_per_mun_uq` partial unique index is the **primary** race defense, the pre-check only a friendlier message.
3. `publishFromQueue` - locks the **submission** row (not the mun), idempotent replay via `publishIdempotencyKey`, re-validates at PUBLISH stage against live data, 8-step sequence in one transaction.
4. `reviewSubmission` / `reviewModule` / `enqueueForGoLive` - row lock **plus** re-check of the precondition under the lock.
5. Payments webhook - verifies the HMAC signature over **raw bytes before parsing**; idempotent on replay; row-locks the registration and marks `REFUNDED` rather than orphaning a charge.
6. Actor identity is **never** client-supplied (`registration.ts` docstring names a prior IDOR regression explicitly).
7. `PAYMENT_FIELD_KEY` validated at module load - no default, no fallback, crash on misconfiguration.

Every one of these lives inside `lib/`, below the framework boundary, and survives unchanged. **The migration's risk is not that these break - it is that the new HTTP layer fails to *reach* them correctly** (e.g. a frontend that regenerates an idempotency key on retry, defeating #3). Section 6.4 addresses that.

---

## 2. Decision 1 - Backend framework: **Hono**

### Alternatives

**Express 5**
- *Pros:* largest ecosystem; universally known; every middleware exists.
- *Cons:* types are bolted on (`@types/express`); `Request`/`Response` are mutable bags that invite exactly the mutation this project's style rules forbid; no first-class typed routing, so the frontend gets no inference for free.
- *Fatal flaw here:* it discards the one thing the migration is otherwise free to keep - end-to-end type safety from Drizzle row -> action return type -> HTTP response -> React Query data. Losing that across a 75-endpoint surface is a large, permanent tax.

**Fastify 5**
- *Pros:* fastest raw throughput of the three; mature plugin encapsulation; excellent JSON-Schema validation.
- *Cons:* its type inference is driven by JSON Schema, not TypeScript types. This project validates with **Zod 4** (already a dependency). Fastify + Zod needs `fastify-type-provider-zod` - workable, but the type story runs through a third-party adapter. Plugin encapsulation is powerful and also a real conceptual overhead this project has no requirement for.
- *Not fatal, just optimizing the wrong axis:* raw req/s is not the bottleneck. The bottleneck being escaped is SSR render cost, which any of the three removes.

**Hono 4 - RECOMMENDED**
- *Pros specific to this codebase:*
  - **TypeScript-first by construction.** `c.get('session')` is typed via a `Variables` generic on the app - the session-in-context pattern replacing `getSession()` becomes a first-class, compile-checked concept rather than a `declare global` augmentation hack. Since Section 1.2 makes session propagation the central migration concern, this matters more than it sounds.
  - **`@hono/zod-validator` is first-party** and infers directly from Zod schemas the project already uses. `c.req.valid('json')` is typed from the schema with no adapter layer, so "validate all input at system boundaries" becomes one line per route.
  - **Web-standard `Request`/`Response`.** The existing webhook handler already takes a standard `Request` and calls `request.text()` / `request.headers.get()` - it ports with an **import-only change**, and critically the raw-body-before-parse signature verification (Section 1.4 #5) keeps working identically. Under Express it needs `express.raw()` body-parser configuration, a classic footgun.
  - **Runtime portability.** `@opennextjs/cloudflare` and `wrangler` are already installed with `cf:deploy` scripted - there was Cloudflare intent. Hono runs natively on Workers, Node, Bun, Deno, keeping that open at zero cost. (Caveat: Workers cannot use the `postgres` TCP driver without Hyperdrive - a separate decision this does not lock in. Node is the default target.)
  - ~14kB, minimal dependency surface.
- *Cons, stated honestly:*
  - Smaller ecosystem than Express. Concretely, everything needed here exists first-party - `hono/cors`, `hono/cookie`, `hono/logger`, `hono/compress`, `hono/request-id` - or as `@hono/*`. **Verify `hono-rate-limiter` on the Node adapter specifically before Phase 1**; if inadequate, `rate-limiter-flexible` is runtime-agnostic and drops in as custom middleware in ~20 lines.
  - Fewer StackOverflow answers; mitigated by good docs and a small API.
  - Lower assumed team familiarity than Express.
- *Reversibility:* **two-way door, cheaply** - *provided* handlers stay thin (parse -> validate -> call lib action -> serialize). Swapping to Fastify later is then a mechanical rewrite of handler files only. **This is a load-bearing constraint on implementation: handlers contain no business logic. Enforce in review.**

### Decision

**Hono on the Node adapter (`@hono/node-server`), with Zod validation via `@hono/zod-validator`.**

The deciding argument is not performance - all three are fast enough. It is that Section 1.2's session refactor and the boundary-validation requirement are both *type-system* problems, and Hono is the only one of the three where the type system does that work natively with the Zod already present.

### Rejected: tRPC (and why REST wins here)

Seriously considered - these *are* already typed function calls, and tRPC would eliminate the whole API-design step.

- *Pros:* zero API surface design; end-to-end inference; native `@tanstack/react-query` integration; Section 3's mapping becomes a no-op.
- *Cons that decide it:*
  1. **The payments webhook is an external, non-tRPC caller.** Razorpay posts a signed body to a fixed URL. A hybrid is mandatory regardless, so tRPC never fully replaces REST here.
  2. **SEO (Section 7) needs real, cacheable, GET-shaped URLs** for `/api/muns` and `/api/muns/:slug`. tRPC batched transport is hostile to HTTP/CDN caching and to the prerender step.
  3. **Third-party/partner API access** is plausible for a marketplace; a tRPC-only backend is effectively private.
  4. **Coupling.** tRPC re-couples frontend and backend at the type level via a shared router-type import. The stated goal is a backend "fully decoupled" - swapping one tight coupling for another contradicts the requirement spirit.
- *Recovering most of the benefit:* a hand-written typed client (`web/src/api/client.ts`) whose functions import return types straight from `lib/actions/*` and `lib/types/*` via the shared tsconfig path. Same call-site inference, no transport coupling. ~200 lines - Section 3.5.

**Decision: REST with a typed client.** Two-way door - tRPC can be layered onto internal routes later if the typed client proves insufficient.

---

## 3. Decision 2 - API surface design

### 3.1 Principles

1. **Handlers are transport adapters, nothing more.** Parse -> validate (Zod) -> session from middleware -> call the lib function -> map result/error to HTTP. **No `db` import in any handler file** - an automatic review reject.
2. **Resource-oriented for CRUD; action-oriented (`POST /:id/actions/<verb>`) for state transitions.** Forcing `publishFromQueue` or `submitMunForReview` into `PUT /muns/:id` would hide their idempotency and concurrency semantics behind a generic verb. These are workflow operations; the URL should say so.
3. **One route file per existing action file.** `lib/actions/mun-config.ts` -> `server/routes/mun-config.ts`. Keeps the 200-400 line rule satisfiable and the mapping trivially auditable.
4. **Errors are structured, not strings** (Section 3.4).
5. **Public reads are GET and cacheable; everything else is not.**

### 3.2 Route tree (top level)

```
/api/v1
  /auth            POST /session . DELETE /session . GET /session
  /muns            public marketplace reads + slug detail
  /muns/:munId/committees        CRUD (+ nested /portfolios)
  /muns/:munId/products          registration products
  /muns/:munId/accommodation     options + fields
  /muns/:munId/branding|schedule|contact|documents|executive-board|form
  /muns/:munId/modules           progress . verification . confirmation
  /muns/:munId/submission        submit . review . enqueue . publish
  /muns/:munId/payment-settings
  /registrations   initiate . read
  /me              student dashboard
  /organizer       dashboard . application
  /admin           review queue . search . organizers . support . audit . go-live queue
  /webhooks        payments  (UNVERSIONED, provider-facing, mounted outside /api/v1)
```

The `/api/v1` prefix is cheap now; the alternative forecloses a future breaking change. Two-way door in the safe direction.

### 3.3 Representative mappings

#### `lib/actions/mun-config.ts` (14 exports)

| Function | Method + Path | Auth | Notes |
|---|---|---|---|
| `listCommittees(munId)` | `GET /muns/:munId/committees` | public | unfiltered by status per its docstring - do **not** merge with the marketplace-filtered read |
| `createCommittee(input, session)` | `POST /muns/:munId/committees` | owner/admin | `munId` from **path**, never body |
| `updateCommittee(id, input, session)` | `PATCH /committees/:committeeId` | owner/admin | PATCH not PUT - input is a partial |
| `deleteCommittee(id, session)` | `DELETE /committees/:committeeId` | owner/admin | hard delete |
| `listPortfolios(committeeId)` | `GET /committees/:committeeId/portfolios` | public | |
| `createPortfolio(input, session)` | `POST /committees/:committeeId/portfolios` | owner/admin | |
| `updatePortfolio(id, input, session)` | `PATCH /portfolios/:portfolioId` | owner/admin | |
| `deletePortfolio(id, session)` | `DELETE /portfolios/:portfolioId` | owner/admin | |
| `listRegistrationProducts(munId, {includeInactive})` | `GET /muns/:munId/products?includeInactive=` | public | **includeInactive=true must require auth - Section 3.3.1** |
| `createRegistrationProduct(input, session)` | `POST /muns/:munId/products` | owner/admin | |
| `updateRegistrationProduct(id, input, session)` | `PATCH /products/:productId` | owner/admin | |
| `deleteRegistrationProduct(id, session)` | `DELETE /products/:productId` | owner/admin | soft delete -> 204 |
| `updateMunDetails(munId, input, session)` | `PATCH /muns/:munId` | owner/admin | |
| `submitMunForVerification(munId, session)` | `POST /muns/:munId/actions/submit-for-verification` | owner/admin | **deprecated shim - Section 3.3.2** |

**Nesting rule used:** child resources nest under the parent for **create/list** (parent id is required and belongs in the path), flat for **update/delete** (child id is globally unique; nesting would create two URLs for one resource and require validating that the path parent owns the child - a needless extra failure mode). The existing `getMunIdForCommittee` / `getCommitteeIdForPortfolio` helpers already walk up to the mun for the ownership check, so flat child routes lose nothing security-wise.

##### 3.3.1 Bug surfaced by this mapping (pre-existing, not caused by the migration)

`listRegistrationProducts(munId, { includeInactive: true })` is documented "Public read, no auth", but `includeInactive` exposes soft-deleted/archived products. Today only trusted server-side callers pass it. **As a query parameter on a public HTTP endpoint, any anonymous caller can set it.** The handler must gate `includeInactive=true` behind `assertOwnsOrAdmin` and silently default to active-only for anonymous callers.

*This is the archetype of the migration's real risk class: an internal function parameter that was implicitly trusted becomes externally controlled.* Every `options`/flags parameter across all ~75 mapped functions needs the same audit. Making that audit an explicit tracked deliverable is Phase 2's most important security output (Section 10).

##### 3.3.2 `submitMunForVerification` - resolve during migration, do not port

Its own docstring says it is a compatibility shim for the old organizer panel and "can likely be deleted" once the UI calls `submitFinalConfirmation` directly. Since the UI is being rebuilt anyway, **do not give it a route.** Build the new organizer setup page against `POST /muns/:munId/actions/submit-final-confirmation` (-> `submitFinalConfirmation`, which writes the real Gate 3 `organizer_confirmations` snapshot) and delete the shim. A migration is the cheapest moment to retire a compatibility shim; carrying it forward makes it permanent.

#### `lib/actions/registration.ts` (5 exports)

| Function | Method + Path | Auth | Notes |
|---|---|---|---|
| `initiateRegistration(input)` | `POST /registrations` | **session required** | Body is `Omit<RegistrationInput,userId>`. Zod schema **must be `.strict()`** so a stray `userId` is a 400, not a silently-ignored field. Requires `Idempotency-Key` (Section 6.4). Rate limited (Section 4.6). |
| `getRegistrationById(id)` | `GET /registrations/:id` | session required | Preserve the null-vs-403 distinction: not-found -> 404; exists-but-unauthorized -> 403. Do **not** collapse both to 404 - the docstring reasons explicitly about this and authorized callers need the correct signal. |
| `getProductAvailability(id)` | `GET /products/:productId/availability` | public | |
| `getProductsAvailability(ids[])` | `GET /products/availability?ids=a,b,c` | public | **Keep the batched form as primary.** Commit `8fdc449` exists specifically to kill this N+1; a per-product frontend loop silently reintroduces it. Cap `ids` (~50) - an unbounded `inArray` is a DoS vector once public. |
| `releaseExpiredReservations(id)` | *(no route)* | - | Internal sweep called by the two above. Exposing it would let anyone force reservation sweeps. |

Both `initiateRegistration` and `getRegistrationById` are Pattern B - they need the Section 1.2 signature change.

#### `lib/lifecycle/go-live.ts` (5 exports) - the highest-stakes mapping

| Function | Method + Path | Auth | Notes |
|---|---|---|---|
| `submitMunForReview(munId, session)` | `POST /muns/:munId/actions/submit-for-review` | owner/admin | **Returns 200 with `{passed:false, blockers:[...]}` on validation failure - NOT 4xx.** This is a successful, committed operation with a business-domain negative result (the `verification_issues` rows must survive). Mapping it to 422 makes React Query treat it as an error and discards the blocker list. The single most likely migration bug in this file. |
| `reviewSubmission(munId, decision, opts, session)` | `POST /muns/:munId/submission/actions/review` | OPERATIONS/ADMIN/SUPER_ADMIN | Body `{decision, notes?, reason?, issues?[]}`. Zod `superRefine`: non-empty `reason` **required** when `decision === REJECTED`, mirroring the pre-transaction guard. Validate at the boundary *and* keep the server-side guard - defense in depth; the lib check remains the authority. |
| `enqueueForGoLive(munId, session)` | `POST /muns/:munId/submission/actions/enqueue` | ADMIN/SUPER_ADMIN | |
| `getGoLiveQueue(params, session)` | `GET /admin/go-live-queue?limit=&offset=` | OPERATIONS/ADMIN/SUPER_ADMIN | `slaState` is computed on read -> `Cache-Control: no-store`. A cached SLA state is a wrong SLA state. |
| `publishFromQueue(munId, session, idempotencyKey?)` | `POST /muns/:munId/actions/publish` | ADMIN/SUPER_ADMIN | **`Idempotency-Key` header REQUIRED (400 if absent).** Today it is an optional third argument, server-generated when missing - which makes an idempotent *replay* unreachable for a caller that never sent one. Over a network with retries, requiring it is what makes the guarantee real. Returns 200 with `{replay:true}` on replay, same body shape. |

**Idempotency-key transport decision:** header (`Idempotency-Key`), not body field. It is transport-level retry metadata, matches the Stripe convention every developer recognizes, and keeps it out of the Zod body schema so `.strict()` stays clean. The handler reads the header and passes it as the third argument - **no change to `publishFromQueue` signature.**

### 3.4 Error taxonomy

The lib layer throws `Error` with specific messages - `Forbidden`, `Mun not found`, `Committee not found`, `Portfolio not found`, `Registration product is at capacity`, `You already have an active registration for this product`, `This mun already has an active submission in review`, `Cannot submit mun for review from status X`, `Cannot publish - validation fails at PUBLISH stage: ...` - plus raw Postgres constraint violations.

The existing `toErrorMessage()` in the route-local `actions.ts` files already performs this mapping. **Centralize it into one Hono error middleware** (`server/middleware/error.ts`) rather than duplicating per route.

```
Error                                  -> HTTP   code
Forbidden                              -> 403    FORBIDDEN
/ not found$/                          -> 404    NOT_FOUND
/...at capacity$/                      -> 409    CONFLICT_CAPACITY
You already have an active...          -> 409    CONFLICT_DUPLICATE
...already has an active submission    -> 409    CONFLICT_ACTIVE_SUBMISSION
/^Cannot (submit|publish|transition)/  -> 409    CONFLICT_STATE
Postgres unique violation (23505)      -> 409    CONFLICT_UNIQUE
ZodError                               -> 400    VALIDATION_FAILED (+ field errors)
anything else                          -> 500    INTERNAL
```

Body: `{ "error": { "code": "CONFLICT_CAPACITY", "message": "This pass is sold out." } }`

Three hard rules:

1. **500 responses expose no `error.message`, no stack, no SQL.** Postgres errors leak table/column/constraint names. Log fully server-side with a request id; return only the request id to the client.
2. **Message-string matching is fragile** - it couples HTTP status to prose a future edit could change. Mitigation: a test asserting every known thrown string maps to its expected status, so renaming a message without updating the map fails CI. The better long-term fix is typed error classes in `lib/`, deliberately deferred (Section 11.6) to keep migration and refactor separable.
3. **User-facing copy lives in the frontend, not the API.** The API returns a stable `code`; the client maps code -> copy. Keeps i18n open and stops the API becoming a string table.

### 3.5 Typed client (recovering tRPC ergonomics)

`web/src/api/client.ts` - a thin `fetch` wrapper plus per-domain modules importing types directly from `lib/`:

```ts
// web/src/api/muns.ts  (shape only - not implementation)
import type { Committee } from '@/lib/types'
export const listCommittees = (munId: string) =>
  request<Committee[]>('GET', `/muns/${munId}/committees`)
```

The frontend tsconfig keeps the `@/*` alias pointing at the repo root, so `lib/types` and the input/return interfaces import directly. **Type-only imports** guarantee nothing from `lib/` (and therefore no `db` / `postgres` / `node:crypto` / `PAYMENT_FIELD_KEY` handling) is ever bundled into the client.

**Add an ESLint rule banning non-type imports from `@/lib/**` inside `web/src/**`.** One careless import pulls the DB driver and encryption code into a browser bundle. That is a shipped-secret-class failure and needs a lint rule, not a code-review convention.

Shared responsibilities: credentials/Cache-Control policy, `Idempotency-Key` injection, error-envelope unwrapping into a typed `ApiError` carrying `code`, and **JSON date revival** (Section 6.6).

---

## 4. Decision 3 - Auth / session migration

### 4.1 What exists

- `sessions` table: `token` (32 random bytes, hex), `userId`, `expiresAt`; 30-day TTL.
- `getSession()` reads cookie `mun_hub_session` -> joins `sessions` x `users` -> `{userId, role}`; returns `null` if expired **or if `users.suspended`**.
- `createSession(userId)` / `destroySession(token)`.
- Cookie set in `lib/actions/auth.ts`: `httpOnly`, `secure` in prod, `sameSite: lax`, `path: /`, `maxAge`.
- `signIn(email)` is **passwordless mock auth** - a known unauthenticated-admin-takeover path, documented in `CLAUDE.md` and in the pipeline design Section 8.8.

### 4.2 Alternatives

**A. Stateless JWT (access + refresh)**
- *Pros:* no DB read per request; horizontally scalable; standard.
- *Fatal flaw here:* `getSession()` currently rejects a **suspended** user's existing tokens *immediately* - the docstring calls this out as deliberate, and `lib/actions/organizer-admin.ts` has a whole suspend flow built on it. A stateless JWT cannot: a suspended admin retains full access until expiry. Recovering it needs a revocation-list check per request - exactly the DB read JWT was chosen to avoid, minus the simplicity. **Reject.**

**B. Opaque session cookie against the existing `sessions` table - RECOMMENDED**
- *Pros:* **zero change to the `sessions` table, to the `getSession()` query, or to the security model.** Instant revocation preserved. Suspension check preserved. An `httpOnly` cookie is unreachable from JS, so XSS cannot exfiltrate it - strictly better than the common "JWT in localStorage" SPA pattern. One indexed lookup per request is negligible against a ~30-table query workload.
- *Cons:* a DB read per authenticated request (cacheable with a short TTL later - deliberately not now); cookie/CORS care if frontend and API differ in origin (Section 4.5); **requires CSRF protection**, which same-origin Server Actions provided free (Section 4.4).
- *Reversibility:* two-way door - swapping the middleware resolution strategy touches one file.

**C. Third-party auth (Clerk / Auth0 / Supabase Auth)**
- *Pros:* properly solves the passwordless-mock problem with real password/OAuth flows.
- *Cons:* `CLAUDE.md` records the auth provider as explicitly **undecided**, to stay behind the adapter until the user confirms. Picking one inside a migration decision would violate a locked project decision. **Out of scope - but see Section 4.7.**

### 4.3 Decision

**Opaque session cookie, existing `sessions` table, resolved in Hono middleware.**

```
server/middleware/session.ts
  reads mun_hub_session via hono/cookie getCookie
  -> getSessionByToken(token)        <- lib/auth/session.ts, refactored
  -> c.set(session, session | null)

server/middleware/require-auth.ts   -> 401 when null
server/middleware/require-role.ts   -> wraps existing requireRole(), 403
```

**Refactor to `lib/auth/session.ts` - the only real lib change:** split cookie-reading from token-resolution.

```
getSessionByToken(token: string): Promise<Session | null>   // NEW - existing query body
                                                            // verbatim, no next/headers
createSession(userId)     // unchanged
destroySession(token)     // unchanged
getSession()              // DELETED - its cookie read moves to middleware
```

This is the surgical removal of `next/headers` from `lib/`. The query, the `expiresAt` check and the `suspended` check are copied unchanged. `lib/auth/session.test.ts` extends to cover `getSessionByToken` directly - easier to test than the cookie-coupled version.

`lib/actions/auth.ts` similarly drops its `cookies()` calls: `signIn(email)` returns `{userId, role, token, expiresAt}` and the **route handler** sets the cookie via hono/cookie `setCookie` with the same attributes plus Section 4.5.

**`requireRole` and `assertOwnsOrAdmin` are unchanged.** They already accept `Session | null`; their `Forbidden` throw maps to 403.

### 4.4 CSRF - a genuinely new requirement

Next.js Server Actions have built-in Origin-header CSRF protection. **A plain cookie-authenticated HTTP API does not.** Without this the migration is a security *regression*, so it is mandatory.

Layered:

1. **`SameSite` cookie attribute.** `Lax` under same-site deployment (Section 4.5, recommended) blocks cross-site POST outright. `None` is required for cross-origin - precisely why cross-origin is not recommended.
2. **Origin/Referer allowlist middleware** on every state-changing method (POST/PATCH/PUT/DELETE); mismatch -> 403. Cheap, no token plumbing, and it is what Next was doing for us.
3. **Double-submit CSRF token** only if cross-origin is ever forced. Adds client complexity; avoid if possible.

**The webhook route is exempt** - an external server-to-server caller with no Origin header, authenticated instead by HMAC over the raw body. **Mount it before the CSRF middleware, outside the `/api/v1` group**, or payments silently break with a confusing 403.

### 4.5 Deployment topology (drives cookie config)

**Recommended: same-site.** Serve the SPA bundle and the API from one registrable domain - either a single origin with the API under `/api` (reverse proxy), or `app.munhub.com` + `api.munhub.com` with cookie `Domain=.munhub.com`.

- *Pros:* `SameSite=Lax` works (strong CSRF baseline); no CORS preflight on every mutation (a latency win - relevant given latency is the whole point); simplest cookie story.
- *Cons:* requires a proxy/routing layer (Caddy, nginx, Cloudflare, or the platform routing).

**Not recommended: fully cross-origin** (SPA on one host, API on another). Forces `SameSite=None; Secure`, a CORS allowlist with `credentials: include`, and an OPTIONS preflight before every mutation. Workable, strictly worse on both security and latency.

This choice also makes the strangler migration (Section 8) straightforward - the proxy *is* the cutover mechanism.

### 4.6 Rate limiting - also genuinely new

Same-origin Server Actions were implicitly shielded. A public API is not. Minimum viable set:

| Endpoint | Limit | Why |
|---|---|---|
| `POST /auth/session` | 5/min/IP + per-email | Credential stuffing / user enumeration |
| `POST /registrations` | 10/min/session | Seat-reservation spam; each call runs a row-locking transaction |
| `GET /products/availability` | 60/min/IP | Cheap-looking but performs an UPDATE sweep + grouped count |
| `GET /muns` (marketplace) | 120/min/IP | Unauthenticated, query-parameterized, scannable |
| `POST /webhooks/payments` | IP allowlist, not rate | Provider-fixed source |
| Global default | 300/min/IP | Backstop |

`GET /products/availability` deserves emphasis: `getProductsAvailability` performs a write (`UPDATE ... SET status=CANCELLED`) on a GET. Correct as a lazy sweep, but it means an unauthenticated GET does write work. Rate-limit accordingly and do not let a CDN cache it (Section 7).

**Trap to document:** in-memory limiting silently becomes N x the intended limit across N instances. Document the limit as per-instance until Redis lands (Section 11.9).

### 4.7 The `signIn(email)` passwordless hole

**The migration does not fix it and must not silently ship it.** Today it is reachable only via a same-origin Server Action on an undeployed app. After migration it is a documented, CORS-configured, publicly routable `POST /api/v1/auth/session` granting admin on an email string.

**Hard gate:** the API must refuse to boot when `NODE_ENV === production` and no real auth adapter is configured. Follow the exact precedent of `lib/crypto/field-encryption.ts`, which throws at module load when `PAYMENT_FIELD_KEY` is missing - *"a silently-weak key is worse than a crash."* The same reasoning applies verbatim to auth. ~10 lines, and it is the difference between a known dev-only mock and a shipped vulnerability.

### 4.8 Does `AuthAdapter` still hold?

```ts
interface AuthAdapter {
  signIn(email: string, password: string): Promise<Session>
  signOut(sessionToken: string): Promise<void>
  getCurrentUserId(sessionToken: string): Promise<string | null>
}
```

**Yes - and it fits the new architecture better than the old one.** Every method is token-in/token-out with no ambient request context. `getCurrentUserId(sessionToken)` is *already* exactly what the new middleware needs; it was `getSession()`'s Next-coupled cookie read that never fit the interface. The migration moves the code **toward** the adapter's existing design - a good sign the adapter was designed correctly.

One recommended **additive** change, driven by the new topology:

```ts
signIn(email, password): Promise<{ session: Session; token: string; expiresAt: Date }>
```

The route handler needs the raw token and expiry to set the cookie; returning only `Session` forces a second `createSession` call outside the adapter, splitting session creation across two places. Minor, and it keeps an external provider (which issues its own tokens) expressible through the same interface.

**Deliberately NOT added:** any cookie-related method. The adapter stays transport-agnostic - cookie handling belongs to the HTTP layer. Putting `setCookie` in the adapter would repeat the exact mistake this migration is undoing.

---

## 5. Decision 4 - Frontend routing map

### 5.1 Router choice

**React Router v7 in data-router mode (`createBrowserRouter`), not framework mode.** Framework mode reintroduces SSR/loaders - the thing being escaped. Data-router mode gives nested layouts (a direct analogue of `layout.tsx`), typed params, and `errorElement` (a direct analogue of `error.tsx`).

**Data fetching goes in React Query, not router loaders.** Two fetching systems is an anti-pattern, and React Query cache/invalidation/retry is what replaces `revalidatePath`. Use loaders only for pre-auth route guards, if at all.

### 5.2 Route configuration

```
/                                        RootLayout  (SiteHeader/Footer, ThemeProvider, Toaster)
|- index                                 HomePage                  public
|- /muns                                 MarketplacePage           public   ?q&city&...  (URL = state)
|- /mun/:slug                            MunDetailPage             public   404 on missing
|- /login                                LoginPage                 public   ?redirect=  (5.3)
|- /support/new                          SupportNewPage            auth
|
|- /register/:slug                       RegisterLayout            auth <- RequireAuth
|  |- index                              RegisterStepPage
|  |- /pay                               RegisterPayPage
|  |- /confirmation                      RegisterConfirmationPage
|
|- /dashboard                            StudentDashboardPage      role: STUDENT+
|
|- /organizer
|  |- /apply                             OrganizerApplyPage        auth
|  |- /apply/submitted                   OrganizerApplySubmitted   auth
|  |- /dashboard                         OrganizerGuard            role: ORGANIZER|ADMIN|SUPER_ADMIN
|     |- (workspace)                     WorkspaceLayout           <- PATHLESS layout route
|     |  |- index                        OrganizerHomePage
|     |  |- /muns                        OrganizerMunsPage
|     |- /:munId                         MunWorkspaceLayout        <- nested; sidebar + MunSwitcher
|        |- index                        MunOverviewPage
|        |- /setup                       SetupPage                 ?tab=  (setup-tabs)
|        |- /committees . /products . /accommodation . /form
|        |- /executive-board . /documents . /registrations . /finance
|        |- /analytics . /team . /results . /certificates
|        |- /communications . /conference-day . /settings
|        |- (17 sections total)
|
|- /admin                                AdminGuard                role: OPERATIONS|ADMIN|SUPER_ADMIN
   |- index                              AdminHomePage
   |- /review . /verification . /organizers . /payments . /support
   |- /registrations                     AdminRegistrationsPage    ?q= search
   |- /audit                             AuditPage
   |- /audit/:targetType/:targetId       AuditDetailPage           <- 2 dynamic segments
   |- /go-live-queue                     NEW - getGoLiveQueue has no UI yet

*                                        NotFoundPage
```

**Dynamic segments:** `:slug` (mun detail, register), `:munId` (17 workspace sections), `:targetType` + `:targetId` (audit detail).
**Nested layouts:** `RootLayout`, `RegisterLayout`, `WorkspaceLayout` (**pathless** - React Router path-less route object maps 1:1 onto the Next `(workspace)` group), `MunWorkspaceLayout`, `AdminLayout`.

### 5.3 Protected routes

Three guard components wrapping subtrees via `<Outlet/>`:

```
<RequireAuth>                -> redirect /login?redirect=<encoded current URL>
<RequireRole roles={[...]}>  -> 403 page, NOT a redirect (a logged-in user lacking a role
                                should see "no access", not a login loop)
<RequireMunAccess>           -> for /organizer/dashboard/:munId - server remains the authority
```

**Critical invariant:** client guards are **UX only, never security.** Every endpoint independently enforces `assertOwnsOrAdmin` / `requireRole`. A user editing React state to `role: ADMIN` sees admin *chrome* and gets 403 on every request. State this in a comment inside each guard - it is exactly the kind of thing a future contributor "optimizes" by trusting the client.

Session source: one `useSession()` hook over `useQuery([session])` -> `GET /auth/session`. Cached and shared by header/guards/pages; `staleTime: Infinity`, invalidated on sign-in/sign-out.

**New behavior to design for:** with SSR gone there is a brief "session unknown" state on first paint. Guards must render a skeleton while `isPending`, **never redirect**. Redirecting on `isPending` causes a login bounce on every hard refresh for authenticated users. The 24 existing `loading.tsx` files are the right source material for those skeletons - lift them, do not rewrite them.

### 5.4 Next.js API -> React Router equivalents

| Next.js | Replacement | Sites |
|---|---|---|
| `next/link` `<Link href>` | react-router `<Link to>` | 42 |
| `useRouter().push()` | `useNavigate()` | 14 |
| `usePathname()` | `useLocation().pathname` | 12 |
| `useSearchParams()` | `useSearchParams()` (same name, tuple return) | 8 |
| `redirect()` in a page | `<Navigate to replace>` / guard | 49 |
| `notFound()` | `throw new Response(null,{status:404})` -> `errorElement` | 13 |
| `revalidatePath()` | `queryClient.invalidateQueries()` | 37 |
| `useActionState` | `useMutation` | 11 |
| `useFormStatus` | `mutation.isPending` | 8 |
| `next/font/google` | `@fontsource/*` or a `<link>` | 1 |
| `next/image` | `<img>` + `loading="lazy"` + explicit width/height | - |
| `metadata` export | `react-helmet-async` / direct head writes | 41 |
| `loading.tsx` | React Query `isPending` + `<Suspense>` | 24 |
| `error.tsx` | route `errorElement` | 1 |

The **37 `revalidatePath` calls are the highest-risk mechanical port**: each is a cache-invalidation instruction that must become a specific `invalidateQueries` call with the right key. Missing one produces stale UI that *looks correct* - a silent bug, not a crash. Section 6.3 makes this systematic.

`next/image` removal is a real (if modest) perf regression on the marketplace grid: no automatic responsive `srcset` or format negotiation. Accept for now; revisit with an image CDN if LCP suffers.

### 5.5 What ports cheaply vs. what is a rewrite

- **Cheap (import swaps, ~1-2 days):** all of `components/ui` (shadcn primitives), `components/mun`, `components/marketplace`, `components/dashboard`, `components/organizer`, `components/registration` - 8,100 LOC of plain React. Tailwind v4 + `docs/prd/DESIGN-airtable.md` tokens and `app/globals.css` move as-is (Vite has first-class Tailwind v4 support via `@tailwindcss/vite`).
- **Real rewrite (~44 files):** every Server Component page body. `async function Page() { const x = await someAction() }` becomes `function Page() { const {data} = useQuery(...) }`, plus loading and error states SSR previously made implicit.
- **Delete (~9 files):** the route-local `actions.ts` wrappers. Error mapping -> server middleware (Section 3.4); user-facing copy -> the client code -> copy map.

---

## 6. Decision 5 - Data-fetching strategy

### 6.1 Query key convention

Hierarchical arrays, coarse -> fine, so prefix invalidation works:

```
[session]
[muns, list, filters]
[muns, detail, slug]
[mun, munId, committees]
[mun, munId, committees, committeeId, portfolios]
[mun, munId, products]
[mun, munId, progress]
[mun, munId, submission]
[registrations, mine]
[registrations, registrationId]
[products, productId, availability]
[admin, review-queue, params]
[admin, go-live-queue, params]
```

`invalidateQueries({ queryKey: [mun, munId] })` then invalidates every section of one mun workspace in a single call - the direct analogue of `revalidatePath(/organizer/dashboard/[munId], layout)`.

**Enforcement:** a `queryKeys` factory module (`web/src/api/query-keys.ts`) exporting typed builders. Hand-written key arrays scattered across 44 pages will drift, and a drifted key is a silent stale-cache bug. Ban inline key literals in review.

### 6.2 Default options

```
staleTime: 30_000          // avoids refetch storms on nav; tuned per query
gcTime: 5 * 60_000
retry: (count, err) => err.status >= 500 && count < 2   // NEVER retry 4xx
refetchOnWindowFocus: true
mutations: { retry: 0 }    // 6.4 - automatic mutation retry is dangerous here
```

Per-query overrides:
- `[products, id, availability]` -> `staleTime: 0`, `refetchInterval: 15_000` while the registration funnel is open. Stale seat counts are the difference between a smooth flow and a capacity error at the payment step.
- `[admin, go-live-queue]`, `[admin, review-queue]` -> `staleTime: 0` (SLA is computed on read; a cached SLA state is a wrong SLA state).
- `[session]` -> `staleTime: Infinity`, manual invalidation only.
- `[muns, list]` -> `staleTime: 60_000`; the marketplace tolerates minute-old data.

**`retry: 0` on mutations is deliberate and load-bearing.** React Query default mutation retry is already 0 - it must stay there. Every mutation here is a state transition or money-adjacent. Automatic retry is the exact mechanism by which a "safe" client double-submits. Retries are opt-in per mutation, and only where an idempotency key is present (Section 6.4).

### 6.3 Mutation -> invalidation map (replacing the 37 `revalidatePath` calls)

Declared in `onSettled` (not `onSuccess` - a mutation that errors may still have partially committed related state, e.g. `submitMunForReview` writing `verification_issues` rows and returning `passed:false`).

| Mutation | Invalidates |
|---|---|
| create/update/delete committee, portfolio | `[mun, munId]` (progress + verification also shift) |
| create/update/delete product | `[mun, munId]`, `[muns, detail, slug]` |
| `updateMunDetails` | `[mun, munId]`, `[muns, detail, slug]`, `[muns, list]` |
| `submitFinalConfirmation` | `[mun, munId]` |
| `submitMunForReview` | `[mun, munId]`, `[admin, review-queue]` |
| `reviewSubmission` | `[mun, munId]`, `[admin, review-queue]`, `[admin, go-live-queue]` |
| `enqueueForGoLive` / `publishFromQueue` | `[mun, munId]`, both admin queues, `[muns, list]` |
| `initiateRegistration` | `[products, productId, availability]`, `[registrations, mine]` |
| `signIn` / `signOut` | `queryClient.clear()` - **not** selective |

`clear()` on auth change is deliberate: selective invalidation risks leaving a previous user cached organizer/admin data in memory and briefly rendering it to the next user.

**Cross-cutting invalidation the old model handled implicitly:** the lifecycle engine mutates far more than the entity you touched - `onModuleDataChanged` recomputes module progress, `triggerReverificationIfNeeded` can flip a VERIFIED mun back to VERIFICATION, `transitionMun` writes audit rows. `revalidatePath(.../committees)` covered this because the page re-rendered from the DB wholesale. React Query does not. **That is why every mun-scoped mutation invalidates the whole `[mun, munId]` prefix, not just the sub-key.** Over-invalidation is a modest bounded perf cost; under-invalidation is a correctness bug where the organizer progress bar or lifecycle badge silently lies. Choose over-invalidation; revisit with data.

### 6.4 The onboarding pipeline - concurrency and idempotency across a network

Server guarantees (Section 1.4) are strong. The frontend job is to not undermine them.

**Threat: double-submit on a slow network.** User clicks Publish; the request is in flight 8 seconds; the user clicks again. Server-side, `publishFromQueue` row lock serializes the two and the second returns `{replay:true}` - **only if both carry the same idempotency key.** If the client generates a fresh UUID per click, the second call takes the lock after the first commits, sees `status === PUBLISHED`, and still returns replay via the *status* branch. Correct here - but `submitMunForReview` has **no such key** and would throw `This mun already has an active submission in review` on the second click, showing the organizer an error for an operation that actually succeeded.

**Mitigations - all four, not one:**

1. **Generate the idempotency key once per user intent, not per request.** `useRef` a UUID when the confirm dialog opens; reuse it for every attempt of that intent; reset only when the dialog closes and reopens. Send as `Idempotency-Key`. Without this, the guarantee is theater.
2. **Disable the trigger while `mutation.isPending`.** Necessary but insufficient - does not survive a mid-flight refresh or two open tabs.
3. **Treat `409 CONFLICT_ACTIVE_SUBMISSION` on submit as a probable success.** Refetch `[mun, munId, submission]`; if an active submission now exists, show success. This is the client-side analogue of the server replay branch, for the operation that lacks a key.
4. **Never auto-retry these mutations.** Retries turn a timeout into a double-execution.

**Multi-step flow state lives on the server, not in client state.** The pipeline is `ONBOARDING -> READY_FOR_SUBMISSION -> CONTENT_SUBMITTED -> AUTOMATED_VALIDATION -> ORGANIZER_CONFIRMATION -> VERIFICATION -> VERIFIED -> GO_LIVE_QUEUE -> PUBLISHING -> PUBLISHED` with `ACTION_REQUIRED` loops. The UI renders **from `getMunProgress` / `mun.status`**, never from a local `currentStep`. With SSR, every navigation re-read the true state; a SPA will happily hold a stale step across a refresh. The wizard is a *projection* of server state.

**`{passed:false, blockers:[]}` is a success, not an error** (Section 3.3). `onSuccess` branches on `data.passed`. Mapping it to an error swallows the blocker list - the entire value of the validation engine to the organizer.

**Optimistic updates: allowed for simple CRUD (committee rename, portfolio add/delete); forbidden anywhere in the lifecycle pipeline.** Optimistically showing `PUBLISHED` before the server PUBLISH-stage revalidation has run is a lie the user may act on - and the pipeline whole point is that publish can legitimately fail at the last moment. Use `isPending` states, not optimism.

### 6.5 Pagination

`getReviewQueue`, `getModuleReviewQueue`, `getGoLiveQueue` and `admin-search` all use `limit`/`offset` with `DEFAULT_PAGE_SIZE = 20` and return `{results, total}`. Map to `useQuery` with the page in the key (`[admin, go-live-queue, {limit,offset}]`) plus `placeholderData: keepPreviousData` to avoid list flicker on page change. **Not `useInfiniteQuery`** - these are admin tables where jump-to-page matters more than infinite scroll.

### 6.6 Date serialization - small, guaranteed to bite

Drizzle returns real `Date` objects; RSCs passed them through the serialization boundary intact. **JSON has no date type.** `startDate`, `endDate`, `deadline`, `expiresAt`, `slaDeadline`, `submittedAt`, `publishedAt`, `createdAt`, `updatedAt` all become ISO strings over the wire, and every `formatDate(mun.startDate)` or `.getTime()` in the ported components breaks - some loudly, some (string comparison on ISO dates) silently and *almost* correctly.

**Decision:** revive dates centrally in the typed client via a reviver over a **known key allowlist** (suffix `At` / `Date` / `deadline`), so component-level types stay `Date` and ported components need no change. `superjson` is heavier and couples both ends to a serialization library; a ~15-line reviver suffices. **Explicitly an allowlist, not a regex over every ISO-looking string** - blanket revival would corrupt legitimate string fields that happen to parse as dates.

Cover with a dedicated test asserting a `Date` in equals a `Date` out through a real HTTP round-trip. Exactly the class of bug integration tests catch and unit tests miss.

---

## 7. Decision 6 - SEO regression handling

### 7.1 What is at risk

Only three route families are publicly indexable (`app/robots.ts` disallows `/admin`, `/organizer`, `/dashboard`, `/api`, `/login`, `/register`):

1. `/` - homepage
2. `/muns` - marketplace listing
3. `/mun/:slug` - **the commercially important one.** Conference detail pages are the organic-search entry point for a marketplace ("BITSMUN Hyderabad 2025"), and `app/sitemap.ts` already enumerates every public slug via `listPublicMunSlugs()`.

The other 38 `metadata` exports sit on authenticated pages where SEO is irrelevant - they affect only browser tab titles, handled by `react-helmet-async`.

### 7.2 Alternatives

**A. Accept the loss (CSR only)**
- *Pros:* zero work; Googlebot does execute JS.
- *Cons:* JS-rendered indexing is slower and less reliable than HTML; **social preview crawlers (WhatsApp, Twitter/X, LinkedIn, Slack) do not execute JS at all** - every shared conference link renders as a blank card. For a MUN marketplace in India, WhatsApp sharing is plausibly a *primary* acquisition channel.
- **Reject** for `/mun/:slug`.

**B. Keep a thin Next.js SSR shell for public pages**
- *Pros:* best SEO fidelity; dynamic metadata free.
- *Fatal flaw:* keeps Next.js in the stack and its SSR cost on exactly the highest-traffic public pages - the precise thing the migration exists to eliminate. Also doubles the frontend (two codebases, two component trees, two routers). **Reject.**

**C. Build-time prerendering (vite-plugin-ssg / react-snap / Puppeteer crawl)**
- *Pros:* static HTML per route; no request-time render.
- *Fatal flaw:* MUN pages are created by organizers **continuously** and published through the go-live pipeline. Build-time prerender means a newly published MUN has no static HTML until the next deploy. For a marketplace whose supply is user-generated, unacceptable - publishing is a runtime event, not a build event. **Reject as the sole mechanism.**

**D. On-demand crawler-targeted prerendering - RECOMMENDED**

Middleware in front of the static SPA: when the User-Agent is a known crawler/social scraper, serve server-rendered HTML for the 3 public route families; otherwise serve the SPA shell.

- **D1 - self-hosted:** a Hono route (same service or a sibling) that, for those paths, fetches `/api/v1/muns/:slug` and returns HTML with meta tags plus a minimal semantic body (name, dates, venue, theme, committees). Cached with a short TTL, invalidated on publish. ~150-250 lines. **No React SSR involved** - templating a head plus a summary body, not rendering the app. That is what keeps it genuinely cheap, which is the point.
- **D2 - managed:** Prerender.io, or Cloudflare HTML rewriting at the edge. Less code, a vendor dependency and cost.

**Recommend D1.** The data is already available via the API, the content is simple and structured, publish is already a discrete cache-invalidation event, and it adds zero request-time cost for the 99% of traffic that is real users.

**Cloaking concern, addressed:** serving different HTML to crawlers is penalized when the *content differs*. Here the crawler HTML is a faithful subset of what the SPA renders - the documented, accepted "dynamic rendering" pattern. Google has moved away from recommending it for *search*, but it remains the only option for non-JS social scrapers. **Ship `/mun/:slug` (and `/muns`) with real meta + OpenGraph + JSON-LD `Event` structured data**, which arguably improves on today SEO.

**Also required, easy to forget:** `app/sitemap.ts` and `app/robots.ts` port to plain API routes - `GET /sitemap.xml` and `GET /robots.txt` on the backend (or the prerender service), reusing `listPublicMunSlugs()` **unchanged**. A 30-minute task; losing the sitemap is a bigger SEO hit than losing SSR.

### 7.3 Trade-offs accepted

- One extra service/middleware to maintain.
- Crawler HTML can drift from SPA content if a future dev edits one and not the other. Mitigate with a test asserting the crawler HTML title/description match the API data for a seeded MUN.
- First paint for real users is slower than SSR (JS must load). Mitigated by Vite route-level code-splitting, and this is the explicitly accepted cost of leaving SSR - noting honestly that **TTFB improves dramatically while LCP on a cold cache may regress.** If LCP proves more important than TTFB on marketing pages, that is a signal to revisit - and D1 infrastructure extends to serving *all* users on those 3 routes (static-HTML-first) without a rearchitecture. A good escape hatch.

---

## 8. Decision 7 - Migration sequencing

### 8.1 Alternatives

A. Hard cutover (build everything on a branch, merge once)
- Pros: no dual maintenance; no proxy; clean history.
- Cons: a multi-week branch against a repo where two sessions actively land features. A 6-week branch would face a merge of ~25,000 LOC against a moving target, with no shippable intermediate state and no way to validate the new stack under real use until the very end.
- Reject - not for purity, but because the merge-conflict cost alone likely exceeds the migration cost.

B. Incremental strangler, page-by-page behind a proxy - RECOMMENDED
- Pros: every phase boundary is shippable; the new API is validated by the old Next app before the SPA exists (the highest-value de-risking available); rollback is a proxy config change; the two sessions keep mostly-separate territory.
- Cons: both stacks run concurrently for weeks; the proxy is new infrastructure; session cookies must work across both - they do, same cookie name, same sessions table, same domain, which is precisely why the Section 4 decision to keep the existing session table pays off here.
- Reversibility: two-way door at every phase boundary.

C. Backend-first only, defer the frontend indefinitely
- Effectively Phases 1-2 of B, then stop. Worth naming as a legitimate pause point: extracting the API and pointing the existing Next app at it delivers a decoupled, testable backend even if the SPA slips. It does not deliver the latency win, which is the entire motivation. A valid fallback, not a plan.

### 8.2 Recommended phases

Each phase ends green: tsc --noEmit clean, full suite passing, app deployable.

Phase 0 - Coordination and freeze (before any code)
- Communicate to the other session (Section 9); get explicit acknowledgement.
- Agree an app/ freeze: no new Next.js pages after Phase 0 (fixes to existing pages are fine).
- Set up the layout: /lib (shared, unchanged, imported by both), /server (new Hono API), /web (new Vite SPA), /app (existing Next app, deleted at the end).
- Keep the root tsconfig alias so lib imports work identically from all three. Avoids a package-manager workspace migration mid-project - one less variable.
- Exit: both sessions acknowledge; layout committed; nothing else changed.

Phase 1 - Decouple lib from Next.js
- Split lib/auth/session.ts: add getSessionByToken(token), delete getSession(), remove the next/headers import.
- Refactor the 24 getSession call sites across 9 action files to explicit session params (Section 1.2).
- Refactor lib/actions/auth.ts: signIn returns the token; no cookie access.
- Update the Next callers that must now resolve the session themselves (mechanical - pages already do this for Pattern A actions).
- Remove the use-server directive from lib/actions files; they become plain modules. The Next app still calls them via its own route-local wrappers, which keep their own directive.
- Exit: grepping for next imports under lib returns zero; the Next app still works; all ~579 tests pass. The single most valuable phase - after it, lib is portable regardless of whether anything else finishes.

Phase 2 - Standalone API service
- Hono plus the Node server adapter; middleware order: request-id, logger, CORS, cookie/session, CSRF-origin, rate-limit, routes, error handler.
- Route files 1:1 with action files (~21 files, 200-400 LOC each).
- Zod schemas per endpoint, strict mode on every body.
- The trusted-parameter audit (Section 3.3.1) across all ~75 exposed functions. Deliverable: a checklist, not a vibe.
- Port the payments webhook (raw-body signature verification preserved exactly).
- Port the sitemap and robots routes.
- Integration tests hitting real HTTP against the real local Postgres, not mocked handlers (max 2 mocks; never mock the system under test). Existing tests stay; these are additive.
- Exit: the API serves every route with tests; the Next app untouched and still primary. Independently verifiable before anything depends on it.

Phase 3 - Vite SPA skeleton plus public routes
- Vite, React, Tailwind v4, React Router, React Query; port globals.css and design tokens.
- Typed API client, queryKeys factory, date reviver (Section 6.6).
- Lift components/ui and the shared component tree (import swaps only).
- Build the homepage, marketplace, mun detail, login, and RootLayout.
- Stand up the reverse proxy: public routes to SPA, everything else to Next.
- Exit: public marketplace served by the SPA in production. Highest-traffic, lowest-risk pages first; validates proxy, cookies, CORS and data fetching on real traffic before touching anything transactional.

Phase 4 - Authenticated read-heavy routes
- Student dashboard, the register funnel, support intake.
- RequireAuth, useSession, redirect preservation.
- The registration funnel needs care: availability polling, idempotency key on initiateRegistration, capacity-error handling (Section 6.4).
- Exit: proxy routes these to the SPA; students fully on the new stack.

Phase 5 - Organizer workspace (largest phase)
- 17 workspace sections, nested layouts, MunSwitcher.
- The onboarding/go-live pipeline UI with the Section 6.4 guarantees.
- Retire submitMunForVerification in favour of submitFinalConfirmation (Section 3.3.2).
- Exit: organizers fully migrated.

Phase 6 - Admin console
- 9 admin routes plus the new go-live-queue page (backend exists, no UI).
- Lowest traffic, highest privilege - last, so the pattern is well established.
- Exit: all traffic on the SPA.

Phase 7 - Retire the old framework
- Removal list: the app directory, the framework config file, its lint preset, and the framework package itself.
- Also remove the edge-deploy scaffolding files, since they are framework-specific.
- Collapse the proxy if a simpler topology suffices.
- Update the project context docs, the README, and the package scripts.
- Exit: zero references to the old framework.


### 8.3 The proxy

Caddy (simplest config), nginx, or edge-platform routing. It needs only path-prefix routing and cookie pass-through. Decide at Phase 3 based on the deployment target; not load-bearing earlier, so defer it.

---

## 9. Session coordination - REQUIRED BEFORE ANY CODE

CLAUDE.md documents two parallel sessions with an explicit territory split. This migration **violates that split by construction**: it changes the contract surface (lib/actions/*, lib/auth/session.ts) the backend session owns AND deletes the entire app/ tree the UI session owns.

**Do not start Phase 1 until the other session acknowledges.** Send, via SendMessage:

1. **What is changing:** the old framework is removed entirely; app/ will be deleted; lib/ survives.
2. **The breaking change, with a name and a number:** 9 files, 24 call sites - getSession() becomes a session parameter. Any code calling getRegistrationById(id), getReviewQueue(...), searchRegistrations(...) etc. without a session argument stops compiling. List the 9 files explicitly.
3. **The freeze request:** no new files under app/ after Phase 0. This is exactly the conflict the brief flags - a page authored mid-migration is pure waste (it gets deleted) AND a merge conflict.
4. **Still safe to work on:** anything under components/ (ports forward nearly unchanged), design-system work, new lib/ business logic (survives intact), tests.
5. **The handoff:** after Phase 3, new UI work happens in /web against React Router + React Query, not app/. The natural split is plausibly backend session doing Phases 1-2, UI session doing Phases 3-6.
6. **The worktree note:** this design was written from .claude/worktrees/onboarding-go-live-pipeline (branch worktree-onboarding-go-live-pipeline, 0de1d87) while main is at 4703b7a. **That pipeline work must land on main before Phase 1 begins** - refactoring 24 session call sites across two divergent branches is a merge conflict with a security-sensitive blast radius (a botched merge on a session-parameter refactor is an auth bug, not a compile error). Sequence: land the worktree, then migrate.

**Also record in the project context doc:** its "Stack (locked decisions)" section currently locks the App Router and "Server Actions + Route Handlers only - no separate backend service." This migration **reverses a locked decision**, so that doc must be updated in the same commit as Phase 0 - otherwise a future agent reads the locked decision and "corrects" the migration back toward the old framework. That failure mode is exactly what the locked-decisions section exists to prevent, and it cuts both ways.

---

## 10. Effort estimate

Calibrated to measured size: 132 files / ~16,900 LOC in app/; ~8,100 LOC in components/; 21 action files (~110 exports, ~75 HTTP-exposed); 29 tables; **579 tests across 48 files**; 44 Server Components; 57 client components.

| Phase | Scope | Estimate |
|---|---|---|
| **0** - Coordination and layout | Comms, ack, monorepo dirs, context-doc update | **0.5-1 day** |
| **1** - Decouple lib/ | Session split; 24 call sites / 9 files; auth.ts; Next callers; keep 579 tests green | **3-5 days** |
| **2** - API service | 21 route files, ~75 endpoints, Zod schemas, middleware stack, error taxonomy, trusted-param audit, webhook, sitemap/robots, HTTP integration tests | **10-15 days** |
| **3** - SPA skeleton + public | Vite/Tailwind/Router/Query setup, typed client, key factory, date reviver, component lift (8,100 LOC, mostly mechanical), 4 routes + layout, proxy | **8-12 days** |
| **4** - Auth read-heavy | Guards, useSession, student dashboard, 3-step registration funnel with idempotency + availability polling | **5-8 days** |
| **5** - Organizer workspace | 17 sections, nested layouts, MunSwitcher, full go-live pipeline UI, shim retirement | **12-18 days** |
| **6** - Admin console | 9 routes + new go-live queue UI | **6-9 days** |
| **7** - Retire the old framework | Removal, config, docs, scripts | **1-2 days** |
| **Contingency** | ~20% - SEO tuning, proxy/cookie issues, unknowns | **9-14 days** |
| **TOTAL** | | **55-85 working days** |

**~11-17 working weeks for one engineer; ~6-9 calendar weeks with the two sessions in parallel** (they genuinely parallelize after Phase 2: backend session on API hardening + Phase 6, UI session on Phases 3-5).

**What would move these numbers:**
- *Faster:* the component lift is cleaner than assumed (if next/link and useRouter are the only framework imports in components/, Phase 3 drops several days); several of the 17 organizer sections are likely stubs - components/organizer/module-placeholder.tsx exists, so **count the real ones before committing to Phase 5 number.**
- *Slower:* the 37 revalidatePath -> invalidateQueries mappings producing subtle stale-cache bugs found late; SSR-to-CSR loading-state design work (the 24 loading.tsx files help but do not cover every async boundary); auth/cookie issues across the proxy boundary; the trusted-parameter audit surfacing more than one issue.

**Deliberately excluded:** real auth provider integration (Section 4.7 - its own project), real payment gateway, any new features.

---

## 11. Non-goals / deferred

1. **Rewriting business logic.** lib/actions/, lib/lifecycle/, lib/db/, validators, SLA, notifications, encryption are ported by *changing their callers only*. The one exception is the mechanical session-parameter refactor (Section 1.2). Anything else is scope creep.
2. **Fixing signIn(email) passwordless auth.** Out of scope - but Section 4.7 production boot-guard is **in** scope and mandatory. The migration must not make an existing hole publicly routable.
3. **Choosing a real auth provider.** Locked as undecided in the project context doc. The adapter interface holds (Section 4.8).
4. **Real payments gateway (Razorpay).** Mock adapter continues.
5. **Schema changes.** Zero migrations. lib/db/schema.ts is byte-identical after this work.
6. **Typed error classes in lib/.** The right long-term fix for Section 3.4 string matching, deferred so migration and refactor stay separable. Mitigated by a mapping test.
7. **New features.** No new UI, no new endpoints beyond exposing what exists. One exception: an admin go-live-queue page for the already-built getGoLiveQueue, because a backend endpoint with no UI is dead code by the project own connectivity rules.
8. **Deployment platform decision.** The edge-deploy scaffolding is framework-specific and is deleted in Phase 7. Where the SPA and API run is a separate decision deferred to Phase 3. Hono keeps the edge-runtime option viable (modulo Postgres-over-TCP needing a connection proxy - flagged, not decided).
9. **Distributed rate limiting.** In-memory to start, single instance, documented as per-instance.
10. **Removing the edge-deploy tooling early.** Inert until Phase 7; removing sooner adds churn for nothing.
11. **SSR for authenticated pages.** Never coming back. Those pages are behind auth, uncacheable and unindexed - SSR buys them nothing and costs latency.
12. **Migrating the test suite to a new runner.** Vitest stays. The vitest.setup.ts .env.test pinning is a **hard invariant** (the project context doc records 472 junk MUNs written to live Neon when it was absent). New API integration tests must inherit the same setup file. **Do not create a separate Vitest config for /server without carrying the .env.test pinning forward** - that is precisely the regression the context doc warns about.

---

## 12. Consequences

**Positive**
- SSR/RSC overhead gone from every page render - the stated goal.
- Backend becomes a real, independently testable, independently deployable API; mobile/partner clients become possible.
- lib/ reaches full framework independence (Phase 1 alone delivers this even if everything after slips).
- Frontend build/HMR gets dramatically faster.
- Auth/authorization becomes explicit and compiler-checked rather than ambient.
- Input validation becomes uniform and explicit at a single boundary (Zod per endpoint) rather than implicit in Server Action typing.

**Negative**
- Two deployable units instead of one; a proxy to operate.
- CSRF and rate limiting become the team problem (the old framework handled the former implicitly).
- SEO requires a dedicated mechanism (Section 7) instead of being free.
- Client-side loading/error states must be designed for ~44 pages that previously got them from SSR.
- Cold-start LCP on public pages likely regresses even as TTFB improves.
- Automatic responsive image optimization is lost.
- Cache invalidation moves from declarative (revalidatePath) to explicit (37 mappings) - more control, more places to be wrong.

**Risks**

| Risk | Severity | Mitigation | Reversible? |
|---|---|---|---|
| Session-parameter refactor merged wrong across two branches -> auth anomaly | **Critical** | Land the worktree on main first (Section 9.6); compiler catches missing args; requireRole/assertOwnsOrAdmin throw on null, so the failure mode is 403, not silent allow | Yes |
| A public endpoint exposes a previously-internal trusted parameter (Section 3.3.1) | **High** | Explicit Phase-2 audit deliverable across all ~75 functions; strict Zod bodies | Yes |
| signIn(email) reachable in production | **Critical** | Section 4.7 boot-time guard, following the field-encryption key precedent | Yes |
| Non-type import from lib/ into web/ bundles the DB driver and encryption code into the browser | **Critical** | import-type convention **plus** a lint rule (convention alone is insufficient) | Yes |
| Missing invalidateQueries -> stale UI that looks correct | Medium | Prefix invalidation on [mun, munId]; over-invalidate by default | Yes |
| Double-submit on slow network defeats an idempotency guarantee | **High** | Section 6.4 four layers; Idempotency-Key required on publish; retry 0 on mutations | Yes |
| passed:false mapped to an HTTP error -> blocker list lost | Medium | Explicit 200 contract (Section 3.3); test asserting the status code | Yes |
| Date serialization breaks formatting subtly | Medium | Central reviver + HTTP round-trip test (Section 6.6) | Yes |
| Other session lands a new page under app/ mid-migration | Medium | Section 9 freeze + acknowledgement before Phase 0 exits | Yes |
| Hono Node rate-limit middleware inadequate | Low | Verify in Phase 1; rate-limiter-flexible as the runtime-agnostic fallback | Yes |
| Migration stalls half-done, leaving two stacks indefinitely | Medium | Every phase boundary shippable; Phase 1 has standalone value; Phase 3 is the first user-visible win and should not be allowed to slip far | Yes |

**Reversibility summary**
- **Two-way doors:** Hono vs Fastify (given thin handlers), REST vs tRPC (additive), prerender approach, proxy choice, per-phase cutover (proxy config), rate-limit backend.
- **One-way doors needing the most scrutiny:** deleting app/ in Phase 7 - do it last, after Phase 6 has been stable in production for a meaningful period; and the session-parameter refactor - recoverable, but security-sensitive, so review it as security code, not as a refactor.

---

## 13. Contracts

**lib/auth/session.ts (post-Phase 1)**
```ts
getSessionByToken(token: string): Promise<Session | null>
// pre:  token is the raw opaque session token
// post: returns {userId, role} iff a sessions row matches AND expiresAt > now
//       AND users.suspended is false; otherwise null.
//       No cookie access. No framework import.

createSession(userId: string): Promise<{ token: string; expiresAt: Date }>  // unchanged
destroySession(token: string): Promise<void>                                // unchanged, idempotent
```

**Hono context**
```ts
type Variables = { session: Session | null; requestId: string }
// post: session is set by sessionMiddleware on EVERY request (null when absent
//       or invalid). Handlers never read cookies directly.
```

**Every route handler**
```
pre:  session resolved by middleware; body validated by Zod (strict)
post: calls exactly one lib function (or a small composition), passing
      c.get(session) as the session argument; returns its result serialized,
      or throws for the error middleware.
invariant: NO handler imports db.
           NO handler re-implements authorization.
           NO handler contains a transaction.
```

**Action layer (post-Phase 1, uniform)**
```ts
fn(...domainArgs, session: Session | null): Promise<T>
// pre:  session is server-derived; callers MUST NOT construct one from client input
// post: throws Forbidden when unauthorized; domain errors as documented per fn
```

**Typed API client**
```ts
request<T>(method, path, opts?): Promise<T>
// post: throws ApiError{code, message, status} on non-2xx
//       revives ISO date strings on allowlisted keys into Date
//       sends credentials: include
//       injects Idempotency-Key when opts.idempotencyKey is present
// invariant: only import-type from @/lib/**  (lint-enforced)
```

**Idempotent mutations**
```
pre:  client sends a stable Idempotency-Key for the duration of ONE user intent
post: server returns 200 with the same body shape on replay (replay: true
      where the operation exposes it); never double-executes
invariant: the client MUST NOT regenerate the key per retry
```
