# Lane: load testing (local, diagnostic)

Session scope: set up local load testing against MUN Hub's real code and produce an honest
performance report. **Local only** — nothing in this lane touched `api.munhub.in`, `www.munhub.in`,
any `*.munhub.in` host, or the production Neon database. Every request in every scenario below went
to a server this session started itself (`localhost:3140`, later `localhost:3141` for one control
run), talking to local Docker Postgres (`mun-hub-db-1`) via `.env.test`.

## TL;DR

- **Registration capacity race (the safety-critical one): no oversell, no double-booking.** 20
  concurrent `POST /registrations` calls from 20 distinct authenticated users against a capacity-5
  product landed exactly 5 `CONFIRMED`/`PAYMENT_PENDING` registrations and 15 clean "at capacity"
  rejections — verified against the database directly, not just HTTP response codes. Repeated
  against a second product (capacity 3, same 20 callers) with the same result. The row-locking
  design described in `CLAUDE.md`'s "Registration integrity" section holds up under real concurrent
  HTTP load against the real API and a real Postgres transaction, not just the existing unit-level
  concurrency test.
- **One genuine performance bug found and fixed**: `GET /api/v1/muns` (marketplace search) ran two
  separate, identical, expensive JOIN queries per request — one for the page of rows, one just for
  the total count. Folded into one query using a `count(*) over ()` window column, with the original
  two-query path kept as a fallback for the one case the window trick can't answer (an empty page).
  Confirmed by re-running the same load scenario before and after: **+43% to +67% throughput,
  −17% to −41% p50 latency** across concurrency 10/50/100, zero regressions in the existing 35-test
  suite plus one new regression test for the fallback case.
- A second hypothesis (missing index on the searched text columns) turned out to be **wrong** —
  documented below because the investigation and the reason it didn't pan out are worth knowing for
  next time.
- Everything else (mixed load, cold-start latency, read-heavy browsing at various concurrency) came
  back clean: 0% errors across ~18,000 requests total outside the two intentional stress points
  above.
- This is one local Node process against one local Postgres container. It says nothing about
  Cloudflare Workers' request-scoped Hyperdrive/AsyncLocalStorage behavior, isolate reuse, or edge
  network latency — see "What this does not prove" at the end.

## Environment

- API: `server/src/index.ts` (Hono on `@hono/node-server`), started directly with `tsx`, **not**
  the shared dev server on `:3001`. Ports used: `3140` (primary), `3141` (one control run only,
  described below) — never `5174`/`3001`.
