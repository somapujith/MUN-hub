# Environments

MUN Hub runs in three places: local development, staging and production. Each one has its own database. **A database belongs to exactly one environment.** Local tooling must never be pointed at production, and staging must never share production's Neon branch.

| | Local | Staging | Production |
|---|---|---|---|
| Web | Vite dev server, `http://localhost:5174` | Worker `munhub-web-staging` on `*.workers.dev` | Worker `munhub-web` (`app.`, `publish.`, `organize.`, `admin.`, `*.munhub.in`), plus Vercel for `munhub.in` / `www` |
| API | Node (`server/src/index.ts`), `http://localhost:3001`; or `wrangler dev` | Worker `munhub-api-staging` on `*.workers.dev` | Worker `munhub-api` (`api.munhub.in`) |
| Database | Docker Postgres from `docker-compose.yml` | Neon **staging branch** through its own Hyperdrive config | Neon production branch through Hyperdrive `munhub-db` |
| Config | `server/.env` or `server/.dev.vars`, `.env.test` for tests | `env.staging` in both `wrangler.jsonc` files + staging secrets | top level of both `wrangler.jsonc` files + production secrets |
| Deploy | none | `wrangler deploy --env staging` (manual) | `.github/workflows/deploy.yml` (manual, approved), see [RUNBOOK.md](./RUNBOOK.md) |

## Local

- Database: `npm run db:up`, then `npm run db:migrate:local` and `npm run db:seed:local`. The `:local` scripts force `DATABASE_URL` to the Docker database whatever `.env` or your shell says (`scripts/with-local-db.mjs`).
- Tests: Vitest loads `.env.test`, which is committed, holds only mock values and points at the Docker database. The E2E suite refuses to start unless its database host is local (`E2E/env.ts`).
- API config: copy `.env.example` to `server/.env` (Node) or `server/.dev.vars.example` to `server/.dev.vars` (`wrangler dev`) and keep the local database URL in it.

### Keep production out of local files

The repo root `.env` on the team's machines points at **production Neon**. It exists for the historical `npm run db:migrate` / `db:seed` / `drizzle-kit` scripts, which read `.env` directly. Treat it as a production credential:

- Don't copy `.env` to `server/.env` or `server/.dev.vars`. Those files feed the local API, and a local API on the production database writes real rows (a test run once created 472 junk MUNs and 941 junk users there).
- Don't run `npm run db:migrate`, `db:seed`, `db:push` or `drizzle-kit` without checking which `DATABASE_URL` they will use. Prefer the `:local` scripts. Production migrations go through the deploy workflow.
- `wrangler dev` reads `server/.dev.vars`, not `.env`. Its Hyperdrive binding needs a local connection string (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, see [RUNBOOK.md](./RUNBOOK.md#run-the-worker-locally)). Point that at Docker too, never at Neon.
- A shell-exported `DATABASE_URL` wins over every `.env` file (dotenv and `node --env-file` never override it). Check `echo $DATABASE_URL` if something looks wrong.

## Staging

Staging runs the same code as production on Cloudflare, on `workers.dev` hostnames only. Neither staging Worker has a custom domain or route, so a staging deploy can't take over a `munhub.in` hostname. Routes are inherited from the top-level config unless overridden, which is why `env.staging.routes` is an explicit empty list.

### One-time setup

1. **Neon**: create a branch named `staging` from production (Neon console → Branches). A branch is a copy-on-write fork, so it starts with production's data. Before sharing staging with anyone, scrub it or recreate it from an earlier point in time: it holds real delegates' personal data. Use the branch's **direct** connection string for migrations.
2. **Hyperdrive**: `cd server && npx wrangler hyperdrive create munhub-db-staging --connection-string="<staging branch URL>"`, then replace the placeholder id in `server/wrangler.jsonc` → `env.staging.hyperdrive`. Until then a staging deploy fails.
3. **Secrets** (`cd server && npx wrangler secret put <NAME> --env staging`): `PAYMENT_FIELD_KEY` with a **new** key (never production's), and `MOCK_PAYMENT_WEBHOOK_SECRET` if staging should accept mock payments. Leave `ZEPTOMAIL_TOKEN` unset unless you are testing email; without it, mail is written to the Worker log. The full list is in [RUNBOOK.md](./RUNBOOK.md#configuration-per-worker).
4. **Migrate**: `DATABASE_URL="<staging branch direct URL>" npx tsx lib/db/migrate.ts` from the repo root.

### Deploy

```bash
# API
cd server && npx wrangler deploy --env staging

# Web: bake the staging API into the bundle, then upload it
cd web
VITE_API_URL=https://munhub-api-staging.somapujith.workers.dev/api/v1 npx vite build
npx wrangler deploy --env staging
```

The web build adds the `VITE_API_URL` origin to `connect-src` in `dist/_headers` (`web/vite-plugins/api-origin-csp.ts`), so the staging bundle's CSP allows the staging API. `env.staging` in `server/wrangler.jsonc` declares its own `ratelimits` (Wrangler doesn't inherit them), with namespace ids separate from production's.

The URLs assume the account's `somapujith.workers.dev` subdomain. If it differs, update `CORS_ORIGINS` and `APP_URL` in `server/wrangler.jsonc` → `env.staging.vars` and the `VITE_API_URL` above.

### Known limitation: signed-in browser flows

`workers.dev` is on the Public Suffix List, so `munhub-web-staging.<account>.workers.dev` and `munhub-api-staging.<account>.workers.dev` are different sites. The session cookie is `SameSite=Lax`, so the browser doesn't send it on the SPA's API calls. On staging you can check API health, signed-out pages and the cron jobs, and you can drive authenticated API calls with `curl` and a cookie jar. You can't sign in through the SPA.

To test signed-in flows in a browser, give staging same-site hostnames, e.g. `staging.munhub.in` and `staging-api.munhub.in`, as Custom Domains **plus** explicit Workers Routes. The routes are needed because `munhub-web`'s `*.munhub.in/*` wildcard route otherwise captures those hosts. Then set `COOKIE_DOMAIN` accordingly. That also puts staging under the production zone, which is why it isn't configured by default.

### Cron on staging

`triggers.crons` is inherited, so staging runs the scheduled jobs against the staging database every 5 minutes. To pause them, deploy staging with `"triggers": { "crons": [] }` in `env.staging`.

## Production

See [RUNBOOK.md](./RUNBOOK.md). In short: `munhub-api` and `munhub-web` Workers on the `munhub.in` Cloudflare zone, Neon production through Hyperdrive, deployed by the manual `Deploy (production)` workflow after approval. `munhub.in` and `www.munhub.in` are still served by Vercel from `web/`.
