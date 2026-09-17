# lane sec-edge — edge security and data exposure

Lane: Security B (edge). Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-3`, fast-forwarded to `main` at `73bcdf4` before starting (the worktree had been created 12 commits behind main).

## What changed

### 1. CORS and CSRF use one explicit origin allowlist (`4aa2f9c`, `fe83922`)

- New `server/lib/origins.ts` is used by both the new `server/middleware/cors.ts` and `server/middleware/csrf.ts`.
  - **Trusted** (credentialed CORS, passes CSRF): `https://munhub.in`, `www.`, `app.`, `publish.`, `organize.` and `admin.munhub.in`, plus exact extra origins from `CORS_ORIGINS` (legacy `ALLOWED_ORIGINS` still works).
  - **Localhost** (`http://localhost:<port>`, `http://127.0.0.1:<port>`): trusted only when `ALLOW_LOCALHOST_ORIGINS=true`. There is no localhost default any more.
  - **Per-MUN slug hosts** (`https://<label>.munhub.in`): non-credentialed CORS on GET/HEAD only, including GET preflights. They get no CORS for writes and fail CSRF.
  - Anything else gets no CORS headers, plus `Vary: Origin`.
- The CSRF Referer fallback now uses `new URL(referer).origin`. It used to strip the last path segment with a regex.
- `server/wrangler.jsonc`: production `CORS_ORIGINS` is now `""` (it used to hold three localhost origins). `.env.test` and `.env.example` gained `ALLOW_LOCALHOST_ORIGINS="true"`.
- Before this change the live API gave `https://oxford.munhub.in` `Access-Control-Allow-Credentials: true` (checked with curl).
- Web side (needed because slug hosts no longer get credentialed CORS):
  - `apiCredentialsMode()` in `web/src/lib/host-routing.ts` returns `"omit"` on a slug host. `web/src/api/marketplace.ts` uses it.
  - `useSession` resolves to signed-out on a slug host without calling the API.
  - `canonicalUrlFor` sends every slug-host path except `/` (register, login, browse) to the host that owns it. Without that, the SPA would try to sign in from a host the API doesn't trust.

### 2. API security headers, body limit, JSON 404 (`4aa2f9c`)

- `server/middleware/security-headers.ts` uses `hono/secure-headers` and sits ahead of CORS, so errors, 404s and preflights get the headers too. It sends:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-site`, instead of hono's default `same-origin`. CORP only applies to no-cors loads, and the web hosts are same-site with the API.
  - Hono's other defaults: `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, and so on.
- `server/middleware/body-limit.ts` uses `hono/body-limit`:
  - 1 MB by default.
  - 30 MB for `POST /api/v1/muns/:munId/documents` and `POST /api/v1/muns/:munId/media` (base64 uploads).
  - Over the limit it returns a JSON 413: `{ error: { code: 'PAYLOAD_TOO_LARGE', … } }`.
  - It runs before session, rate-limit and the validators.
- `app.notFound` now returns `{ error: { code: 'NOT_FOUND', message: 'Not found' } }`. Hono's default was a plain-text 404, which was also live in production. `error.ts` was not touched.
- The API host now serves `GET /robots.txt`, which allows only the sitemap.

### 3. Web app headers (`1c688cf`)

- `web/public/_headers` covers the Cloudflare Workers Static Assets site, `munhub-web`.
- `web/vercel.json` covers the Vercel project. It also carries the SPA rewrite and the `/sitemap.xml` redirect.
- Both files send the CSP from the lane brief, plus HSTS, nosniff, Referrer-Policy, Permissions-Policy and `X-Frame-Options: DENY`.
- No script hash or nonce is needed:
  - The build emits no inline scripts.
  - next-themes' anti-flash script is already rendered as an inert `type="application/json"` block (`web/src/components/theme-provider.tsx`), and a CSP never evaluates those.
- `style-src 'unsafe-inline'` is needed for:
  - the `<style>` block in `index.html`,
  - the `<style>` next-themes injects for `disableTransitionOnChange`,
  - style attributes.

### 4. Published-or-owner guards on by-id reads (`b411b4b`)

- New `lib/actions/mun-read-access.ts` (`resolveMunReadAccess` / `assertMunReadable`) returns one of:
  - `owner`: the owning organizer, ADMIN or SUPER_ADMIN. This is the same set `assertOwnsOrAdmin` allows.
  - `staff`: OPERATIONS reviewers, for any status. They need to read unpublished content for Gate 2.
  - `public`: anyone, but only when the status is in `PUBLIC_DETAIL_STATUSES`. That constant is now exported from `marketplace.ts`; nothing else in that file changed.
  - `none`: everyone else. Routes answer **404, not 403**, so an unpublished MUN's existence isn't confirmed either.
