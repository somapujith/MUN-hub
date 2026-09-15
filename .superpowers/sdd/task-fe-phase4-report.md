# Phase 4 — Authenticated Read-Heavy Routes (Mock Data)

**Worktree:** `vite-frontend-migration`  
**Date:** 2026-09-15  
**Status:** Complete — `npx tsc -b` clean

## Summary

Student-facing authenticated routes run on mock data with UX-only guards. No real `/api/v1` calls yet.

## Deliverables

### Guards
- `web/src/guards/require-auth.tsx` — skeleton while pending; redirect to login; **server authoritative**
- `web/src/guards/require-role.tsx` — 403 for wrong role; **server authoritative**

### Session
- `web/src/hooks/use-session.ts` — `staleTime: Infinity` mock student via React Query

### Mock data (real `Date` objects)
- `web/src/mocks/session.ts` — `fetchMockSession`, profile stub
- `web/src/mocks/registrations.ts` — dashboard lists + funnel state + initiate/pay mocks

### Routes (`web/src/routes.tsx`)
| Path | Page |
|---|---|
| `/dashboard` | `student-dashboard-page.tsx` + `RequireAuth` |
| `/register/:slug` | `register-page.tsx` under `RegisterLayout` + `RequireAuth` |
| `/register/:slug/pay` | `register-pay-page.tsx` |
| `/register/:slug/confirmation` | `register-confirmation-page.tsx` |
| `/support/new` | `support-new-page.tsx` + `RequireAuth` |

### Registration funnel
- 3-step UI (option → details → review) via `registration-form-mock.tsx`
- Availability: `staleTime: 0`, `refetchInterval: 15_000` (mock query)
- Idempotency `useRef` pattern stubbed in comments for Task 3.7 API wiring

## Verification

```bash
cd web && npx tsc -b
```

## Deferred (Task 3.7)
- `GET /api/v1/auth/session`, registration mutations, support ticket POST
