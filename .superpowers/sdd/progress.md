# Vite frontend migration — progress ledger

Worktree: `/Users/psoma/Projects/mun-hub/.claude/worktrees/vite-frontend-migration`
Branch: `worktree-vite-frontend-migration`
Design: `docs/superpowers/specs/2026-09-15-vite-frontend-migration-design.md`

## Status
- Steps 1–3 (scaffold + port UI + presentational public routes): **DONE**
- Step 4 (real API client / React Query hooks): **BLOCKED** on backend Phase 2 contract stability message
- Steps 5–6 (SSR dropped — CSR-only; SEO prerender is backend): N/A for frontend SSR; cutover later

## Commits (this slice)
- `76b23bb` feat(web): Vite SPA router shell and public pages with mock data (Phase 3 WIP)
- `85f3306` fix(web): wire MunsPage routes and clean build for Phase 3 public pages
- `a118cfc` fix(web): gate protected routes and tidy router import

## Verify
- `cd web && npx tsc -b --noEmit` → exit 0
- `cd web && npx vite` → HTTP 200 on `/`