- The guard covers these routes: `GET /muns/:munId/{contact,documents,committees,schedule,media,accommodation,executive-board,form-fields,products}`, `GET /committees/:id/portfolios` and `GET /accommodation/:id/fields`.
  - Products by id was added to the lane list: it is the same leak, and it's the route the public slug route falls through to.
- Contact:
  - Callers with `public` access get `getPublicMunContact`, which selects columns explicitly: official email, phone, website and social links.
  - `contactPerson*` fields go only to the owner and staff.
- `includeInactive` (archived accommodation options and products) now requires `owner` access. It used to call `assertOwnsOrAdmin` and swallow the error.
- `GET /muns/:munId/form-fields` no longer writes:
  - `listFormFields` is now a pure read. For any `DEFAULT_REGISTRATION_FIELDS` key the MUN has no stored row for, it returns a synthetic, read-only field with id `default:<fieldKey>`. The public funnel, including `getMunBySlug`, therefore still shows the default questions.
  - The rows are written only by the new `listFormFieldsForOrganizer` (owner or admin), which the route uses for `owner` access and `reorderFormFields` returns.
  - This behaves exactly as before, where a deleted default was re-seeded on the next list anyway.
  - It also fixes the long-standing "flaky" `listFormFields` ordering test. That test failed every time, because the list call itself inserted 8 rows.

### 5. Sitemap and robots (`ce2ca39`)

- `server/routes/sitemap.ts` used to read `process.env.NEXT_PUBLIC_APP_URL` at module load. That is always undefined on Workers, so production URLs pointed at `http://localhost:3000`.
  - It now reads `getRuntimeEnv('APP_URL')` on each request, defaulting to `https://www.munhub.in`.
  - It lists `/`, `/muns`, `/about`, `/about/curation`, `/contact`, `/legal`, `/legal/{terms,privacy,refunds}` and every `/mun/:slug` from `listPublicMunSlugs`.
  - Responses carry `Cache-Control: public, max-age=3600`.
- The real route is `/api/v1/sitemap.xml`. `robots.txt` (also under `/api/v1`) now references the absolute sitemap URL, taken from the request.
- `web/public/robots.txt`:
  - allows everything except `/admin`, `/organizer`, `/dashboard`, `/register` and `/profile`,
  - lists `Sitemap: https://api.munhub.in/api/v1/sitemap.xml` (sitemap cross-submission through robots.txt).
- `web/public/_redirects` and `vercel.json` send `/sitemap.xml` to the API sitemap with a 302. Without that, the SPA fallback answered `/sitemap.xml` with `index.html`.

### 6. Unknown API routes

Before this lane they were a plain-text `404 Not Found`, with no stack trace but not JSON. They now return JSON (see 2). Checked for `/api/v1/*`, `/api/v2/*`, `/webhooks/*`, `/` paths and unknown methods on known paths.

## Decisions

- **Localhost trust:** allows any port when the flag is on, because dev, E2E and lane servers use many ports. The flag is dev/test only; the wrangler var comment says so.
- **Slug hosts:** read-only landing pages. Registering or signing in always happens on a trusted host.
- **COOP on the web hosts:** left out. The brief listed it for the API only, and `same-origin` would break popup-based payment methods once a gateway is integrated.
- **Staff read access:** limited to OPERATIONS, and read-only. OPERATIONS never triggers the form-field write, matching `assertOwnsOrAdmin`'s existing scope.
- **Id format:** no UUID check on ids. They are `text` columns, so a malformed id simply matches nothing and returns 404.
- **Placement of access checks:** the lib list functions stay access-agnostic, and the route layer applies the check. This matches the existing `resolveIncludeInactive` pattern and avoids rippling session parameters through about 600 lib tests.

## Verification

- `server`: `npx tsc --noEmit -p tsconfig.json` is clean.
- `web`: `npx tsc -b --noEmit` is clean. `npx oxlint` on the changed web files is clean.
- Vitest (`--no-file-parallelism`, local Docker), all passing:
  - New and changed suites: `server/src/app.test.ts`, `server/integration/edge-security.integration.test.ts`, `server/integration/public-mun-reads.integration.test.ts`, `lib/actions/mun-read-access.test.ts`, `lib/actions/mun-contact.test.ts`, `lib/actions/registration-form.test.ts`. 94 tests.
  - Neighbouring suites: `mun-config.integration`, `error-taxonomy`, `registration-eligibility.integration`, `go-live.integration`, `module-verification-read.integration`, `marketplace`, `accommodation`, `executive-board`. 59 tests.
