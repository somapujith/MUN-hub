# Phase 2 Task 2.1 — Hono Skeleton + Middleware Report

**Status:** COMPLETE  
**Date:** 2026-09-15  
**Worktree:** `nextjs-to-react-migration`

## Summary

Built `/server` as a standalone Hono Node API with the full middleware stack per design spec Section 8.2. Sibling agents mounted domain route modules on the exported `apiV1` and `webhooks` stubs.

## Deliverables

| Item | Path | Notes |
|---|---|---|
| Package manifest | `server/package.json` | hono, @hono/node-server, @hono/zod-validator; zod from repo root |
| Entry point | `server/src/index.ts` | Boot guard → createApp → @hono/node-server |
| App factory | `server/src/app.ts` | Middleware stack + mount points |
| Types | `server/src/types.ts` | `{ session: Session \| null; requestId: string }` |
| Session middleware | `server/middleware/session.ts` | `mun_hub_session` → `getSessionByToken` |
| Auth guards | `server/middleware/require-auth.ts`, `require-role.ts` | 401 / 403 via lib/auth/authorize |
| CSRF | `server/middleware/csrf.ts` | Origin/Referer on POST/PATCH/PUT/DELETE under `/api/v1` |
| Rate limit | `server/middleware/rate-limit.ts` | Spec §4.6 table; in-memory per-instance |
| Error taxonomy | `server/middleware/error.ts` | Spec §3.4; 500 never leaks stack/SQL |
| Boot guard | `server/lib/boot-guard.ts` | Refuses prod start with mock auth (§4.7) |
| Route stub | `server/routes/index.ts` | Exports `apiV1` for sibling mounts |
| Webhook stub | `server/routes/webhooks.ts` | Outside CSRF + outside `/api/v1` |
| README | `server/README.md` | Run via `npx tsx server/src/index.ts` |

## Middleware order (verified)

1. request-id (`hono/request-id`)
2. logger (`hono/logger`)
3. CORS (`hono/cors`)
4. session (`getSessionByToken`)
5. `/webhooks/*` — **no CSRF**
6. CSRF — scoped to `/api/v1/*`
7. rate-limit — scoped to `/api/v1/*`
8. `/api/v1` routes (`apiV1` stub + sibling modules)
9. error handler (`app.onError`)

## Fix applied this session

Nested `protectedApi.route('/', apiV1)` caused all `/api/v1/*` routes to 404. Replaced with:

```ts
app.use('/api/v1/*', csrfMiddleware)
app.use('/api/v1/*', rateLimitMiddleware)
app.route('/api/v1', apiV1)
```

Smoke test: `GET /api/v1/health` → 200, `GET /webhooks/health` → 200.

## TypeScript

```bash
cd server && npm run typecheck
```

**Result:** 3 errors in `server/routes/mun-config.ts` (date string vs Date — sibling route work, not skeleton). Skeleton/middleware files typecheck clean.

## Boot guard

```bash
NODE_ENV=production npx tsx -e "import { assertProductionAuthConfigured } from './server/lib/boot-guard.ts'; assertProductionAuthConfigured()"
```

Throws as expected when `AUTH_ADAPTER` is unset/mock.

## Commit

Message: `feat(server): Hono skeleton and middleware stack (Phase 2.1)`

## Mount points for sibling agents

```ts
import { apiV1, webhooks } from '../src/app'
// apiV1.route('/auth', authRoutes)   — done by public routes agent
// apiV1.route('/', protectedRoutes)  — done by protected routes agent
// webhooks.route('/payments', ...)   — pending go-live/webhook agent
```
