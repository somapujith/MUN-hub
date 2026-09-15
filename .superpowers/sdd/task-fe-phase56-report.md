# Task FE Phase 5+6 Report

**Date:** 2026-09-15  
**Worktree:** `vite-frontend-migration`  
**Scope:** Organizer workspace + Admin console route shells (mock data only)

## Summary

Phase 5 and Phase 6 placeholder UI is wired in the Vite SPA with nested layouts matching the Next.js URL structure. All routes render presentational shells driven by mock data — no `/api/v1` calls.

## Phase 5 — Organizer workspace

### Routes
| Path | Component |
|------|-----------|
| `/organizer/apply` | `OrganizerApplyPage` |
| `/organizer/apply/submitted` | `OrganizerApplySubmittedPage` |
| `/organizer/dashboard` | `OrganizerOverviewPage` (WorkspaceLayout) |
| `/organizer/dashboard/muns` | `OrganizerMunsPage` (WorkspaceLayout) |
| `/organizer/dashboard/:munId` | redirect → `setup` |
| `/organizer/dashboard/:munId/{16 sections}` | `MunSectionShell` per section (MunWorkspaceLayout) |

### Layouts & components
- `layouts/workspace-layout.tsx` — org-wide shell (`currentMun={null}`)
- `layouts/mun-workspace-layout.tsx` — per-MUN shell with ownership mock gate
- `components/organizer/workspace-shell.tsx` — sidebar + topbar chrome
- `components/organizer/mun-switcher.tsx` — conference switcher (section-preserving)
- `components/organizer/workspace-nav.tsx`, `workspace-sidebar.tsx`, `workspace-breadcrumb.tsx`, `workspace-mobile-nav.tsx`
- `lib/organizer/nav-config.ts` — ported from Next (16 MUN sections + 2 org-wide items)

### Mock data
- `mocks/organizer.ts` — `MOCK_WORKSPACE_MUNS`, totals, summaries (`Date` objects)
- `mocks/session.ts` — `MOCK_ORGANIZER_SESSION` + `getMockSessionForRoute()`

### Guards
- `guards/require-auth.tsx` — UX-only; redirects to `/login?redirect=`

## Phase 6 — Admin console

### Routes (10 total — 9 existing + new go-live queue)
| Path | Component |
|------|-----------|
| `/admin` | `AdminOverviewPage` |
| `/admin/review` | `AdminReviewPage` |
| `/admin/verification` | `AdminVerificationPage` |
| `/admin/go-live-queue` | **`AdminGoLiveQueuePage` (NEW)** |
| `/admin/registrations` | `AdminRegistrationsPage` |
| `/admin/payments` | `AdminPaymentsPage` |
| `/admin/organizers` | `AdminOrganizersPage` |
| `/admin/support` | `AdminSupportPage` |
| `/admin/audit` | `AdminAuditPage` |
| `/admin/audit/:targetType/:targetId` | `AdminAuditDetailPage` |

### Layout & gate
- `layouts/admin-layout.tsx` — sub-nav + `RequireRole` for OPERATIONS|ADMIN|SUPER_ADMIN
- `lib/admin/nav-config.ts` — nav items including Go-live queue
- `mocks/admin.ts` — `MOCK_GO_LIVE_QUEUE` mirrors `GoLiveQueueRow` / `getGoLiveQueue` shape

## Routing

- `src/routes.tsx` — `createBrowserRouter` tree with nested `WorkspaceLayout` / `MunWorkspaceLayout` / `AdminLayout`
- Removed stale `src/routes/router.tsx` placeholder tree

## Verification

```bash
cd web && npx tsc -b   # clean
cd web && npx vite build   # clean
```

## Deferred (Phase 5.2+ / 6.3)

- Real `useQuery` wiring to Hono `/api/v1`
- Module CRUD editors, go-live pipeline wizard, admin mutation invalidation
- Retire `submitMunForVerification` shim in UI
