# Subdomain Architecture — Design

**Date:** 2026-09-17
**Status:** Fully live, and one critical bug found + fixed during post-deploy review (2026-09-17, second pass): the cross-subdomain cookie sharing this whole design exists for was **not actually working** — see §5c.

**Status (original deploy pass):** `munhub.in` onboarded to Cloudflare (was BigRock nameservers, now `marty`/`sima.ns.cloudflare.com`). `munhub-web` deployed with `app.`/`organize.`/`admin.munhub.in` as Custom Domains and `*.munhub.in/*` as a Workers Route (backed by a manually-added wildcard DNS record — see §3) — all verified serving the SPA over HTTPS. `munhub-api` deployed with `api.munhub.in` as a Custom Domain, backed by Cloudflare Hyperdrive for Neon access — verified returning real seeded data (`GET /api/v1/muns`). `munhub.in`/`www.munhub.in` DNS untouched, still on Vercel. See the plan doc for the one real bug this deploy surfaced (an eager module-load pattern in `lib/crypto/field-encryption.ts` incompatible with Workers, now fixed).
**Supersedes:** CLAUDE.md's prior "Routing: path-based `/mun/[slug]` — wildcard subdomains deferred" note, and PRD Section 15 / `MUNHub_Ultra_Fast_Performance_PRD.md` Section 16 ("deferred") status.

## 1. Context

The user owns `munhub.in` and `www.munhub.in` (registrar DNS currently has only apex + www records, nameservers already on Cloudflare) and wants to move from path-based role routing (`/dashboard`, `/organizer/*`, `/admin/*` all under one host) to subdomain-based role routing, plus the PRD's original per-MUN wildcard subdomain vision (`oxford.munhub.in`), now that DNS is available to build on.

This lands in the middle of the Next.js → Vite/Hono migration (see `docs/superpowers/specs/2026-09-15-nextjs-to-react-spa-migration-design.md`). Relevant existing state, confirmed by exploration:

