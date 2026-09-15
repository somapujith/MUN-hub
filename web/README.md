# `/web` — MUN Hub SPA

Vite + React 19 frontend that will replace the Next.js `app/**` tree.

## Intended stack (locked)

| Layer | Choice |
|---|---|
| Bundler | **Vite** (`vite` ^8 in this scaffold) |
| UI | **React 19** + TypeScript |
| Routing | **React Router v7 data-router mode only** (`createBrowserRouter`) — not framework mode; **no loaders for data fetching** |
| Server state | **TanStack Query** (`@tanstack/react-query` v5) |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite` preferred) + `docs/prd/DESIGN-airtable.md` tokens ported from `app/globals.css` |
| Head / titles | **react-helmet-async** (browser tab titles; crawler HTML is a backend prerender concern) |
| Theme | **next-themes** (framework-agnostic despite the name) |

Authoritative design: `docs/superpowers/specs/2026-09-15-vite-frontend-migration-design.md`  
Task plan: `docs/superpowers/plans/2026-09-15-vite-frontend-migration.md`

## Hard rules

- **CSR-only** for every route — no Vite SSR entry.
- **Never trust client `userId` / `role`.** Route guards are UX only; the API session cookie is authoritative.
- **Type-only imports** from repo-root `lib/actions` / `lib/types`. Never pull runtime `lib/` (DB, crypto) into the browser bundle.
- Preserve the Airtable editorial visual system — do not invent a new look.
- API base (when wired): `/api/v1` with `credentials: 'include'`.

## Status (prep)

Scaffold exists (create-vite + Router / Query / helmet deps). **Do not re-scaffold.** Next work is Task 3.1+ in the frontend plan (normalize shell, Tailwind tokens, route tree, public pages with mocks). **Do not port `app/` pages until Phase 1 signatures land** for the typed client; mock-data UI may proceed earlier per the plan.

## Scripts

```bash
cd web
npx vite          # dev
npx vite build    # production client bundle
npx vite preview
```

Root Semgrep-Guardian hooks may misfire on `npm run`; prefer `npx` binaries. Never attempt Semgrep login.
