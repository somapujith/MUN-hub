# Lane devops: CI, scheduler, environments, docs, cleanup

Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-9`, fast-forwarded to `main` at `73bcdf4` before starting (the worktree was created at `3a4cc9e`, before `docs/autonomous-run/` existed).

## What changed

| Commit | Change |
|---|---|
| `c432751` | Root `tsconfig.json` without the Next.js leftovers (`next` plugin, `next-env.d.ts`, `.next/types`). It now covers `lib/`, `server/integration/` (which no tsconfig checked before) and the root configs, and excludes `.claude/` so worktrees aren't swept in. New root scripts: `typecheck`, `typecheck:root`, `typecheck:e2e`, `lint`, `lint:shared`, `check`, `test:ci`, `db:migrate:local`, `db:seed:local`. `scripts/with-local-db.mjs` forces `DATABASE_URL` to Docker. Deleted root `public/*.svg` (create-next-app assets) and root `postcss.config.mjs`. |
| `3df0268` | Deleted `web/src/mocks/*` (only imported each other) and `web/src/pages/account-page.tsx` (not routed or imported). |
| `cde406a` | `server/lib/report-error.ts`: a structured `console.error` line, plus a Sentry envelope over `fetch` when `SENTRY_DSN` is set. It never throws. `reportRequestError(c, …)` uses `waitUntil` on Workers. |
| `ecc06ad` | `server/src/worker.ts` exports `{ fetch, scheduled }`. `server/src/scheduled.ts` bridges the env and runs the jobs inside the Hyperdrive ALS scope, exactly like the fetch middlewares. `lib/jobs/{types,registry,release-expired-holds}.ts`: a sequential runner with per-job try/catch, structured logs and `onError` → `reportError`; the run throws at the end if any job failed. |
| `bdd1ea0` | `server/wrangler.jsonc`: `triggers.crons ["*/5 * * * *"]`, an explicit `api.munhub.in/*` route, `env.staging` (workers.dev, `routes: []`, own vars, placeholder Hyperdrive id). `web/wrangler.jsonc`: `publish.munhub.in` Custom Domain, `env.staging`. |
| `608cbad` | `.github/workflows/ci.yml` (web, server, test with postgres:16, nightly/manual e2e) and `deploy.yml` (manual, `production` environment, migrate → api → web → smoke test). |
| `6a5332f` | README, server/README, web/README rewrites. `docs/operations/RUNBOOK.md`, `docs/operations/ENVIRONMENTS.md`. `.env.example` and a new `server/.dev.vars.example`. |

## Decisions

