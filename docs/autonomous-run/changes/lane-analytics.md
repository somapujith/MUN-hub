# lane-analytics — admin reporting suite

Task: expand the admin analytics from basic counts into a real reporting suite. Not a lane on the original `PLAN.md` lane table — run as a standalone follow-up task in an isolated worktree, additive only (new files + small additive edits to shared files: `lib/db/schema.ts`, `server/routes/admin.ts`, `web/src/routes.tsx`, `web/src/lib/admin/nav-config.ts`, `web/src/lib/admin/query-keys.ts`).

## What changed

### Backend — `lib/actions/admin-reporting.ts` (new)

Eight staff-only (`OPERATIONS`/`ADMIN`/`SUPER_ADMIN`, via `requireRole`) functions, each a single grouped SQL query (two for the two leaderboard/top-N pairs), reusing `countedPaymentsFilter()` (mock-payment exclusion) and `organizerNetAmountSql`/`REVENUE_REGISTRATION_STATUSES` from `mun-analytics.ts` rather than reimplementing either:

- `getRegistrationTrend` / `getRevenueTrend` (gross + net-of-fee) / `getSignupTrend` (organizer + delegate split) — grouped by `date_trunc('day'|'week', column, 'UTC')`, zero-filled in JS so a bucket with no rows still renders as 0 instead of a gap. **Found and fixed a real bug while writing the unit tests**: reusing the same `sql` bucket-expression object in both `.select()` and `.groupBy()` makes drizzle re-parameterize it independently, so Postgres sees `date_trunc($1, ...)` in the SELECT list and `date_trunc($4, ...)` in GROUP BY as two different expressions and refuses the query ("column must appear in the GROUP BY clause") even though both bind the same value. Fixed by grouping on ordinal position (`GROUP BY 1` / `GROUP BY 1, 2`) instead of repeating the expression — documented inline so nobody reintroduces it.
- `getConversionFunnel` — registrations funnel (started = every registration created in the range, since every one defaults to `PENDING`; confirmed = `CONFIRMED`/`ATTENDED`/`NO_SHOW`; cancelled = `CANCELLED`) and payments funnel (PAID vs FAILED attempts, exception rate = payments with `exceptionRaisedAt` set over total), two `count(*) filter (where ...)` single-row queries, no `GROUP BY` needed.
- `getTopConferences` — top 10 by registration count and top 10 by revenue, independently ranked, scoped to the range.
- `getOrganizerLeaderboard` — top 10 by conferences **ever published** (lifetime — `PUBLISHED`/`REGISTRATION_OPEN`/`REGISTRATION_CLOSED`/`CONFERENCE_ACTIVE`/`UNPUBLISHED`/`RESULTS_PENDING`/`RESULTS_UNDER_REVIEW`/`COMPLETED`/`ARCHIVED`, not range-scoped by design) and top 10 by revenue generated in the range.
- `getGeographyBreakdown` — registrations and revenue by `muns.city`/`country`, one query with the revenue side as a LEFT JOIN whose ON clause carries the "counts as revenue" conditions (PAID, revenue-eligible status, non-mock), so a non-revenue registration contributes 0 rather than being dropped.
- `getPlatformFeeSummary` — `payments.platformFeeAmount`/`platformFeeTaxAmount` summed per currency, PAID + non-mock only; verified this reads real data now that `PLATFORM_FEE_BPS=500` is live (`7f1a076`).

### Routes — `server/routes/admin-reporting.ts` (new), mounted from `server/routes/admin.ts`

`GET /admin/reporting/{trends,funnel,top-conferences,organizers,geography,fees}`, all `requireAuth` + `requireRole(['OPERATIONS','ADMIN','SUPER_ADMIN'])`, zod-validated `days` (7/30/90, `.strict()`) and `granularity` (`day`/`week` on `/trends` only). `/trends` batches the three trend queries (Promise.all) into one response since they share params and render together.

### Migration `0036_admin_reporting_indexes.sql`

Checked existing indexes first (`registrations.mun_id+status`, `payments.status`, none on `createdAt` anywhere relevant). Added three, applied to local Docker only via `npm run db:migrate:local` (never touched `.env`/Neon):

- `registrations_created_at_idx` on `registrations(created_at)`
- `payments_status_created_at_idx` on `payments(status, created_at)`
- `users_role_created_at_idx` on `users(role, created_at)` — also speeds up the pre-existing `admin-analytics.ts` "new organizers this week" query, which filtered the same two columns with no index before this.

### Frontend — new "Analytics" section

- `web/src/pages/admin/reporting-page.tsx` (new page, route `/admin/reporting`, nav entry "Analytics" right after Overview in `nav-config.ts`) — doesn't touch the existing Overview page or its counts.
- `web/src/components/admin/reporting-charts.tsx` (new) — hand-built SVG/CSS chart primitives, since no chart library exists in `web/node_modules` and the task said not to add one:
  - `TrendLineChart`: multi-series line chart, one axis, 2px lines, a 3-line recessive grid, colors from the app's own `--chart-1`..`--chart-5` design tokens (already defined in `web/src/index.css` for both themes, previously unused anywhere) in fixed categorical order. Ships a hover/focus layer per-bucket (every bucket is a focusable, `aria-label`led hit target) with a below-chart detail readout panel — a deliberate simplification of a cursor-following tooltip, which would need real DOM-coordinate math against the SVG's independently-scaling `viewBox`.
  - `RankedBarList`: a ranked, horizontal-bar list (CSS width, not SVG) for top conferences / organizer leaderboard — dataviz's "table" alternative to a bar chart without a new dependency.
  - `FunnelStage`: a stat tile with a proportional bar underneath, relative to the funnel's first stage.
  - Literal `stroke-chart-N`/`bg-chart-N` class-string lookup tables (not template-interpolated class names) so Tailwind's static scanner sees every class.
