# Task report — frontend Steps 1–3 (scaffold)

**Status:** DONE_WITH_CONCERNS

## Commits
- `76b23bb` — feat(web): Vite SPA router shell and public pages with mock data (Phase 3 WIP)
- `85f3306` — fix(web): wire MunsPage routes and clean build for Phase 3 public pages
- `a118cfc` — fix(web): gate protected routes and tidy router import

(Plus earlier stub: `83035d3` docs + web SPA stub)

## What landed

### Step 1 — Scaffold `/web`
- Vite + React 19 + TypeScript at repo-root `web/`
- React Router v7 **data-router** (`createBrowserRouter` in `web/src/routes.tsx`) — not framework mode
- TanStack Query via `QueryClientProvider` (`web/src/api/query-client.ts`, wired in `main.tsx` / `App.tsx`)
- Tailwind v4 (`@tailwindcss/postcss` + ported `app/globals.css` → `web/src/index.css`)
- Route tree covers design §2 URLs (public + register + dashboard + organizer nested + admin nested + support)
- No SSR entry; CSR-only
- Loaders not used for data fetching

### Step 2 — Ported components
- `web/src/components/ui/*` (shadcn/base-ui primitives)
- Layout / marketplace / mun / shared (+ dashboard/organizer/registration/admin as peer expansion)
- `next/link` → RR `Link` (`to=`); `useRouter` → `useNavigate`; `usePathname` → `useLocation().pathname`
- `next-themes` ThemeProvider retained (CSR-safe)

### Step 3 — Presentational public + shell (mock data)
| Route | Page | Notes |
|---|---|---|
| `/` | `pages/home-page.tsx` | Full shelf UI + mock facets/search; real `Date`s |
| `/muns` | `pages/muns-page.tsx` | Marketplace grid + filters + pagination |
| `/mun/:slug` | `pages/mun-detail-page.tsx` | Detail + 404 via `not-found-page` |
| `/login` | `pages/login-page.tsx` | Preserves `?redirect=` / `?redirectTo=` via `safeRedirectTo` |
| Shell | `layouts/root-layout.tsx` + per-page `SiteHeader`/`SiteFooter` | |

Mocks: `web/src/mocks/data.ts` (Date objects, not ISO strings). No live API client.

## How to run
```bash
cd web && npm install && npx vite
```
Typecheck: `cd web && npx tsc -b --noEmit`

## Concerns
1. **Concurrent peer edits** in the same worktree expanded organizer/admin/register beyond Steps 1–3 while this dispatch ran — some placeholder register pages remain thin.
2. **`RequireAuth` is UX-only** (mock session hook); must not be treated as security until step-4 API + cookie session land.
3. **Duplicate provider trees**: both `main.tsx` and `App.tsx` wrap QueryClient/Helmet/Router — `main.tsx` is the live entry; tidy later.
4. **Step 4 blocked** until backend Phase 2 API contract is messaged stable (Idempotency-Key + date revival client).
5. SEO for `/`, `/muns`, `/mun/:slug` is **backend crawler prerender** (design correction) — frontend only sets `react-helmet-async` titles for browsers.
