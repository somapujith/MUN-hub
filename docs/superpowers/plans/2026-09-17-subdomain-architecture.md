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

## Phase B — done for `munhub-web`, pending for `munhub-api`

Completed 2026-09-17, with a Cloudflare API token pasted directly into this session (per CLAUDE.md: never relay secrets between sessions):

1. ~~Add `munhub.in` as a Cloudflare zone~~ — **done.** Was on BigRock nameservers; switched to `marty.ns.cloudflare.com`/`sima.ns.cloudflare.com`, zone active, all SSL certs (per-Custom-Domain + Universal `*.munhub.in`) issued.
2. ~~Deploy `munhub-web`~~ — **done.** `app.`/`organize.`/`admin.munhub.in` live as Custom Domains, `*.munhub.in/*` live as a Workers Route.
3. ~~Wildcard DNS record~~ — **done, and this was the one surprise:** a Workers Route does NOT auto-create its DNS record the way a Custom Domain does. Had to manually add a proxied `AAAA * 100::` record before `<slug>.munhub.in` would resolve at all — recorded in the spec (§3) so the next person doesn't hit the same dead end.
4. Verified live: `app.munhub.in`, `organize.munhub.in`, `admin.munhub.in`, and a wildcard slug (`oxford.munhub.in`) all return HTTP 200 serving the SPA shell over HTTPS. `munhub.in`/`www.munhub.in` DNS untouched, still on Vercel.

**`munhub-api`: also done, 2026-09-17.**

1. ~~Hyperdrive~~ — **done**, a peer session already ran `wrangler hyperdrive create munhub-db` against the real Neon instance and filled the id into `server/wrangler.jsonc` before this session got to it.
2. ~~Secrets~~ — **done.** `PAYMENT_FIELD_KEY` and `MOCK_PAYMENT_WEBHOOK_SECRET` set via `wrangler secret put` (values sourced from `server/.dev.vars`, gitignored). `COOKIE_DOMAIN`/`CORS_ORIGINS` are plain `vars` in `server/wrangler.jsonc` (not secret). `DATABASE_URL` is NOT set as a Workers secret — Hyperdrive's binding supplies the connection string per-request; `DATABASE_URL` only matters for local Node dev.
3. **One real bug found and fixed during this deploy:** `lib/crypto/field-encryption.ts` loaded its encryption key eagerly at module top-level (`const encryptionKey = loadKey()`, by original deliberate design — "fail immediately on boot"). On Cloudflare Workers, module-scope code runs at cold start before any request/`env`/secret exists, so this always saw the key as unset and failed Wrangler's deploy-time validation (error 10021) even with the secret correctly uploaded. Fixed by making it a lazy, memoized singleton (`getEncryptionKey()`) — same fail-loud-once behavior, just deferred to first actual use instead of import time, mirroring the exact pattern `lib/db/client.ts`'s Hyperdrive bridge already used for the same class of problem. Tests + `tsc --noEmit` still clean after the change. **If any other `lib/` module reads `process.env.X` at pure module-top-level with no lazy wrapper, it will hit this same failure the moment it's imported into `/server`'s dependency graph** — this file was the only real offender found by grepping for the pattern, but worth remembering if a future deploy throws the same error 10021 shape.
4. Deployed and verified: `api.munhub.in` returns real seeded MUN data from Neon via Hyperdrive (`GET /api/v1/muns` → 200 with live rows). **Correction (found by a peer session, not just propagation lag as first assumed):** `api.munhub.in`'s Custom Domain was genuinely being shadowed by `munhub-web`'s `*.munhub.in/*` wildcard Workers Route — Custom Domains do not unconditionally win over a zone-level wildcard Route for the same hostname. Fixed by adding an explicit `api.munhub.in/*` → `munhub-api` Workers Route (more specific than the wildcard, so it wins) alongside the Custom Domain. Both now show correctly in the zone's Workers Routes list. If a future subdomain needs its own Custom Domain, add the matching explicit Route too, or it may intermittently or permanently get served by the wildcard's Worker instead.

## Verification

- `npm test` (Vitest, `.env.test`-isolated) green; `tsc --noEmit` clean.
- Local dev smoke test: confirm `localhost:5173`/`5174` marketplace/student/organizer/admin routes all still work unchanged (host-routing zone resolution no-ops on non-`.munhub.in` hosts).
- Unit tests for the three new pure-logic pieces called out in Phase A's test note.
- Post-deploy (Phase B), manually verify: `munhub.in`/`www.munhub.in` are **unaffected** (still the existing live Vercel/Next app — do not expect these to change); `app.munhub.in/` lands on student dashboard when logged in; `organize.munhub.in/` lands on organizer dashboard; `admin.munhub.in/` lands on admin console; a real MUN slug on `<slug>.munhub.in` renders that MUN's page; logging in on `app.munhub.in` and then loading `organize.munhub.in` shows the same session (cookie domain fix working) and signing out on either clears it on both (delete-cookie domain fix working); a request from `https://oxford.munhub.in` to `api.munhub.in` succeeds (CORS pattern match working) while an origin outside `munhub.in` is rejected.

## Note: unrelated live production issue found during this work

While implementing this, a peer session reported the user is seeing a live React RSC error (#441) on the current Vercel deployment of `munhub.in`. That is unrelated to this subdomain work (which only adds new hosts) and is not addressed by this plan — flag separately if it needs fixing.