- DB: local Docker Postgres, `postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub`, loaded via
  `.env.test` (never `.env`, never `server/.dev.vars`). Already seeded (8 real/demo MUNs) plus a
  large amount of pre-existing accumulated test-run data from other sessions sharing this container
  — **30,529 `muns` rows and 73,033 `users` rows** at the start of this session (see "A dataset
  artifact worth knowing about" below for why this mattered).
- Startup command actually used:
  ```
  cd server && PORT=3140 CORS_ORIGINS=http://localhost:5240 ALLOW_LOCALHOST_ORIGINS=true \
    MOCK_PAYMENTS_ENABLED=true STORAGE_ADAPTER=local \
    RATE_LIMIT_GLOBAL_PER_MINUTE=100000 RATE_LIMIT_IP_MULTIPLIER=1000 \
    node --env-file=../.env.test --import tsx src/index.ts
  ```
  The two `RATE_LIMIT_*` overrides are the same values the existing E2E suite already uses
  (`E2E/playwright.config.ts`) to neutralize the per-IP rate limiter for automated traffic that all
  comes from one address — see "Rate limiting" below for why this was necessary and what happens
  without it.
- Tooling: `npx autocannon` (v8.0.0, resolved via npx's own cache — **not** added to any
  `package.json`) for scenario (a)'s raw HTTP throughput sampling. Scenarios (b)/(c)/(d) are plain
  Node scripts using global `fetch` and `Promise.all`/manual worker loops — no library needed for
  those, so none was added. `npx tsx` for anything that needed to import `lib/db/*` or `lib/auth/*`
  directly (fixture setup/cleanup, the DB ground-truth check in scenario b).
- All scripts live in `load-testing/` at the repo root (new directory).

## Rate limiting — a necessary, documented override

`server/middleware/rate-limit.ts`'s `RL_GLOBAL_IP` limiter caps every `/api/v1` request at 300/min
per source IP in its in-memory fallback (no Workers Rate Limiting binding available locally, so the
fallback is what actually runs). Every request in this session's load tests comes from one machine,
so without an override the very first concurrency level would exhaust the budget in about two
seconds and every subsequent request would be a 429, telling us nothing about the application layer.
`RATE_LIMIT_GLOBAL_PER_MINUTE` / `RATE_LIMIT_IP_MULTIPLIER` are exactly the two env vars this
codebase already documents for this situation (`server/lib/rate-limit-store.ts`'s own comments,
`.env.example`, `server/.dev.vars.example`) and the E2E suite already sets them the same way.

**To show this is a real, working limiter and not just noise, a short control run used the
*default* (un-overridden) limits** on a second instance (`:3141`, `RATE_LIMIT_GLOBAL_PER_MINUTE` and
`RATE_LIMIT_IP_MULTIPLIER` both unset): concurrency 10 against `GET /muns` immediately showed a
99.7% error rate (429s), and concurrency 50/100 showed 100% error rates, all with very low latency
(2–22ms, since a 429 is cheap to answer) and paradoxically *high* nominal throughput (4,200–4,700
"req/s", nearly all rejections). This is the rate limiter working exactly as designed — flagged here
so the very different numbers in the rest of this report aren't mistaken for "no rate limiting
exists"; it does, and it works, and it was deliberately raised for the rest of this session with
values that already have precedent elsewhere in this codebase.

## Scenario (a): read-heavy marketplace browsing

`load-testing/scenario-a-browse.mjs`. `npx autocannon` against `GET /api/v1/muns?query=<term>` and
`GET /api/v1/muns/bitsmun-hyderabad-25` (a real seeded, published MUN) at concurrency 10/50/100,
10s each.

### A dataset artifact worth knowing about

The first run used `query=mun` as the search term and found the list endpoint's throughput
**plateaued at ~125 req/s regardless of concurrency**, with p50 latency scaling almost linearly with
concurrency (79ms → 389ms → 770ms) — the textbook signature of every request queueing on a small,
saturated resource. Investigating with `EXPLAIN ANALYZE` directly against local Postgres initially
pointed at "missing index on the searched text columns," but a plain
`SELECT id FROM muns WHERE name ILIKE '%mun%'` showed Postgres choosing (correctly!) a sequential
scan over 30,533 rows — because **29,625 of them (97%) match `%mun%`** as a substring of their own
name. This local DB's accumulated test data is overwhelmingly named things like "Ops MUN 0324aa97" —
every synthetic test MUN's name contains "MUN" — so "mun" is a pathological, unrealistic search term
here: no index makes a predicate that matches 97% of a table faster, a full scan genuinely is the
right plan. Re-running with a more realistic, selective term (`query=hyderabad`, ~21% of rows) showed
the same plateau, confirming the search term wasn't the (whole) story — see the fix below.

### Before / after the fix (see "Performance bug found and fixed")

All numbers: `query=hyderabad` against the list endpoint, `GET /muns/bitsmun-hyderabad-25` for
detail. Raw JSON: `load-testing/results-scenario-a-before-index.json` (misleadingly named — see
below — this is actually the *before the query fix* run) and `results-scenario-a-after-fix.json`.

| Concurrency | List p50 (before → after) | List throughput (before → after) | Detail p50 (before → after) | Detail throughput (before → after) |
|---|---|---|---|---|
| 10  | 79ms → 53ms (−33%)   | 124.7 → 178.5 req/s (**+43%**) | 21ms → 19ms  | 452.7 → 493.3 req/s |
| 50  | 448ms → 266ms (−41%) | 109.6 → 182.8 req/s (**+67%**) | 99ms → 109ms | 477.5 → 451.8 req/s |
| 100 | 788ms → 652ms (−17%) | 120 → 150.2 req/s (**+25%**)   | 185ms → 197ms | 527.4 → 490 req/s |

Error rate was 0% at every concurrency level, before and after, for both endpoints. The detail
endpoint (single indexed lookup by slug) was never the bottleneck — its numbers move within normal
run-to-run noise, which is expected since the fix didn't touch it.

(Note on the file name: `results-scenario-a-before-index.json` was captured while a since-reverted
"add a trigram index" attempt was being evaluated, with the trigram indexes temporarily dropped again
to get a clean baseline — so its content is actually the pre-*query-fix* baseline, not a specifically
before/after-index comparison; the trigram-index idea itself was abandoned, see below. Renamed here
in prose but not on disk, to avoid a higher-risk last-minute file rename.)

The default-rate-limit control run described above is saved as
`load-testing/results-scenario-a-default-rate-limit-control.json` (same script, port `3141`, no
`RATE_LIMIT_*` overrides) — the 99.7–100% error rates and sub-25ms latencies in that file are 429s,
not a regression.

## Performance bug found and fixed: doubled query on every marketplace search

**File:** `lib/actions/marketplace.ts#searchMuns`.

### What was wrong

Every call ran two structurally-identical queries against `muns` LEFT JOIN (a per-mun min-price
subquery) LEFT JOIN `users`, with the same `WHERE` (status filter + up to 6-column `ILIKE` text
match) — one with `ORDER BY … LIMIT … OFFSET …` for the actual page of results, and a second,
separate one wrapping the whole thing in `SELECT count(*)`, purely to report `total` for pagination.
`EXPLAIN ANALYZE` against the reference dataset showed ~40ms for the rows query and ~26–39ms for the
count query — essentially paying the same JOIN + filter cost twice per HTTP request.

### The fix

Added `count(*) over ()::int` as an extra selected column on the *rows* query, and read `total`
directly off `rows[0].total` when the page has at least one row — Postgres computes a window
function's value using the full set of rows the query matches (before `LIMIT`/`OFFSET` are applied
in SQL's logical processing order), so this is the true total, not just the count of the returned
page. **The one thing a window column structurally cannot do is exist on zero rows** — an empty page
(the caller asked for an `offset` past the last match, or truly nothing matched) has no row to read
`total` off. The original separate `COUNT(*)` query was kept, but only runs in that one case now,
not on every request.

### Why the trigram-index idea, tried first, was abandoned

The first hypothesis was "missing index on the ILIKE-searched columns" (`muns.name/city/country/
theme`, `users.name/institution`), and a migration adding `pg_trgm` GIN indexes on all six was
written, applied locally, and verified via `EXPLAIN ANALYZE` to work — spectacularly, for a
**single-table** query (`WHERE muns.name ILIKE '%bitsmun%'` dropped from ~15ms sequential scan to
0.4ms index scan). But the actual `searchMuns` query's filter is one `OR` condition spanning columns
from **both** `muns` and `users`, evaluated *after* the hash join between them — Postgres cannot push
an OR-across-two-tables predicate down into a per-table index scan before the join, so with the
indexes in place the query plan was byte-for-byte the same (confirmed with `EXPLAIN ANALYZE` before
and after creating the indexes: same Hash Right Join, same post-join `Filter:`, same ~39ms). The
indexes would have been six new, permanently-maintained, essentially-unused indexes shipped for no
measurable benefit to the one query this session actually load-tested. **This migration was reverted
in full** (SQL file, journal entry, snapshot, the schema.ts comment referencing it, and the indexes
themselves dropped from local Docker Postgres) before writing this report — `git status` at the end
of this session shows no trace of it. The same cross-table-OR shape recurs in several admin/organizer
search queries elsewhere in this codebase (`lib/actions/admin-search.ts`, `admin-review.ts`,
`admin-staff.ts`, `organizer-admin.ts`, `support.ts`) — worth knowing if a future session considers
the same fix for one of those, since the same limitation likely applies; none of them were in this
session's load-tested scope, so none were touched.

### Verification

- `lib/actions/marketplace.test.ts`: existing 35 tests still pass (`npx vitest run
  lib/actions/marketplace.test.ts --no-file-parallelism`, against local Docker Postgres via
  `.env.test`). Added one new test, `'still returns the true total when the requested page itself is
  empty (offset past the last match)'`, specifically exercising the fallback-count path the fix
  introduces (offset 100 against 3 real matches → `total` must still read 3, not 0).
- Root `npx tsc --noEmit -p tsconfig.json` and `server`'s `npx tsc --noEmit -p tsconfig.json`: both
  clean.
- Scenario (a) re-run end-to-end before and after (see table above) confirms the improvement at the
  HTTP layer, not just in `EXPLAIN`.

## Scenario (b): registration capacity race — the critical one

`load-testing/scenario-b-registration-race.mjs`, backed by `load-testing/setup.ts`'s fixtures.
20 distinct, pre-authenticated STUDENT accounts (real `users` rows, real `student_profiles` rows —
registration requires a complete profile — real session tokens via `lib/auth/session.ts#createSession`,
same mechanism the app itself uses) each fired one real `POST /api/v1/registrations` **simultaneously**
(`Promise.all`) against one real registration product with capacity 5, price ₹500 (a paid pass, so
the real mock-payments/fee-computation path runs, not just the free-pass shortcut). Idempotency-Key
and Origin headers set correctly (CSRF requires a trusted Origin — `http://localhost:5240` is trusted
via `ALLOW_LOCALHOST_ORIGINS=true`).

**Result: exactly 5 registrations succeeded (`PAYMENT_PENDING`, seat held), exactly 15 were rejected
with "Registration product is at capacity" — verified two ways:**
- HTTP-level: 5× 2xx, 15× the capacity-rejection error, 0 unexpected failures.
- **Database ground truth, independent of what any HTTP response claimed**: queried `registrations`
  directly, counted rows in `ACTIVE_REGISTRATION_STATUSES` (`PENDING`/`PAYMENT_PENDING`/`CONFIRMED`/
  `ATTENDED`/`NO_SHOW` — the same set `lib/actions/registration.ts` itself uses for capacity
  counting) for the product: **5, matching capacity exactly.** No oversell. Checked that the 5 active
  rows belonged to 5 distinct users: no double-booking either.

**Repeated once more** against a second, separate product on the same MUN (capacity 3, ₹300, same 20
callers — a single caller is only allowed one active registration per *product*, not per MUN, so the
same 20 identities could race a second product cleanly): **exactly 3 succeeded, 12 correctly
rejected as "at capacity," and 5 got a `409 CONFLICT_STATE` "This request key was already used for a
different registration."** That last one is a test-harness artifact, not an app bug: the script
initially built each caller's `Idempotency-Key` from an index and user id only, which collided
between the two separate script invocations (same 20 users, same loop order, same derived key,
different product) — the app's own idempotency-replay logic correctly refused to silently reattribute
an existing key to a different registration (`toReplay` in `lib/actions/registration.ts`) rather than
doing anything unsafe. Fixed in the script (the key now includes which fixture set it belongs to)
for future runs; the DB ground truth for this run was still exactly 3 active registrations, capacity
3, no oversell — the collision only ever produced *extra rejections*, never an incorrect grant.

**Wall time for all 20 simultaneous requests: 88–215ms** (both runs) — the row lock on the
registration product serializes the 20 callers through the capacity check, but they still all
resolve well under a quarter-second on this one local machine.

This directly exercises the mechanism `CLAUDE.md`'s "Registration integrity" section describes (the
`.for('update')` row lock on the registration product inside the transaction, the per-user
already-active-registration check under the same lock) via the real HTTP API end to end — not just
the existing unit-level concurrency regression test (`lib/actions/registration.test.ts`, 10 callers
vs capacity 3, calling `initiateRegistration` directly). No bug found; the mechanism holds under real
concurrent load. Raw results: `load-testing/results-scenario-b.json`,
`load-testing/results-scenario-b-race2.json`.