- Browser check:
  - Setup:
    - production `vite build`, served by `wrangler dev` on :5203 so `_headers` and `_redirects` were applied as on Cloudflare,
    - API on :3103,
    - Chrome driven by Playwright.
  - Results:
    - 16 document loads (public pages, login/signup, signed-in dashboard and profile, dark mode) showed no CSP violations and no console errors. The only change to the CSP was adding `http://localhost:3103` to `connect-src`.
    - `/robots.txt` was served as text.
    - `/sitemap.xml` returned 302 to the API.
    - SPA deep links carried the headers.
    - `_headers` itself is not exposed.
  - Simulated slug host (`oxford-mun-2027.munhub.in` mapped to localhost, anonymous CORS header injected):
    - The MUN page rendered with `credentials: "omit"` requests. They succeeded without `Access-Control-Allow-Credentials`, which is only possible for non-credentialed fetches.
    - No session call was made.
    - `/login` handed off to `https://munhub.in/login`.

## Env vars and bindings at deploy

- `munhub-api`:
  - `CORS_ORIGINS` is `""` in `server/wrangler.jsonc`. Add only exact extra origins, such as a preview host.
  - **Never set `ALLOW_LOCALHOST_ORIGINS`** on a deployed Worker.
  - No new secrets.
- `munhub-api` `APP_URL`: the sitemap now uses it. The wrangler value is `https://munhub.in`, which 308-redirects to `www` on Vercel, so sitemap URLs would all be redirects. Recommend `https://www.munhub.in` (see follow-ups).
- `munhub-web`: a redeploy ships `dist/_headers`, `dist/_redirects` and `dist/robots.txt`. No config change is needed.
- Vercel: `web/vercel.json` takes effect on the next Vercel build, if the project root is `web/`.
- Observation (unverified): `www.munhub.in` responds exactly like the `munhub-web` Worker — same bundle hash as `app.`, and no `x-vercel-id`, while the apex has one. The `*.munhub.in/*` Worker route probably serves `www`, and Vercel only 308s the apex. If so, `_headers` is what protects `www`.

## Follow-ups

1. **Tests lane (E2E):** five organizer specs read the ONBOARDING sandbox MUN anonymously and expect 200. Those reads now return 404 by design:
   - `E2E/specs/organizer/branding.spec.ts:64` (media)
   - `conference-day.spec.ts:94` (schedule)
   - `documents.spec.ts:113` (documents)
   - `executive-board.spec.ts:88,101` (public board)
   - `settings.spec.ts:101` (contact)

   Read them as the owner, or assert 404 for anonymous callers and check the public view on a published fixture. The E2E API server needs no new env: `playwright.config.ts` already sets `CORS_ORIGINS=WEB_URL`, and fixtures send `Origin: WEB_URL`. `ALLOW_LOCALHOST_ORIGINS: 'true'` is optional.
2. **Error taxonomy owner:** add `'PAYLOAD_TOO_LARGE'` (413) to `ErrorCode` in `server/middleware/error.ts`. The body-limit middleware emits it directly.
3. **Marketplace lane:**
   - `RESULTS_PENDING` and `RESULTS_UNDER_REVIEW` are not in `PUBLIC_DETAIL_STATUSES`. The public page and every by-id read disappear between CONFERENCE_ACTIVE and COMPLETED.
   - `listPublicMunSlugs` (sitemap) uses the narrower `DEFAULT_PUBLIC_STATUSES`, so CONFERENCE_ACTIVE, COMPLETED and ARCHIVED pages are not in the sitemap.
   - The `status` query parameter on `GET /muns` still accepts internal statuses.
   - Slug hosts now redirect every non-root path to the marketplace host.
4. **Payments:** when the real gateway lands, add its script, frame and connect origins (for example `checkout.razorpay.com` and `api.razorpay.com`) to the CSP in both `web/public/_headers` and `web/vercel.json`.
5. **Vercel project root is uncertain.** CLAUDE.md says the project was "repointed to /web", so `vercel.json` lives in `web/`. If the root is the repo root, move the file.
6. **Devops / notifications:** consider `APP_URL=https://www.munhub.in` in `server/wrangler.jsonc`, since the apex 308s to `www`.
7. **HSTS preload:** not added. Consider it once every subdomain is confirmed HTTPS-only.
8. **Minor:** public document listings still include `storageKey`.
9. **Other unauthenticated reads not in this lane:** `/products/availability`, and the certificates and results routes. Their owning lanes should review them.
10. **Local dev:** `server/.env` is untracked and belongs to the user. Its `CORS_ORIGINS` covers :5174, so the shared dev server keeps working. A web dev server on any other port needs `ALLOW_LOCALHOST_ORIGINS=true` or an explicit `CORS_ORIGINS` entry.