- **The expired-hold sweep is re-implemented in `lib/jobs/release-expired-holds.ts`, not imported.** `lib/actions/registration.ts` only exports `releaseExpiredReservations(productId)`, which is per product; the per-MUN and multi-product variants are private. The job runs the same `UPDATE` (PENDING/PAYMENT_PENDING with `expires_at < now` → CANCELLED) without the product filter. `registration.ts` was not touched (payments lane). If the payments lane changes release semantics (e.g. also expiring the payment row), mirror that here at merge.
- **Scheduled runs use one Hyperdrive scope per invocation, like one request.** Jobs run sequentially inside it. The client isn't explicitly `end()`ed, same as the fetch path, because a fire-and-forget query started by a job could otherwise be cut off.
- **A run with any failed job throws after all jobs have run.** Cloudflare doesn't retry crons; the throw only makes the failure visible in Cron Events.
- **Cron every 5 minutes.** Holds last 15 minutes, so a seat comes back at most about 5 minutes late.
- **Staging is workers.dev only**, as asked. Consequence, documented in ENVIRONMENTS.md: the SPA and API are cross-site there (workers.dev is a public suffix), so the `SameSite=Lax` session cookie doesn't flow and browser sign-in doesn't work on staging. API smoke tests and cron runs do. Staging vars assume the account subdomain `somapujith.workers.dev` (taken from CLAUDE.md).
- **Production deploys pass `--env=""`.** With `env.staging` defined, a bare `wrangler deploy` warns and is ambiguous.
- **Deploy workflow**: `main` only, `production` environment (approval), concurrency group without cancellation, migrations first (must be additive), versions tagged with the short sha, `SENTRY_RELEASE` passed with `--var`. Wrangler comes from the lockfile via `npx`, not `wrangler-action`.
- **CI unit tests** set `DATABASE_URL` explicitly for the postgres service. `vitest.setup.ts`'s dotenv load never overrides it, and the value equals `.env.test`'s anyway.
- **E2E in CI** writes `server/.env` from the committed, mock-only `.env.test` plus `MOCK_PAYMENTS_ENABLED="true"`, because the Playwright config starts the API with `tsx --env-file=.env`. It uses Playwright's Chromium (`E2E_BROWSER_CHANNEL=chromium`).
- **Actions** pinned to major versions: `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v4`. Node 22 (wrangler 4.133 needs ≥ 22).
- **Lint for lib/server/E2E** uses web's oxlint binary (`node web/node_modules/oxlint/bin/oxlint lib server E2E`) with default rules. There are no dependency changes. It currently reports 13 warnings and 0 errors, all in other people's files.
- `server/lib/boot-guard.ts` was left alone. It only runs in the Node entry with `NODE_ENV=production`; the README describes it accurately now instead of as a guard against passwordless auth.
- The root `.env.example` now uses `APP_URL=http://localhost:5174` (the Vite dev server) instead of the Next-era `:3000`, and adds `CORS_ORIGINS` with `:5174`, since the API's default allowlist doesn't include the web dev port. `STORAGE_ADAPTER` was dropped: nothing reads it.

## Verification

- Root `tsc -p tsconfig.json` (now including `server/integration`), `tsc -p E2E/tsconfig.json`, `server` `tsc -p tsconfig.json`, web `tsc -p tsconfig.app.json` and `tsconfig.node.json`: all clean. Web was checked with `-p`, not `-b`, so no tsbuildinfo was written into the shared `node_modules` junction.
- `npx oxlint` (web): exit 0. `npm run lint:shared`: exit 0, no findings in new files.
- `npx vitest run lib/jobs server/src server/lib --no-file-parallelism`: 6 files, 40 tests passed.
- `wrangler deploy --dry-run` for munhub-api (`--env=""` and `--env staging`, plus the exact `--var/--tag/--message` flags from deploy.yml) and munhub-web (after `vite build`): no config warnings, and the bundle contains the scheduled handler.
- **Real Workers runtime:** `wrangler dev --test-scheduled` on :3109 with Hyperdrive's local connection string pointed at Docker. Created an expired PAYMENT_PENDING hold, then `GET /__scheduled` → `scheduled_job.succeeded`, `released: 339` (historical expired holds in the local DB), and the fixture row became CANCELLED. Then 5 cron triggers interleaved with 5 concurrent `GET /api/v1/muns` requests: all 200, 6 successful runs, no "Cannot perform I/O on behalf of a different request".
- `npm run db:migrate:local`: no-op against the already-migrated local DB. The wrapper refuses a non-local `LOCAL_DATABASE_URL`.
- Workflow YAML parsed with js-yaml, and job/step structure checked by script. Not run on GitHub yet.

## Deploy-time actions (for the lead / user)