## Scenario (c): mixed realistic load, 65s sustained

`load-testing/scenario-c-mixed.mjs`. 30 concurrent workers, each looping for 65s, picking randomly
per iteration: 70% marketplace list search, 15% MUN detail page, 10% authenticated dashboard read
(`GET /api/v1/me/registrations/upcoming`), 5% a registration attempt (one distinct pre-authenticated
user per attempt, against a separate high-capacity free product, capped at the 110 identities set
aside for this scenario so the pool never runs out mid-run — once exhausted it falls back to another
list read rather than generating meaningless "already registered" noise).

**Result: 12,285 total requests over 65.1s, 188.8 req/s average throughput, 0 errors (0.000%).**

| Action | Count | Error rate | p50 | p95 | p99 |
|---|---|---|---|---|---|
| list (search)     | 8,535 | 0% | 129ms | 220ms | 338ms |
| detail             | 1,875 | 0% | 219ms | 353ms | 581ms |
| dashboard (auth)   | 1,243 | 0% | 145ms | 236ms | 397ms |
| register (write)   |   632 | 0% | 141ms | 595ms | 711ms |

(632 "register" actions against a 110-user reserved pool: 110 real registration attempts, the other
522 fell back to a list read once the pool was exhausted, as designed — not an error.) Raw results:
`load-testing/results-scenario-c.json`. This run happened *after* the marketplace query fix above, so
its list/detail numbers already reflect the improved query.

