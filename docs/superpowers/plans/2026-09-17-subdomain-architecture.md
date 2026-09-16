# Subdomain Architecture — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md`

## Phase A — code changes (this session executes)

1. **Reserved slug words.** Find the MUN slug validation/uniqueness path (organizer application + mun-config slug field) and reject `www`, `app`, `organize`, `admin`, `api` (case-insensitive) at creation/update time.
2. **Cookie domain.** Add `COOKIE_DOMAIN` env var; thread it through `setSessionCookie()` and the sign-out `deleteCookie()` call in `server/routes/auth.ts` (spec §5). Add `COOKIE_DOMAIN` to `.dev.vars.example`/`server/.env` docs, unset by default (host-only cookie, today's behavior) so local dev is unaffected.
3. **CORS.** Replace the exact-list-only check in `parseCorsOrigins()`/`server/src/app.ts`'s `cors()` call with exact-list-for-dev + `^https:\/\/([a-z0-9-]+\.)?munhub\.in$` pattern match for prod (spec §6).
4. **Hono Workers entrypoint.** Add `server/src/worker.ts` (`export default app`). Add `server/wrangler.jsonc` (name `munhub-api`, Custom Domain `api.munhub.in`, env bindings mirroring `server/.env`/`.dev.vars.example`).
5. **Web Workers config.** Add `web/wrangler.jsonc` (name `munhub-web`, Workers Static Assets pointed at `web/dist`, `not_found_handling: "single-page-application"`, Custom Domains for `app.munhub.in`/`organize.munhub.in`/`admin.munhub.in` only, wildcard Route `*.munhub.in/*`). **Do not** configure `munhub.in`/`www.munhub.in` here — those are live on Vercel today (discovered mid-implementation, spec §2) and their cutover is a separate Phase 7 step, not part of this change.
6. **SPA host-awareness.** Add `web/src/lib/host-routing.ts` (spec §7) and wire it into the root route/layout: zone-based default-landing redirect for `student`/`organizer`/`admin`, and slug rewrite for the `mun` zone reusing the existing `/mun/:slug` route. No change to `marketplace`-zone (including local dev) behavior.
7. **Root package/deploy scripts.** Add `cf:deploy`/`cf:preview`-equivalent scripts to `web/package.json` and `server/package.json` (mirroring the existing root `cf:deploy` pattern for the legacy Next app) so both new Workers have a documented deploy command. Do not touch the existing root scripts (still legacy Next app, Phase 7 territory).
8. **CLAUDE.md.** Replace the "Routing: path-based `/mun/[slug]` — wildcard subdomains deferred" line with a short pointer to this spec/plan and the new domain layout, since this reverses that locked decision (CLAUDE.md instructs updating it whenever architecture/scope changes).
9. ~~Cross-zone link audit~~ — **checked, no action needed.** Every internal `<Link>`/`navigate()` in `web/src/` uses a relative path within the one shared route tree (e.g. `/organizer/apply`, `/dashboard`), so clicking them never changes origin — they resolve on whichever host is currently loaded, same as before this change. There is currently no link that intends to jump to a *different* subdomain (e.g. an explicit "switch to organizer view" action), so there is nothing to convert to a full `<a>`/`window.location` navigation yet. That conversion only becomes necessary if a future feature adds a real cross-subdomain jump — not required for this rollout.

Tests: existing Vitest suite must stay green (`.env.test`-isolated per CLAUDE.md's test/dev DB isolation note — do not touch that file). Add unit coverage for: the CORS origin-matcher function, the reserved-slug-word rejection, and `host-routing.ts`'s zone/slug resolution (pure function, easy to unit test with mocked `hostname` strings).

## Phase B — user-executed (outside this session's reach)

0. **Before deploying `munhub-api`:** set up Cloudflare Hyperdrive (or switch `lib/db/client.ts` to `@neondatabase/serverless`) for Postgres access from a Worker — see spec §8. The Node-only `postgres` package's raw TCP connection is expected not to work as-is inside a Worker.
1. In the Cloudflare dashboard for the `munhub.in` zone: add the wildcard DNS record (`*` → proxied) if not already present from the Custom Domains flow, since Workers Routes need the record to exist even though the Worker (not the record's target) serves the traffic.
2. Run `wrangler deploy` for `munhub-web` and `munhub-api` (commands added in Phase A step 7) — needs a Cloudflare API token pasted directly into whichever session runs the deploy (per CLAUDE.md: never relay secrets between sessions).
3. Set `COOKIE_DOMAIN=.munhub.in` and production `CORS_ORIGINS`/`DATABASE_URL`/etc. as Workers secrets for `munhub-api` (`wrangler secret put ...`), and confirm `NODE_ENV=production` is set so `secure` cookies and the boot guard (`server/lib/boot-guard.ts`'s `assertProductionAuthConfigured`) both engage correctly in prod.
4. Smoke-test each host post-deploy (see Verification below).

## Verification

- `npm test` (Vitest, `.env.test`-isolated) green; `tsc --noEmit` clean.
- Local dev smoke test: confirm `localhost:5173`/`5174` marketplace/student/organizer/admin routes all still work unchanged (host-routing zone resolution no-ops on non-`.munhub.in` hosts).
- Unit tests for the three new pure-logic pieces called out in Phase A's test note.
- Post-deploy (Phase B), manually verify: `munhub.in`/`www.munhub.in` are **unaffected** (still the existing live Vercel/Next app — do not expect these to change); `app.munhub.in/` lands on student dashboard when logged in; `organize.munhub.in/` lands on organizer dashboard; `admin.munhub.in/` lands on admin console; a real MUN slug on `<slug>.munhub.in` renders that MUN's page; logging in on `app.munhub.in` and then loading `organize.munhub.in` shows the same session (cookie domain fix working) and signing out on either clears it on both (delete-cookie domain fix working); a request from `https://oxford.munhub.in` to `api.munhub.in` succeeds (CORS pattern match working) while an origin outside `munhub.in` is rejected.

## Note: unrelated live production issue found during this work

While implementing this, a peer session reported the user is seeing a live React RSC error (#441) on the current Vercel deployment of `munhub.in`. That is unrelated to this subdomain work (which only adds new hosts) and is not addressed by this plan — flag separately if it needs fixing.
