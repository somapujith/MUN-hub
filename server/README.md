# MUN Hub API (`/server`)

Hono API for MUN Hub. In production it runs as the Cloudflare Worker `munhub-api` on `api.munhub.in`. Locally it runs under Node. Domain logic lives in the shared `lib/` at the repo root (imported as `@/lib/...`); route handlers here parse input, take identity from the session, and call into `lib/`.

## Prerequisites

- Node.js 22+
- Root dependencies (`npm ci` at the repo root) for `lib/`, Drizzle and the `@/*` alias
- Server dependencies (`npm ci` in this directory)
- Docker Postgres from the repo root (`npm run db:up && npm run db:migrate:local && npm run db:seed:local`)

## Run locally

Node (fastest loop):

```bash
cp ../.env.example .env        # local values only; set PAYMENT_FIELD_KEY
npx tsx --env-file=.env src/index.ts
```

It listens on port **3001** (`PORT` overrides). `tsx` doesn't load `.env` on its own, hence `--env-file`.

Workers runtime (same code path as production, including the cron handler):

```bash
cp .dev.vars.example .dev.vars
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub" \
  npx wrangler dev --env="" --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"    # run the scheduled jobs once
```

Never point either at the production database. See `docs/operations/ENVIRONMENTS.md`.

## Entry points

| File | Used by |
|---|---|
| `src/worker.ts` | Cloudflare Workers. Exports `fetch` (the Hono app) and `scheduled` (cron → `src/scheduled.ts` → `lib/jobs/registry.ts`). |
| `src/index.ts` | Node (`@hono/node-server`) for local development and the E2E suite |
| `src/app.ts` | `createApp()`: middleware stack and route mounting, shared by both |

## Authentication

Sessions are an HTTP-only cookie (`mun_hub_session`) backed by the `sessions` table. `middleware/session.ts` resolves it on every request, and handlers read identity only from `c.get('session')`.

| Who | How | Routes |
|---|---|---|
| Delegates and staff | Email + password (scrypt) | `POST /api/v1/auth/users` (delegate signup), `POST /api/v1/auth/session` (sign in), `POST /api/v1/auth/session/password` (change), `POST /api/v1/password-reset/request` + `/confirm` |
| Organizers | Passwordless: a 6-digit code sent by email (`lib/actions/organizer-otp.ts`) | `POST /api/v1/auth/organizers/code`, then `POST /api/v1/auth/organizers/session`. The first verified code for a new email creates the organizer account. |
| Everyone | Session check and sign-out | `GET /api/v1/auth/session`, `DELETE /api/v1/auth/session` |

Sign-in, code request and code verification have dedicated rate limits (`middleware/rate-limit.ts`). Without a `ZEPTOMAIL_TOKEN`, codes and reset links are printed to the console instead of emailed.

## Environment