## Scenario (d): cold-start-ish single-request latency baseline

`load-testing/scenario-d-coldstart.mjs`. Five sequential (never concurrent) single requests per
endpoint type, against the same warmed-up local server used for the other scenarios.

| Endpoint type | Samples (ms) | Average |
|---|---|---|
| Public list (`GET /muns`, no filter) | 75.9, 36.8, 32.0, 32.1, 31.9 | 41.7ms |
| Public detail (`GET /muns/:slug`) | 7.3, 6.2, 5.8, 5.9, 6.3 | 6.3ms |
| Authenticated read (`GET /me/registrations/upcoming`) | 5.5, 5.2, 5.0, 5.0, 5.0 | 5.1ms |
| Authenticated write (`POST /registrations`, distinct user each time) | 20.6, 18.4, 18.9, 18.2, 18.7 | 19.0ms |

The public-list endpoint's first sample (75.9ms vs ~32ms for the rest) is the closest thing to a
"cold start" this setup can show — most plausibly the first real query on a freshly-created
Postgres connection in this Node process's pool. Raw results: `load-testing/results-scenario-d.json`.

## What this does not prove (read this before trusting these numbers for a deploy decision)

This is **one local Node process talking to one local Docker Postgres container on one machine**.
Per `CLAUDE.md`'s own deploy-config section, production is Cloudflare Workers with:
- **Request-scoped `AsyncLocalStorage`-based Hyperdrive/DB-client lifecycle**
  (`lib/db/hyperdrive-bridge.ts`, `server/middleware/hyperdrive.ts`) — a real bug in this exact area
  ("Cannot perform I/O on behalf of a different request", caused by module-scope caching of a
  Workers I/O resource) was previously invisible to `tsc`, the full test suite, and even a successful
  `wrangler deploy`, and only appeared under real Workers isolate-reuse/concurrency patterns. Nothing
  in this session's local load testing can exercise that failure mode at all — a clean run here is
  not evidence it's still fixed under real Workers traffic, only that the application/DB logic itself
  is sound.