1. GitHub → Settings → Environments → create `production` with required reviewers, deployment branch `main`, and secrets `DATABASE_URL` (Neon production, direct URL), `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, Zone Workers Routes edit, Zone DNS edit), `CLOUDFLARE_ACCOUNT_ID`.
2. Before the first deploy with this config: delete any hand-made `publish` DNS record in the munhub.in zone, or the new `publish.munhub.in` Custom Domain fails to attach. The `*.munhub.in` wildcard record stays.
3. The first deploy adds the cron trigger and the `api.munhub.in/*` route to munhub-api. Check Cron Events afterwards.
4. Optional: `wrangler secret put SENTRY_DSN --env=""` (and set `SENTRY_ENVIRONMENT`).
5. Staging (optional): Neon `staging` branch, `wrangler hyperdrive create munhub-db-staging`, replace the placeholder id in `server/wrangler.jsonc`, then set staging secrets (ENVIRONMENTS.md).

## Follow-ups

- **Register the other lanes' jobs** in `lib/jobs/registry.ts` → `SCHEDULED_JOBS` at merge:
  ```ts
  // privacy lane: lib/jobs/purge-auth-artifacts.ts. Import its ScheduledJob, or
  // wrap its function as { name: 'purgeExpiredAuthArtifacts', run: async ({ now }) => <counts> }.
  // A job's result must be a flat object of counts (no PII).
  // lifecycle lane: needs SYSTEM_ACTOR_USER_ID on munhub-api (a dedicated staff user)
  {
    name: 'runScheduledLifecycleTransitions',
    async run({ now }) {
      const actorId = getRuntimeEnv('SYSTEM_ACTOR_USER_ID')
      if (!actorId) throw new Error('SYSTEM_ACTOR_USER_ID is not set')
      const r = await runScheduledLifecycleTransitions(now, actorId)
      return { opened: r.opened.length, closed: r.closed.length, started: r.started.length, skipped: r.skipped.length }
    },
  }
  // notifications lane: its SLA_DELAY job
  ```
  Put `releaseExpiredHolds` before the lifecycle job, so seats are freed before registration closes.
- **Wire report-error into the 500 path** (server/middleware/error.ts, owned by another session), inside `if (mapped.status === 500) { ... }`:
  `reportRequestError(c, error, { requestId })` (import from `../lib/report-error`).
- **Reconcile env docs at merge**: RUNBOOK.md, `.env.example` and `server/.dev.vars.example` list the other lanes' vars (PAYMENTS_ADAPTER, MOCK_PAYMENTS_ENABLED, PLATFORM_FEE_BPS, PLATFORM_FEE_TAX_BPS, PAYMENT_FIELD_KEY_PREVIOUS, ALLOW_LOCALHOST_ORIGINS, COOKIE_SECURE, TURNSTILE_SECRET_KEY, RATE_LIMIT_IP_MULTIPLIER, SYSTEM_ACTOR_USER_ID, CHECKIN_CODE_SECRET) from a read-only look at their worktrees. Confirm them with `grep -rn "getRuntimeEnv(" lib server`. Any new bindings (an uploads KV namespace was seen in another lane's config, and rate-limit bindings) must also be added under `env.staging` in `server/wrangler.jsonc`, because bindings aren't inherited.
- **Expected merge conflicts**: `server/wrangler.jsonc` (sec-edge and at least one other lane edit vars/bindings; keep this lane's `routes`, `triggers` and `env` blocks and copy any new vars/bindings into `env.staging`), `server/README.md` (sec-edge), `.env.example`.
- **Production `CORS_ORIGINS` still lists localhost origins** (`server/wrangler.jsonc` vars). Left for the sec-edge lane, which owns the allowlist.
- **PAYMENT_FIELD_KEY re-encryption script** doesn't exist. Until it does, `PAYMENT_FIELD_KEY_PREVIOUS` must stay set after a rotation (RUNBOOK.md).
- **The CI unit-test job hasn't run on GitHub yet.** CLAUDE.md notes a flaky `registration-form.test.ts` ordering test, which may need a retry or a fix.
- Root `package.json` still lists `eslint` (unused, no config) and `dotenv`/`drizzle-kit` etc. Removing `eslint` is a dependency change, so it's left for the user.
- `lib/auth/mock-adapter.ts` looked unused but belongs to the auth lane. Not touched.
- `server/lib/boot-guard.ts` guards only the Node production entry. With real auth it could be removed or re-purposed (e.g. refuse `MOCK_PAYMENTS_ENABLED` in production).
- Consider same-site staging hostnames (`staging.munhub.in` + `staging-api.munhub.in`, with explicit routes to beat the wildcard) if browser testing on staging is needed.
- The shared scratchpad directory is common to all lanes of this workflow, and generic file names collided once (`wrangler-dev.log`). Use lane-prefixed names there.
