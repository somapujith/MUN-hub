# MUN Hub API (`/server`)

Standalone Hono Node API (Phase 2 of the Next.js → Vite/Hono migration).

## Prerequisites

- Node.js 20+
- Root repo dependencies installed (`npm install` at repo root for `zod`, `@/*` path aliases, and `lib/`)
- Server dependencies: `npm install` in this directory
- `.env` with `DATABASE_URL` (and `PAYMENT_FIELD_KEY` if exercising payment routes)

## Run (development)

From the **repo root**:

```bash
npx tsx server/src/index.ts
```

Or from `/server`:

```bash
npm install
npm run dev
```

Default port: **3001** (`PORT` env overrides).

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated allowed origins, exact match. In addition, any `https://*.munhub.in` origin is always allowed (role + per-MUN wildcard subdomains — see `docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md`) |
| `COOKIE_DOMAIN` | *(unset = host-only cookie)* | Set to `.munhub.in` in production so the session cookie is shared across `app.`/`organize.`/`admin.munhub.in` |
| `AUTH_ADAPTER` | *(unset = mock)* | Must be non-`mock` when `NODE_ENV=production` |
| `NODE_ENV` | `development` | Production triggers auth boot-guard |

## Middleware order

1. request-id
2. logger
3. CORS
4. session (`mun_hub_session` → `getSessionByToken`)
5. **Webhooks** at `/webhooks/*` (outside CSRF)
6. CSRF (Origin/Referer on POST/PATCH/PUT/DELETE under `/api/v1`)
7. rate-limit (spec Section 4.6)
8. `/api/v1` routes
9. error handler (spec Section 3.4)

## Mount points for route modules

Sibling agents mount domain routes on the exported stubs in `server/src/app.ts`:

- `apiV1` — all `/api/v1/*` routes (auth, muns, admin, etc.)
- `webhooks` — provider-facing routes at `/webhooks/*` (no CSRF)

Example:

```ts
import { authRoutes } from '../routes/auth'
apiV1.route('/auth', authRoutes)
```

## Health checks

- `GET /api/v1/health` — API stub health
- `GET /webhooks/health` — webhook mount health

## Production boot guard

The server **refuses to start** when `NODE_ENV=production` and `AUTH_ADAPTER` is unset or `mock`. This prevents shipping the passwordless dev auth to a public deployment (spec Section 4.7).

## TypeScript

```bash
cd server && npm run typecheck
```

Uses `@/*` → repo root via `server/tsconfig.json` paths.