- `web/src/api/admin-reporting.ts` + `web/src/types/admin-reporting.ts` (new, mirror the six backend response shapes) + six new keys on `adminQueryKeys` — one `useQuery` per endpoint, independent loading/error states per section, a shared `days`/`granularity` selector (`SegmentedControl`, plain buttons — matches existing pagination-button patterns elsewhere in the admin console, not the heavier base-ui `Tabs` primitive).
- Works at mobile width: every grid collapses to one column, tables scroll horizontally, the SVG charts scale via `viewBox`.
- Existing Overview page (`overview-page.tsx`) and its `getAdminAnalytics`/`getAdminOverviewStats` are untouched — the new page is additive, per the brief.

## Tests

- `lib/actions/admin-reporting.test.ts` — 12 tests: zero-fill + range-boundary correctness for each trend, mock-payment exclusion (toggles `PAYMENTS_ADAPTER` so `countedPaymentsFilter()` actively excludes the default `mock_razorpay` provider, then restores it), funnel math including a zero-rows/zero-division case, top-conferences ranking (date-range-scoped, so naturally isolated from the shared dev DB's other data via a far-future `now`), geography revenue-eligibility, platform fee currency grouping, staff-only authorization. The one metric that is *not* naturally isolated by a far-future `now` — `byConferencesPublished` is lifetime, not range-scoped — reads the current #1 first and creates one more than that, so the assertion is deterministic regardless of what the shared, never-cleaned local dev DB already has (documented inline; this DB has been used continuously by every lane in this run).
- `server/integration/admin-reporting.integration.test.ts` — 20 tests: all six routes are staff-only (403 delegate, 401 anonymous, 200 for all three staff roles), zod rejects out-of-enum `days`/`granularity` with 400, and one shape check per endpoint. The top-conferences route test was rewritten mid-task (see Verification below) to a pure shape check rather than creating data, since ranking correctness is already covered by the unit tests.

## Verification

- `npx tsc --noEmit -p tsconfig.json` (root): clean.
- `cd server && npx tsc --noEmit -p tsconfig.json`: clean.
- `cd web && npx tsc -b --noEmit`: clean. `npx oxlint` on every changed/new web path: clean.
- `cd web && npx vite build`: succeeds (pre-existing >500kB chunk-size warning, unrelated).
- Targeted vitest (`--no-file-parallelism --exclude ".claude/**"`): `admin-reporting.test.ts` (12), `admin-reporting.integration.test.ts` (20), plus a regression pass of `admin-analytics.test.ts` (4) and `admin-console.integration.test.ts` (12) — 48/48 passing.
- Browser check (Playwright, Chromium via system Chrome since the sandbox has no network access to download Playwright's own browser binary — see gotcha below): own ports (API `3099`, web `5199`, via a local `server/.env` copied from `.env.example` with generated dev-only `PAYMENT_FIELD_KEY`/`TOTP_FIELD_KEY`, `PLATFORM_FEE_BPS=500`; deleted before finishing). Signed in as `admin@munhub.test` / `munhub-demo` against local Docker. Confirmed: all six `/admin/reporting/*` requests return 200; the page renders every section (trends with working hover readout and legend, both funnels, both top-10 lists, geography table, platform fee tiles) at desktop (1440px, all three ranges + both granularities) and mobile (390px, single-column, no horizontal page scroll). One thing that looked like a bug and wasn't: 7d/30d/90d showed identical numbers everywhere — traced to the shared local dev DB's oldest real-dated row being from 2026-09-15 (this run started 2026-09-17), so literally 100% of its real-time data already falls inside the smallest window; confirmed via a direct SQL check, not a query-logic bug.
- **Found and fixed a self-inflating test-data bug during the browser check**: the integration test's original top-conferences test used the same "out-rank the current #1" determinism technique as the unit test, but at the route layer, with no cleanup — every future full-suite run would create one more permanent junk conference than the last run found, visibly polluting the real admin console (`Reporting API Mun ...` reached rank #1 with 500+ fake registrations after only two local runs). Rewrote it to a shape-only check (ranking correctness doesn't need re-proving at the integration layer) and deleted the three junk conferences + 1,008 junk registrations it had already left in local Docker.

## Gotchas for whoever reads this next

- Playwright's own browser binaries could not be downloaded (`cdn.playwright.dev` timed out from this sandbox, with and without `dangerouslyDisableSandbox`). Worked around by launching system Chrome directly (`executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`) — worth remembering if a future session needs a real browser here and `npx playwright install` won't complete.
- A lifetime (not date-range-scoped) leaderboard query against this shared, never-cleaned local dev DB cannot use a fixed expected count in a test — read the current top value first and exceed it by one, the same pattern `admin-analytics.test.ts`'s "new organizers" test uses via a far-future `now` for date-scoped cases; there's no far-future equivalent for a query that ignores dates entirely.