- **`/web`** (Vite SPA, React Router v7 data-router) is a single SPA covering all roles via client-side guards (`RequireAuth`, planned `RequireRole`) — not split into per-role bundles. `web/src/routes.tsx` already has the full route tree. No proxy/base-path config in `web/vite.config.ts`.
- **`/server`** (standalone Hono API) currently boots only via `@hono/node-server`'s `serve()` (Node process, no Cloudflare Workers entrypoint yet). `server/src/app.ts` wires `cors({ origin: parseCorsOrigins(), credentials: true })` where `parseCorsOrigins()` is an **exact-string allowlist** (`CORS_ORIGINS` env var, default `http://localhost:5173,http://localhost:3000`) — no subdomain pattern support.
- **Session cookie** (`server/routes/auth.ts`'s `setSessionCookie()`) sets `httpOnly`, `secure` (prod-only), `sameSite: 'Lax'`, `path: '/'` — **no `domain` attribute**, so it defaults to host-only scope and will NOT be sent across subdomains as-is. `deleteCookie` on sign-out also has no `domain`, so once we add one, sign-out must pass the same value or logout silently fails to clear it.
- No `middleware.ts`, no hostname/`Host`-header logic anywhere in the repo today — this is greenfield.
- The Next.js app (`/app`, being retired in migration Phase 7) has `wrangler.jsonc` + `open-next.config.ts` at repo root for `@opennextjs/cloudflare`, but no `routes`/custom-domain config — it has never been deployed. This is legacy and out of scope here; do not extend it for subdomains.
- Migration spec Section 4.5 already independently recommended a same-registrable-domain split (`app.munhub.com` / `api.munhub.com`) for `SameSite=Lax` + no-CORS-preflight reasons — this design is consistent with and extends that reasoning to the full role split the user now wants.

## 2. Domain layout (decided)

**Important, discovered mid-implementation (2026-09-17):** `munhub.in`/`www.munhub.in` are already live in production today, deployed to **Vercel** (the Next.js app, `/app`) — not through this repo's tracked `wrangler.jsonc`/OpenNext scaffold as previously assumed. This rollout does **not** touch that DNS yet. Only the four new hosts below (`app.`/`organize.`/`admin.`/`api.` + the wildcard) are added fresh, pointed at the new Cloudflare Workers. Cutting `munhub.in`/`www` over from Vercel to the new Vite SPA Worker is a separate, later step gated on migration Phase 6 being stable (CLAUDE.md: "Phase 7 (retire Next) only after Phase 6 is stable in production") — do not repoint apex/www DNS as part of this work.

| Host | Serves | Notes |
|---|---|---|
| `munhub.in` | **Unchanged for now** — live Next.js app on Vercel | Cutover to the new SPA deferred to Phase 7 |
| `www.munhub.in` | **Unchanged for now** — live Next.js app on Vercel | Eventually a 301 → `munhub.in`, once cut over |
| `app.munhub.in` | Student area (new SPA build, default landing `/dashboard`) | New host, new Worker |
| `organize.munhub.in` | Organizer workspace (new SPA build, default landing `/organizer/dashboard`) | New host, new Worker |
| `admin.munhub.in` | Admin/ops console (new SPA build, default landing `/admin`) | New host, new Worker |
| `api.munhub.in` | Hono API | New host, new Workers entrypoint (see §4) |
| `*.munhub.in` (any other label) | Per-MUN conference page — label is treated as the MUN `slug`, rendered via the existing `/mun/:slug` route | PRD Section 15's original vision; only matches subdomains, never the bare apex, so it can't collide with the still-live Vercel apex/www |

Reserved labels that can never be allocated as a MUN slug: `www`, `app`, `organize`, `admin`, `api`. This must be enforced in slug validation, not just DNS routing, or an organizer picking slug `admin` breaks the admin console.

**One SPA build, not one-per-role.** The existing single-SPA architecture (`web/src/routes.tsx`) already contains every role's routes behind client-side guards. Splitting into separate bundles per subdomain would duplicate the whole route tree and guard logic for no benefit — instead, the same static build is served on all five app-facing hosts, and a small host-aware helper picks the default landing route and renders per-MUN content for the wildcard case. Client-side guards remain UX-only; every server action/API route still independently re-checks role server-side (existing invariant, unchanged).

## 3. Cloudflare topology

Two Workers, matching the existing `/web` vs `/server` split:

- **`munhub-web`** (from `/web`, static assets via Workers Static Assets, `not_found_handling: "single-page-application"` for client-side-router fallback):
  - Custom Domains (now): `app.munhub.in`, `organize.munhub.in`, `admin.munhub.in`. **Not** `munhub.in`/`www.munhub.in` yet — those stay pointed at the existing Vercel deployment until the Phase 7 cutover (see §2).
  - Wildcard Route: `*.munhub.in/*` — catches every other subdomain (per-MUN slugs). Only matches `label.munhub.in` patterns, never bare `munhub.in`, so it cannot intercept the still-live Vercel apex/www. **Important, learned during deploy:** unlike Custom Domains, a Workers Route does NOT create its own DNS record — a `*.munhub.in` DNS record (any proxied placeholder, e.g. `AAAA * 100::`) must exist in the zone first, or the wildcard hostnames simply won't resolve at all.
  - The `www` → apex redirect (and the apex Custom Domain itself) is deferred to the Phase 7 cutover along with the rest of the Vercel→Cloudflare move — not part of this rollout.
- **`munhub-api`** (from `/server`, new Workers fetch handler — see §4):
  - Custom Domain: `api.munhub.in`.

This requires the wildcard DNS record `*.munhub.in` (proxied/orange-cloud) to exist in the Cloudflare zone — Workers Routes with a wildcard hostname need the DNS record present even though the Route (not the DNS record's content) determines where traffic goes.

The existing root `wrangler.jsonc`/`open-next.config.ts` (Next.js via OpenNext) is untouched — it stays reserved for the legacy Next app until migration Phase 7 retires it, per CLAUDE.md's existing phase ownership.

## 4. Hono Workers entrypoint

`server/src/index.ts` (Node, `@hono/node-server`'s `serve()`) stays for local dev. Add `server/src/worker.ts`:

```ts
import app from './app'
export default app // Hono instances are already fetch-handler compatible
```

New `server/wrangler.jsonc` pointing `main` at the compiled worker entry, with the `api.munhub.in` Custom Domain and whatever env bindings the API needs (`DATABASE_URL`, `PAYMENT_FIELD_KEY`, `COOKIE_DOMAIN`, `CORS_ORIGINS`, etc. — same set `server/.env`/`.dev.vars.example` already documents for the Node path, now also as Workers secrets).

## 5. Cookie domain fix

`setSessionCookie()` and the matching `deleteCookie()` call in `server/routes/auth.ts` both need a `domain` option, env-driven so local dev (`localhost`) is unaffected:

```ts
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN // e.g. ".munhub.in" in prod, unset locally
setCookie(c, SESSION_COOKIE_NAME, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  path: '/',
  domain: COOKIE_DOMAIN, // undefined locally → unchanged host-only behavior
  maxAge: COOKIE_MAX_AGE_SECONDS,
  expires: expiresAt,
})
// sign-out:
deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', domain: COOKIE_DOMAIN })
```

`.munhub.in` (leading dot, or the modern no-dot form — both work the same in current browsers) makes the cookie valid for `munhub.in` and every subdomain. `SameSite=Lax` is unaffected — all these hosts share the same registrable domain (`munhub.in`), so cross-subdomain requests are still same-site, not cross-site; no CSRF posture change.

## 5b. CSRF origin allowlist fix (found post-deploy by a peer session)

`server/middleware/csrf.ts`'s `ALLOWED_ORIGINS` was a hardcoded localhost-only set, independent of `app.ts`'s CORS matcher — meaning every mutating request (`POST`/`PUT`/`PATCH`/`DELETE`, including login itself) from the real deployed SPA got a 403 CSRF rejection, since `Origin: https://munhub.in` was never in that set. Fixed with the same `MUNHUB_ORIGIN_PATTERN` regex `app.ts`'s CORS matcher uses (duplicated rather than imported, to avoid an `app.ts` ↔ `csrf.ts` import cycle). Verified in production: `POST /api/v1/auth/session` with `Origin: https://munhub.in` returns 200 + session cookie.

## 5c. The cross-subdomain cookie was never actually working (found in post-deploy review, 2026-09-17)

After the full stack was live, a real login against production (`POST /api/v1/auth/session` with `Origin: https://app.munhub.in`) came back with **no `Domain=` attribute on the `Set-Cookie` header at all** — meaning every subdomain still got its own host-only session, the exact problem §5 was supposed to fix.

Root cause, and it's bigger than just this one cookie: **Cloudflare Workers never populate arbitrary custom `vars`/secrets into `process.env`.** Only `NODE_ENV` is special-cased (statically replaced by Wrangler's bundler at build time — which is why `secure: process.env.NODE_ENV === 'production'` worked fine and masked the problem). `server/routes/auth.ts` read `process.env.COOKIE_DOMAIN` at module scope — on Workers that's always `undefined`, config or no config. The same bug independently affected two other reads: `lib/crypto/field-encryption.ts`'s `PAYMENT_FIELD_KEY` (the earlier "fix" in §8/the plan doc only solved the *deploy-time crash* from reading it eagerly — making it lazy didn't fix the *source*, so it would still have thrown "not set" on the first real payment-settlement write in production) and `lib/payments/mock-adapter.ts`'s `MOCK_PAYMENT_WEBHOOK_SECRET` (would have thrown on the first real webhook).

Fixed generically rather than per-variable: new `lib/runtime-env.ts` (`setRuntimeEnv`/`getRuntimeEnv`, mirroring `lib/db/hyperdrive-bridge.ts`'s existing pattern for the identical platform constraint) plus `server/middleware/runtime-env.ts`, registered first in `server/src/app.ts`'s middleware stack, which bridges `c.env` into it on every request. All three affected reads (`auth.ts`'s cookie domain, `field-encryption.ts`'s key, `mock-adapter.ts`'s webhook secret) now go through `getRuntimeEnv()` instead of `process.env` directly, as does `parseCorsOrigins()`'s explicit-list support in `app.ts`/`csrf.ts` (not currently blocking anything live, since the `MUNHUB_ORIGIN_PATTERN` regex match doesn't depend on any env var, but it was the same latent bug). Local Node dev/tests are unaffected — `getRuntimeEnv()` falls back to real `process.env` there, since nothing calls `setRuntimeEnv()` outside a Workers request.

Verified after redeploying `munhub-api`: `Set-Cookie` now includes `Domain=.munhub.in`, and a cookie captured from a login against `app.munhub.in` was successfully reused for a session check made with `Origin: https://organize.munhub.in`.

**Lesson for future work in `/server`:** never read a custom (non-`NODE_ENV`) environment variable via `process.env.X` anywhere in `/server` or a `lib/` module it depends on — always use `getRuntimeEnv('X')`. A plain `process.env.X` read will work perfectly in local Node dev and in Vitest, pass every test, and then silently return `undefined` the moment it's actually deployed to a Worker. This is exactly the kind of bug that's invisible until you test the real deployed URL, not just `tsc`/tests/build.

## 5d. Intermittent 500s on every DB-backed endpoint — the module-level db client cache is invalid on Workers (found in production, 2026-09-17, third pass)

The user reported real, live intermittent 500s (roughly 50% failure rate) on `GET /api/v1/muns/:slug` and other DB-backed endpoints. `wrangler tail` showed the wrapped error message was uninformative ("Failed query: ..."); adding a temporary `console.error(requestId, 'cause:', error.cause)` in `server/middleware/error.ts` surfaced the real underlying error:

> Cannot perform I/O on behalf of a different request. I/O objects (such as streams, request/response bodies, and others) created in the context of one request handler cannot be accessed from a different request's handler.

**First attempted fix was wrong.** The initial hypothesis was Hyperdrive's known incompatibility with `postgres.js`'s default prepared statements, fixed by adding `{ prepare: false }`. That's a real, harmless thing to have (kept), but it did not fix this bug — a redeploy with only that change still failed ~50% of the time.

**Actual root cause:** `lib/db/client.ts` cached its `postgres()`/drizzle client at module scope (`let cachedDb`), correct and desired for a long-lived Node process, but wrong on Cloudflare Workers — Workers ties I/O objects (a Hyperdrive-backed socket included) to the specific request that created them. A Worker isolate is routinely reused across many different requests, and can even interleave genuinely concurrent ones; either way, a client built during request A and then reused during request B throws exactly the error above. This is why local dev, every test, and even the deploy's own validation step all looked fine — the bug only manifests under real, reused/concurrent Workers traffic.

**Fix:** `lib/db/hyperdrive-bridge.ts` rebuilt around `node:async_hooks`' `AsyncLocalStorage` instead of a plain module-level variable — `runWithHyperdriveConnectionString(connectionString, fn)` scopes a store (connection string + a lazily-built db instance) to exactly the current request's async call graph. `server/middleware/hyperdrive.ts` now runs the rest of the middleware/handler chain (`next()`) *inside* that scope rather than just calling a setter before it. `lib/db/client.ts`'s `getDb()` builds a fresh client once per request (cached in the ALS store for that request only, via `getCachedHyperdriveDb`/`setCachedHyperdriveDb`) when a Hyperdrive connection string is present, and keeps the original process-lifetime cache for local Node dev/tests (which never enter the ALS scope at all). Verified against production: 50/50 sequential requests and 20/20 concurrent (`&`-backgrounded) requests to the previously-flaky endpoint all returned 200.

**Lesson:** never cache a Workers I/O-backed resource (a DB client, an Hyperdrive-backed socket, or similar) at plain module scope — it must be scoped to the current request, via `AsyncLocalStorage` or equivalent. A working deploy, clean `tsc`, and a full green test suite prove nothing about this specific failure mode, since it only shows up under real traffic patterns (isolate reuse, concurrency) that local dev and Vitest never exercise.

## 6. CORS fix

`parseCorsOrigins()` (`server/src/app.ts`) is currently an exact-string allowlist. Extend the `cors()` `origin` option to a function: keep exact-match support for local dev URLs (`CORS_ORIGINS` env var, unchanged default), and in addition accept any origin matching `^https:\/\/([a-z0-9-]+\.)?munhub\.in$` — this covers apex, `www`, `app`, `organize`, `admin`, and any per-MUN slug origin, while still rejecting anything outside `munhub.in`. `api.munhub.in` itself never needs to be in its own CORS allowlist (it doesn't call itself cross-origin).

## 7. SPA host-awareness

New `web/src/lib/host-routing.ts`: reads `window.location.hostname`, returns a `zone`:

- `munhub.in` / `www.munhub.in` / anything not ending in `.munhub.in` (local dev) → `"marketplace"` (not reachable in production yet — apex/www still serve the live Vercel/Next app until the Phase 7 cutover; this branch matters today only for local dev, where every host falls through to it)
- `app.munhub.in` → `"student"`
- `organize.munhub.in` → `"organizer"`
- `admin.munhub.in` → `"admin"`
- any other `*.munhub.in` label → `"mun"`, with the label as `munSlug`

Wired into the root route: on `"student"`/`"organizer"`/`"admin"` zones, `/` redirects to that zone's dashboard default; on `"mun"`, render the existing `/mun/:slug` route with `slug = munSlug` (a route rewrite, not a new page — reuses everything `MunDetailPage` already does). On `"marketplace"` (including local dev), behavior is unchanged from today — path-based routing keeps working exactly as now, so this is purely additive and local dev needs no subdomain setup.

**Cross-zone links must be full navigations, not client-router `<Link>`s — if any ever exist.** Audited at implementation time: every internal `<Link>`/`navigate()` today uses a relative path within the one shared route tree, so none of them actually change origin — they just resolve on whatever host is currently loaded. There is no case today where a link intends to jump to a *different* subdomain (e.g. an explicit "switch to organizer view" action). If a future feature adds one, it must use a plain `<a href="https://organize.munhub.in/...">` (or `window.location.assign`), since React Router cannot navigate across origins — noted here so the next person adding such a link doesn't reach for `<Link>` by habit.

## 8. Known deploy risk: Postgres from a Cloudflare Worker

`/server` currently connects to Neon via the `postgres` npm package (postgres.js), which uses a raw TCP socket — this works fine under Node (`@hono/node-server`), but Cloudflare Workers don't support arbitrary raw TCP the same way; Workers-to-Postgres typically needs either **Cloudflare Hyperdrive** (a connection-pooling proxy binding, minimal code change — swap the connection string for the Hyperdrive binding's) or Neon's HTTP-based `@neondatabase/serverless` driver (a real code change to `lib/db/client.ts`). This is **not solved by this plan** — `munhub-api`'s `wrangler deploy` will very likely fail or hang on its first DB query until one of these is set up. Flagged here so Phase B's first deploy attempt isn't a surprise; picking Hyperdrive vs. the serverless driver is a decision for whoever runs that deploy, informed by how it goes.

## 9. Explicitly deferred (do not build now)

- Server-side 404 short-circuit for unknown/unpublished MUN slugs on the wildcard host (SEO nicety) — for now the SPA loads and shows its existing "not found" state client-side, same as path-based `/mun/:slug` does today.
- Per-organizer custom domains (bring-your-own-domain) — out of scope, not requested.
- Splitting the SPA into separate per-role bundles/deployments — rejected in §2, single build is sufficient and avoids duplicating the route tree.
