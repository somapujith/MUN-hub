# Trusted-parameter audit — Phase 2 deliverable

Date: 2026-09-15  
Scope: HTTP-exposed query/body flags that were implicitly trusted in-process but become externally controlled once public.

## Guarded (anonymous callers cannot escalate)

| Endpoint | Parameter | Guard | Route file |
|---|---|---|---|
| `GET /api/v1/muns/:slug/products` | `includeInactive=true` | `assertOwnsOrAdmin` via `resolveIncludeInactive`; defaults false | `server/routes/muns.ts` |
| `GET /api/v1/muns/:munId/products` | `includeInactive=true` | same helper | `server/routes/mun-config.ts` |
| `GET /api/v1/muns/:munId/accommodation` | `includeInactive=true` | same helper | `server/routes/accommodation.ts` |

## Strict body schemas (stray fields rejected)

All mutating routes use `.strict()` Zod schemas. Notable cases:

| Endpoint | Rejected field example | Why |
|---|---|---|
| `POST /api/v1/registrations` | `userId` in body | IDOR — actor from session only |
| All PATCH/POST workspace routes | unknown keys | prevents shadow parameters |

## Required transport headers (not body fields)

| Endpoint | Header | Behavior |
|---|---|---|
| `POST /api/v1/registrations` | `Idempotency-Key` | 400 if absent |
| `POST /api/v1/muns/:munId/actions/publish` | `Idempotency-Key` | 400 if absent |

## Intentionally public / bounded

| Endpoint | Parameter | Mitigation |
|---|---|---|
| `GET /api/v1/products/availability?ids=` | comma-separated UUID list | capped at 50 ids |
| `GET /api/v1/muns` search | `limit`, `offset`, filters | Zod max bounds |

## No HTTP route (internal only)

| Function | Reason |
|---|---|
| `releaseExpiredReservations` | would allow forced reservation sweeps |
| `buildSnapshot` | internal to confirmation/publish |
| `checkAllModulesVerified` | triggered by `reviewModule` only |

## Not exposed (deprecated shim)

| Function | Decision |
|---|---|
| `submitMunForVerification` | no route — UI should call `submit-final-confirmation` per spec §3.3.2 |
