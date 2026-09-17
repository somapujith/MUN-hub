# Production runbook

How MUN Hub is deployed, configured, backed up and watched, and what to do when something breaks. For the environments themselves (local, staging, production) and how to keep them apart, see [ENVIRONMENTS.md](./ENVIRONMENTS.md).

## What runs where

| Piece | Where | Config |
|---|---|---|
| API | Cloudflare Worker `munhub-api`: Custom Domain `api.munhub.in` plus the route `api.munhub.in/*` | `server/wrangler.jsonc` |
| Web app | Cloudflare Worker `munhub-web` (static assets, SPA fallback): `app.`, `publish.`, `organize.`, `admin.munhub.in` and the `*.munhub.in/*` route for per-MUN pages | `web/wrangler.jsonc` |
| Marketing hosts | Vercel project `mun-hub`, built from `web/`: `munhub.in`, `www.munhub.in` | Vercel dashboard (deploys on push via Vercel's Git integration) |
| Database | Neon Postgres (production branch), reached from the Worker through Hyperdrive config `munhub-db` | `server/wrangler.jsonc` → `hyperdrive` |
| Background jobs | Cron trigger on `munhub-api`, every 5 minutes → `lib/jobs/registry.ts` | `server/wrangler.jsonc` → `triggers` |
| DNS | Cloudflare zone `munhub.in`; `*.munhub.in` needs a proxied placeholder record for the wildcard route | Cloudflare dashboard |

Things that surprised people before:

- **Workers never put custom vars or secrets into `process.env`.** Code in `server/` and the `lib/` modules it imports must read them with `getRuntimeEnv('NAME')` (`lib/runtime-env.ts`). A `process.env.NAME` read passes tsc and every test, then returns `undefined` in production.
- **Never cache a database client (or any I/O object) at module scope.** Workers ties I/O to the request that created it. `lib/db/client.ts` builds one client per request (and per cron run) inside an AsyncLocalStorage scope.
- **A Custom Domain doesn't beat a wildcard Workers Route.** `api.munhub.in` needs its explicit `api.munhub.in/*` route or `munhub-web`'s `*.munhub.in/*` route intermittently answers instead.
- **A Workers Route creates no DNS record.** The wildcard only resolves because of a manually created `*.munhub.in` DNS record.
- **Custom Domains and Workers Routes need separate API token permissions.** Without "Zone → Workers Routes → Edit" a deploy fails with a generic `Authentication error [code: 10000]`.
- **Adding a Custom Domain fails if the hostname already has a DNS record you created by hand.** For example, before `publish.munhub.in` becomes a Custom Domain, delete any manual `publish` record (the wildcard record can stay).
- **`wrangler deploy` deletes vars that aren't in `wrangler.jsonc`.** Set plain vars in the file and secrets with `wrangler secret put`. Never set vars in the dashboard.

## Deploying

Only deploy a commit on `main` that has passed CI (`.github/workflows/ci.yml`). The order is always migrations → API → web. Migrations therefore have to be **additive**: the API version that's still running must keep working against the migrated schema. Drop or rename things in a later release, after nothing uses them.

### From GitHub Actions (preferred)

1. Actions → **Deploy (production)** → *Run workflow* on `main`. Untick the steps you don't need (migrations, API, web).
2. A reviewer approves the `production` environment.
3. The workflow typechecks, applies migrations to Neon, runs `wrangler deploy` for `munhub-api` and `munhub-web` (each version tagged with the short commit sha), and checks `https://api.munhub.in/api/v1/health`.

One-time setup (repo **Settings → Environments → `production`**):

- Required reviewers: at least one person other than the one who triggers the deploy, where possible.
- Deployment branches: `main` only.
- Secrets:
  - `DATABASE_URL`: the Neon production branch's **direct** (non-pooled) connection string, `?sslmode=require`
  - `CLOUDFLARE_API_TOKEN`: an API token with *Account → Workers Scripts → Edit*, *Zone (munhub.in) → Workers Routes → Edit*, and *Zone → DNS → Edit* (Custom Domains create DNS records). Add *Account → Hyperdrive → Edit* only if the workflow ever needs to manage Hyperdrive.
  - `CLOUDFLARE_ACCOUNT_ID`

Worker secrets (`PAYMENT_FIELD_KEY`, …) are **not** set by the workflow. They live on the Worker and survive deploys (see [Configuration](#configuration-per-worker)).

### From a clean worktree (fallback)

Use this when Actions is unavailable. Never deploy from a working tree with uncommitted or unreviewed changes.

```bash
git fetch origin
git worktree add ../munhub-deploy origin/main      # or the verified sha
cd ../munhub-deploy
npm ci && npm --prefix server ci && npm --prefix web ci
npm run typecheck

# 1. Migrations (production Neon, direct URL). Type it in; don't copy .env around.
DATABASE_URL='<neon production direct URL>' npx tsx lib/db/migrate.ts

# 2. API
cd server && npx wrangler deploy --env="" --tag "$(git rev-parse --short HEAD)"

# 3. Web (the API URL is compiled into the bundle)
cd ../web && VITE_API_URL=https://api.munhub.in/api/v1 npx vite build
npx wrangler deploy --env="" --tag "$(git rev-parse --short HEAD)"

curl -fsS https://api.munhub.in/api/v1/health
cd .. && git worktree remove ../munhub-deploy
```

`--env=""` selects the top-level (production) config explicitly. Without it wrangler warns, because `env.staging` exists too.

### After a deploy

- `curl https://api.munhub.in/api/v1/health` returns `{"ok":true,...}`.
- Open `https://app.munhub.in`, `https://publish.munhub.in` and `https://admin.munhub.in` and sign in on one of them. The session must carry over to the others, which means the cookie has `Domain=.munhub.in`.
- Workers → `munhub-api` → Logs: no new `error` lines. Cron Events: the next run succeeds.

### Rolling back a Worker

```bash
cd server   # or web
npx wrangler deployments list --env=""
npx wrangler rollback <version-id> --env="" --message "rollback: <reason>"
```

A rollback doesn't undo migrations. That's one more reason they have to be additive: the previous Worker version must still run against the new schema.

## Database (Neon)

### Migrations

- Files live in `drizzle/` (generated with `npm run db:generate`), applied in order by `lib/db/migrate.ts`, which records them in `drizzle.__drizzle_migrations`.
- Locally: `npm run db:migrate:local` (always the Docker database).
- Production: the deploy workflow, or the fallback above.
- Before a production migration, read the SQL. `ADD COLUMN ... NOT NULL` without a default, `DROP`, `RENAME`, and enum value removals are not additive. Postgres < 15 can't use a new enum value in the same transaction that adds it, which is why the repo splits those into separate migrations.
- Large backfills belong in a separate, resumable script, not in a migration.
- Take a restore point first (below) when a migration rewrites data.

### Backups and restore

Neon keeps history for its **point-in-time restore window** (the length depends on the Neon plan; check Project settings → Storage → History retention, and keep it at least 7 days for production).

- **Before risky work**, create a branch from production (Neon console → Branches → Create branch, parent `production`, "Current point in time"). The branch is your restore point and costs little until it diverges.
- **To inspect the past** without touching production: create a branch "from a point in time" just before the incident and query it with its own connection string.
- **To restore production**, use Neon's *Restore* on the production branch to a timestamp (Neon keeps a backup branch of the pre-restore state). Every write after that timestamp is lost, so prefer copying the specific rows back from a point-in-time branch when the damage is narrow.
- If you restore by switching to a different branch instead, point Hyperdrive at it with `cd server && npx wrangler hyperdrive update d3d1e91bf3474e2988f7524362979a8e --connection-string="<new branch URL>"`. The binding id doesn't change, so nothing needs redeploying.
- For an off-platform copy, run `pg_dump --format=custom "<direct URL>" > munhub-$(date +%F).dump` from a trusted machine and store it encrypted. The dump contains delegates' personal data.

## Configuration per worker

Plain vars go in `wrangler.jsonc` (`vars`, and again under `env.staging.vars`, since vars are never inherited). Secrets are set once per Worker and environment:

```bash
cd server
npx wrangler secret put PAYMENT_FIELD_KEY --env=""          # production
npx wrangler secret put PAYMENT_FIELD_KEY --env staging     # staging
npx wrangler secret list --env=""
```

### `munhub-api`

| Name | Kind | Required | Purpose |
|---|---|---|---|
| `HYPERDRIVE` | binding | yes | Database connection (`lib/db/hyperdrive-bridge.ts`). The Worker doesn't use `DATABASE_URL`. |
| `APP_URL` | var | yes | Public site URL used in emails and links |
| `COOKIE_DOMAIN` | var | yes (prod) | `.munhub.in`, so the session is shared across `app.`/`publish.`/`admin.`. Empty on staging (host-only cookie). |
| `CORS_ORIGINS` | var | staging | Extra trusted browser origins, comma-separated, exact match (`ALLOWED_ORIGINS` is an older alias). The production web hosts are built in (`server/lib/origins.ts`), so production sets it empty. |
| `ALLOW_LOCALHOST_ORIGINS` | var | no | `true` trusts any `http://localhost:<port>`. Local development only; never set it on a deployed Worker. |
| `PUBLIC_API_URL` | var | yes (prod) | Origin used in uploaded-file URLs (`https://api.munhub.in`). Unset: the request origin is used. |
| `UPLOADS_KV`, `UPLOADS_BUCKET` | binding | for real uploads | Upload storage (`lib/storage/select-adapter.ts`). Both are commented out in `wrangler.jsonc` until the KV namespace / R2 bucket exists; without either, uploads are refused with 503 (no row is written) and each attempt logs an error. |
| `ZEPTOMAIL_FROM_ADDRESS` | var | with email | Sender address on a domain verified in ZeptoMail |
| `ZEPTOMAIL_TOKEN` | secret | for real email | ZeptoMail Send Mail token. Unset: emails (including sign-in codes and reset links) are only written to the log. |
| `PAYMENT_FIELD_KEY` | secret | yes | AES-256-GCM key for payout details, base64 of 32 bytes. No default, and the code refuses to run without it. |
| `MOCK_PAYMENT_WEBHOOK_SECRET` | secret | mock payments only | HMAC secret for the mock payment webhook |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | var | no | Per-IP cap for routes without a dedicated limit (default 300) |
| `TRUST_PROXY_HEADERS` | var | no | `true` only behind a trusted proxy. The Worker uses `CF-Connecting-IP`. |
| `SENTRY_DSN` | secret | recommended | Enables Sentry delivery in `server/lib/report-error.ts` |
| `SENTRY_ENVIRONMENT` | var | no | Defaults to `production`; set `staging` on staging |
| `SENTRY_RELEASE` | var | no | Set per deploy by the deploy workflow (`--var`) |
| `PAYMENT_FIELD_KEY_PREVIOUS` | secret | rotation only | Decrypt-only previous key during a rotation (below) |
| `PAYMENTS_ADAPTER` | var | no | Payment provider (default `mock`; see `docs/payments/INTEGRATION.md`) |
| `MOCK_PAYMENTS_ENABLED` | var | never in prod | Must be exactly `true` for the mock checkout. Unset in production: paid passes answer 503 PAYMENTS_UNAVAILABLE, free passes still work. |
| `PLATFORM_FEE_BPS`, `PLATFORM_FEE_TAX_BPS` | var | no | Platform fee (default 0) and GST on it (default 1800), in basis points. A malformed value fails checkout. |
| `COOKIE_SECURE` | var | yes (prod) | `true` in `wrangler.jsonc`. Unset: Secure except on plain-http localhost. |
| `TURNSTILE_SECRET_KEY` | secret | no | Cloudflare Turnstile check on delegate signup and organizer sign-in code requests. Set it only together with the web build's `VITE_TURNSTILE_SITE_KEY`, or every such request is rejected. |
| `RATE_LIMIT_IP_MULTIPLIER` | var | no | Scales per-IP limits in the in-memory fallback only (local/E2E); never affects the Workers bindings |
| `RL_*` (18) | binding | yes | Workers Rate Limiting bindings (`ratelimits` in `wrangler.jsonc`, namespace ids 1001-1018). A missing binding falls back to an in-memory counter per isolate. |
| `SYSTEM_ACTOR_USER_ID` | var | for the lifecycle job | `users.id` of a dedicated staff account, recorded as the actor of scheduled open/close/start moves. Unset: that job logs `scheduled_job.skipped` and does nothing. |
| `CHECKIN_CODE_SECRET` | secret | recommended | Signs conference check-in codes (at least 32 characters). Unset: derived from `PAYMENT_FIELD_KEY`. Don't change it once passes are issued. |
| `REQUIRE_EMAIL_VERIFICATION` | var | no | `true` blocks registration (403) until the account email is verified |

### `munhub-web`

No runtime vars. The API base URL is compiled in at build time: `VITE_API_URL`, which defaults to `https://api.munhub.in/api/v1` for production builds (`web/vite.config.ts`). The Vercel project needs the same `VITE_API_URL` in its environment settings. `VITE_TURNSTILE_SITE_KEY` (optional, build time) turns on the Turnstile widget on signup and organizer sign-in; set it only together with the API's `TURNSTILE_SECRET_KEY`.

## Scheduled jobs

`munhub-api` runs `lib/jobs/registry.ts` every 5 minutes (`triggers.crons` in `server/wrangler.jsonc`). Each run sets up the runtime env and a fresh per-run database scope, then runs the jobs one after another. A failing job is logged (`event: scheduled_job.failed`) and reported to Sentry, and the rest still run. If any job failed, the run as a whole is marked failed in Cron Events. Cloudflare doesn't retry it; the next run happens on schedule.

| Job | What it does |
|---|---|
| `releaseExpiredHolds` | Cancels PENDING / PAYMENT_PENDING registrations whose 15-minute seat hold has expired, across all MUNs, and emails delegates whose checkout hold expired in the last hour. |
| `runScheduledLifecycleTransitions` | Opens registration at `registrationOpensAt` (if the preconditions pass), closes it at the deadline or on the start day, and starts the conference on its start day. Needs `SYSTEM_ACTOR_USER_ID`; skipped with a warning without it. |
| `runSlaNotifications` | Emails the organizer (SLA_DELAY) when a go-live review becomes due soon or overdue; once per threshold. |
| `runConferenceReminders` | Emails confirmed delegates about 24 hours before their conference starts. Uses the cron's scheduled time, so a skipped run's reminders are not re-sent later. |
| `runOrganizerDigest` | Daily organizer digest for MUNs with open registration, in the 09:00-09:05 IST run only. |
| `purgeExpiredAuthArtifacts` | Deletes expired sessions, reset tokens used or expired over 7 days ago, and organizer sign-in codes expired over a day ago. |

Jobs must be idempotent: two runs can overlap if one is slow.

- **Watch**: Workers → `munhub-api` → Settings → Trigger Events (Cron Events), or Logs filtered on `event` starting with `scheduled_`.
- **Pause**: remove the cron from `triggers.crons` and redeploy, or delete the trigger in the dashboard. The next deploy restores it from the file.
- **Add a job**: implement `ScheduledJob` (`lib/jobs/types.ts`), add it to `SCHEDULED_JOBS`, and add a test.

### Run the Worker locally

```bash
cd server
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub" \
  npx wrangler dev --env="" --test-scheduled
# in another shell: trigger the cron handler once
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

`wrangler dev` reads secrets from `server/.dev.vars` (template: `server/.dev.vars.example`). Keep the Hyperdrive override pointed at Docker.

## Monitoring

- **Logs**: `observability.enabled` is on for both Workers. Dashboard → Workers → `munhub-api` → Logs lets you query structured fields such as `event`, `job`, `requestId`, `level`. Live tail: `cd server && npx wrangler tail --env="" --format pretty`.
- **Errors**: set `SENTRY_DSN` (a Sentry project for `munhub-api`) to get alerting and grouping. `server/lib/report-error.ts` sends events without an SDK. It already covers cron job failures. Wiring it into the API's 500 handler is a one-line follow-up (see `docs/autonomous-run/changes/lane-devops.md`).
- **Uptime**: point an external monitor (Better Stack, UptimeRobot, Cloudflare Health Checks) at `https://api.munhub.in/api/v1/health` and `https://app.munhub.in/`, checking every minute and alerting after two failures.
- **Database**: Neon console → Monitoring (connections, CPU, storage) and Hyperdrive → `munhub-db` metrics (query latency, cache hit ratio, connection errors).
- **What to alert on**: any `level: error` spike on `munhub-api`, a failed cron run, health check failures, and 5xx rate above about 1% (Workers → Metrics).

## Incident checklist

1. **Acknowledge** in the team channel: who's on it, and when it started.
2. **Scope**: which hosts (API, web, both, Vercel), which users (everyone, one role, one MUN)? Check `api.munhub.in/api/v1/health`, Workers metrics and logs, Neon status (neonstatus.com) and Cloudflare status (cloudflarestatus.com).
3. **Recent changes**: `npx wrangler deployments list --env=""` for both Workers, the last runs of the deploy workflow, and recent migrations. A deploy in the last hour is the first suspect.
4. **Mitigate first**:
   - bad Worker deploy → `wrangler rollback` (above)
   - bad migration → stop writes if data is at risk (roll the API back or pause cron), then restore from a Neon point-in-time branch
   - abuse or traffic spike → Cloudflare WAF / rate-limiting rules on the zone
   - leaked secret → rotate it (`wrangler secret put`), then redeploy if code reads it at build time
   - payment anomaly → there are **no refunds** in the product. Record the problem as a payment exception for an admin to resolve, and don't touch payment rows by hand without a second person.
5. **Verify** the fix with the post-deploy checks above.
6. **Communicate**: status to affected organizers or delegates if they noticed.
7. **Write up** within two working days: timeline, root cause, what detection missed, and follow-ups with owners.

## Rotating `PAYMENT_FIELD_KEY`

Payout details (`mun_payment_settings`) are encrypted with `PAYMENT_FIELD_KEY`. New ciphertext always uses the current key. When `PAYMENT_FIELD_KEY_PREVIOUS` is set, decryption tries the current key and then the previous one, so rows written before a rotation stay readable.

1. Generate a new key and store it in the team password manager next to the current one:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Set the previous key **first**, then the new current key. Each `secret put` deploys a new version immediately, and this order means no version ever lacks the old key:
   ```bash
   cd server
   npx wrangler secret put PAYMENT_FIELD_KEY_PREVIOUS --env=""   # paste the CURRENT key
   npx wrangler secret put PAYMENT_FIELD_KEY --env=""            # paste the NEW key
   ```
   (`npx wrangler secret bulk <file.json> --env=""` sets both in one version. Delete the file immediately afterwards.)
3. Check: save payout details on a test MUN and confirm the request succeeds and the row's ciphertext starts with `v1:`.
4. Re-encrypt existing rows under the new key. There is no re-encryption script yet (follow-up), so until one exists, **leave `PAYMENT_FIELD_KEY_PREVIOUS` set**.
5. Only one previous key is supported. Don't rotate again until every row is re-encrypted, or ciphertext from two rotations ago becomes unreadable.
6. After re-encryption, `npx wrangler secret delete PAYMENT_FIELD_KEY_PREVIOUS --env=""` and retire the old key.

Rotate on a schedule (yearly) and immediately if the key may have leaked. A rotation doesn't protect data that was already copied together with the old key. Treat that as a data incident.

Staging and local development each use their own key. Never reuse production's.