Read through `getRuntimeEnv()` (`lib/runtime-env.ts`). Workers never put custom vars into `process.env`, so a plain `process.env.X` read works locally and silently fails in production. On Workers, plain vars come from `wrangler.jsonc` and secrets from `wrangler secret put`. Locally they come from `.env` (Node) or `.dev.vars` (`wrangler dev`). The full list, with production values and which ones are secrets, is in `docs/operations/RUNBOOK.md`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Node listen port |
| `DATABASE_URL` | none | Postgres URL for Node. The Worker uses its `HYPERDRIVE` binding instead. |
| `CORS_ORIGINS` | *(empty)* | Extra trusted origins, comma-separated, exact match (`ALLOWED_ORIGINS` is an older alias). `https://munhub.in`, `www.`, `app.`, `publish.`, `organize.` and `admin.munhub.in` are always trusted (credentialed CORS + CSRF). Per-MUN slug hosts (`<slug>.munhub.in`) only get non-credentialed CORS on GET/HEAD — see `server/lib/origins.ts` |
| `ALLOW_LOCALHOST_ORIGINS` | *(unset)* | `true` trusts `http://localhost:<port>` and `http://127.0.0.1:<port>` (the web dev server is on `:5174`) — local dev/tests only, never in a deployed environment |
| `COOKIE_DOMAIN` | unset (host-only) | `.munhub.in` in production, so the session is shared across subdomains |
| `APP_URL` | none | Public site URL for links in emails |
| `STORAGE_ADAPTER` | unset (uploads refused) | Node only: `local` writes uploads to `.local-uploads/` (`LOCAL_UPLOADS_DIR` overrides), `mock` discards them (tests). With neither, and no binding, uploads answer `503 File storage is not configured` rather than silently dropping the file. On Workers the `UPLOADS_BUCKET` / `UPLOADS_KV` bindings win (`lib/storage/select-adapter.ts` at the repo root). |
| `PUBLIC_API_URL` | unset (request origin) | Origin put in front of `/api/v1/files/<key>` in uploaded-file URLs; set in `wrangler.jsonc` for production |
| `PAYMENT_FIELD_KEY` | none (required) | AES-256-GCM key for payout details |
| `MOCK_PAYMENT_WEBHOOK_SECRET` | none | Mock payment provider webhook secret (dev/test) |
| `ZEPTOMAIL_TOKEN`, `ZEPTOMAIL_FROM_ADDRESS` | unset (log only) | Real email delivery |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | `300` | Per-IP cap for routes without a dedicated limit |
| `TRUST_PROXY_HEADERS` | unset | Honour `X-Forwarded-For` (only behind a trusted proxy) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | unset | Optional Sentry delivery from `lib/report-error.ts` |
| `AUTH_ADAPTER` | unset | Node only: with `NODE_ENV=production`, `src/index.ts` refuses to start unless this is set to something other than `mock` (`lib/boot-guard.ts`) |

## Middleware order

Defined in `src/app.ts`:

1. runtime-env bridge (Worker `env` → `getRuntimeEnv`)
2. Hyperdrive scope (per-request database client)
3. storage bindings (`UPLOADS_BUCKET` / `UPLOADS_KV` + request origin for `lib/storage`)
4. request-id
5. security headers (HSTS, nosniff, `default-src 'none'` CSP, …)
6. logger
7. CORS (`middleware/cors.ts`, origins from `server/lib/origins.ts`)
8. body limit (1 MB; 30 MB for document/media uploads; JSON 413)
9. session (`mun_hub_session` → `getSessionByToken`)
10. `/webhooks/*` (payment provider callbacks, outside CSRF)
11. CSRF (Origin/Referer check on unsafe methods under `/api/v1`, trusted origins only)
12. rate limit
13. `/api/v1/files`, then `/api/v1` routes (`routes/index.ts`: public routes, then `routes/protected.ts`, then go-live), then the MUN lifecycle routes
14. JSON 404 + error handler (`middleware/error.ts` maps known `lib/` errors to 4xx and everything else to a 500 with a request id)

## Background jobs

`src/scheduled.ts` runs on the cron in `wrangler.jsonc` (every 5 minutes). It sets up the runtime env and the Hyperdrive scope just like the fetch path, then runs `lib/jobs/registry.ts`, one job at a time, each isolated and logged. To add a job, implement `ScheduledJob` (`lib/jobs/types.ts`) and register it in `SCHEDULED_JOBS`.

## Error reporting

`lib/report-error.ts` writes a structured `console.error` line and, when `SENTRY_DSN` is set, sends the error to Sentry (no SDK). Use `reportError(error, context)` in non-request code and `reportRequestError(c, error, context)` in handlers. Pass identifiers only, never request bodies, query strings or personal data.

## Health check

`GET /api/v1/health` returns `{ "ok": true, "requestId": "..." }`.

## Checks

```bash
npm run typecheck                 # tsc for src, middleware, routes, lib
npx wrangler deploy --dry-run --env="" --outdir /tmp/api-bundle   # bundle as a deploy would
```

Tests run from the repo root (`npx vitest run server --no-file-parallelism`). They need the local database.

## Deploy

Via the **Deploy (production)** GitHub Actions workflow, or manually with `npx wrangler deploy --env=""` from a clean checkout. See `docs/operations/RUNBOOK.md`. Staging: `npx wrangler deploy --env staging` (`docs/operations/ENVIRONMENTS.md`).