- **Workers Rate Limiting bindings** instead of the in-memory fallback this session deliberately
  overrode — the real production limiter is a different code path (`consumeRateLimit`'s `binding`
  branch in `server/lib/rate-limit-store.ts`), untested here.
- **Real network latency, Cloudflare's edge, and Hyperdrive's own connection pooling to Neon** — none
  of which a `localhost` round-trip on one machine can represent. Every latency number in this report
  should be read as "cost of the application/DB logic on this machine," not "what a real user would
  see."
- **Neon**, not local Docker Postgres — a materially different Postgres (managed, likely different
  hardware, different network hop, possibly different `max_connections`/pooling behavior via
  Hyperdrive). The query-plan analysis (`EXPLAIN ANALYZE`) in this report is specific to local
  Docker's ~30k/~73k row dataset and its statistics; Neon's production data volume and distribution
  are different and could change which queries are actually the hot path.

None of this is a reason to distrust the two concrete findings above (the registration race holds;
the marketplace double-query was real and the fix measurably helped) — both were verified against
real code paths with real transactions. It's a reason not to read "0% errors, plateaus around
Xreq/s" as a production capacity number.

## Cleanup performed

- Both local servers (`:3140`, `:3141`) stopped.
- `load-testing/cleanup.ts` run: removed the 2 test MUNs, 141 test users (1 organizer + 140
  students), and 123 test registrations this session created, by exact id — verified with direct
  `psql` queries before and after that nothing matching the `LOADTEST_2026_09_17` tag remained, and
  that no other rows in local Docker Postgres were touched.
- The trigram-index migration attempt (file, journal entry, snapshot, schema.ts comment, and the
  indexes themselves in local Docker Postgres) was fully reverted — see "Why the trigram-index idea
  … was abandoned" above.
- `node_modules` junctions (root, `web/`, `server/`) pointing at the shared main checkout were
  removed after this report was written.

## Files

- `load-testing/setup.ts` — creates the race/mixed test MUNs, products, and 140 pre-authenticated
  student fixtures; writes `fixtures.json` (gitignored-equivalent — deleted by cleanup, not
  committed).
- `load-testing/cleanup.ts` — deletes exactly what `setup.ts` created, plus a belt-and-braces
  tag-match sweep.
- `load-testing/scenario-a-browse.mjs`, `scenario-b-registration-race.mjs`,
  `scenario-c-mixed.mjs`, `scenario-d-coldstart.mjs` — the four scenario scripts.
- `load-testing/results-scenario-*.json` — raw output from the runs described above, committed for
  reference.
- `lib/actions/marketplace.ts` — the `searchMuns` fix.
- `lib/actions/marketplace.test.ts` — new regression test for the fix's fallback path.
