# Vite Frontend Migration — Design (frontend slice)

**Date:** 2026-09-15
**Status:** approved for implementation planning, with explicit pending items
**Owner:** this session (mun-hub-b5) — frontend only
**Companion:** mun-hub-52 owns backend extraction (standalone Node service, API
contract, auth mechanism) — that design is still in progress at time of
writing. This doc locks everything decidable without the API contract and
marks what's blocked on it.

## 1. Scope

Full replacement of the Next.js `app/**` frontend (39 pages, 8 route trees)
with a Vite + React Router + React Query SPA/SSR-hybrid. Backend logic
currently in `lib/actions/*.ts` (21 files, ~60 functions) moves to
mun-hub-52's standalone Node service — this doc does not re-decide that,
only how the frontend consumes whatever API results from it.

**Out of scope for this doc:** backend framework choice, API endpoint
shapes, auth token mechanism, database access patterns — all owned by
mun-hub-52's architect design, referenced here as "pending" wherever the
frontend decision depends on it.

## 2. Locked decisions (do not depend on backend contract)

**2026-09-15 correction (post mun-hub-ef review, aligned to mun-hub-bf's now-finished
backend design at `.claude/worktrees/nextjs-to-react-migration/docs/superpowers/specs/2026-09-15-nextjs-to-react-spa-migration-design.md` Sections 5.1 and 7):**
the two items below were locked before the backend design existed and directly
contradicted it. Corrected here, before any router/build code is written.

- **Stack:** Vite + React 19 + TypeScript + React Router v7 **data-router mode
  only** (`createBrowserRouter`, NOT framework mode) + React Query
  (`@tanstack/react-query`) for all server state/caching/mutations.
  **Loaders are NOT used for data fetching** — data fetching goes through
  React Query exclusively (backend design Section 5.1: "two fetching systems
  is an anti-pattern"). Loaders, if used at all, are limited to pre-auth route
  guards. `createStaticRouter` is dropped entirely — there is no
  router-level SSR anywhere in this app.
- **SEO strategy: CSR-only for every route, including the 3 public ones**
  (`/`, `/muns`, `/mun/:slug`). No Vite SSR entry, no `createStaticRouter`.
  SEO/social-preview parity for those 3 routes is a **backend concern**:
  mun-hub-bf's design Section 7 (Decision 6) puts a crawler-User-Agent-targeted
  prerender service (D1: a Hono route serving templated HTML+meta, no React
  involved) in front of the SPA. The frontend's only obligations here are (a)
  make sure the SPA itself still sets `document.title`/meta via
  `react-helmet-async` for real browser users' tab titles/back-forward, and
  (b) not build anything that assumes it owns crawler-facing HTML — that's
  Section 7's job, in `/server` or a sibling service, not `/web`.
- **Route tree — 1:1 URL mapping**, zero URL shape changes (preserves
  bookmarks, the sitemap just added, and any external links):

  | Current Next.js tree | New React Router tree |
  |---|---|
  | `app/page.tsx` | `/` (SSR) |
  | `app/muns/page.tsx` | `/muns` (SSR) |
  | `app/mun/[slug]/page.tsx` | `/mun/:slug` (SSR) |
  | `app/login/page.tsx` | `/login` (CSR) |
  | `app/register/[slug]/**` | `/register/:slug`, `/register/:slug/pay`, `/register/:slug/confirmation` (CSR) |
  | `app/dashboard/page.tsx` | `/dashboard` (CSR) |
  | `app/organizer/apply/**` | `/organizer/apply`, `/organizer/apply/submitted` (CSR) |
  | `app/organizer/dashboard/**` | `/organizer/dashboard/*` (CSR, nested layout route matching the current `(workspace)`/`[munId]` split) |
  | `app/admin/**` | `/admin/*` (CSR, nested layout route matching current `app/admin/layout.tsx` role-gate) |
  | `app/support/new/page.tsx` | `/support/new` (CSR) |

- **Component reuse:** `components/ui/*` (15 shadcn-based primitives) and
  the framework-agnostic parts of `components/{dashboard,marketplace,mun,
  organizer,registration,shared}/*` port with minimal changes — they're
  already plain React, not Next-specific, aside from any `next/link`/
  `next/navigation`/`next/image` imports which get swapped for React
  Router's `Link`/`useNavigate` and a plain `<img>` or a Vite image plugin.
  `components/theme-provider.tsx` (next-themes) needs a non-Next-coupled
  replacement or confirmation next-themes works framework-agnostically
  (it does — it's not actually Next-specific despite the name, just needs
  its own hydration-safe mounting in a Vite SSR context).
- **Build tooling:** Vite's own dev server + `vite build`, no Next config
  surface at all once cutover completes. **Single build target: the client
  bundle, all routes.** No SSR entry (corrected above — SSR is not this
  app's concern at all now).
- **Directory:** new SPA lives at repo-root `/web` (matches backend design
  Section 8.2's Phase-0 layout: `/lib` shared, `/server` new API, `/web` new
  SPA, `/app` existing Next app deleted at the end — and Section 3.5's own
  `web/src/api/client.ts` reference). Not a `frontend/` folder, not nested
  under `app/`.
- **Server-driven auth check, not client-trusted:** whatever the auth
  mechanism turns out to be (pending backend contract), the frontend never
  treats a client-visible flag as authoritative for gating protected
  routes — a loader/guard always confirms with the backend before
  rendering protected content, matching this project's existing
  "server remains authoritative" principle carried over from the Next app.

## 3. Pending on mun-hub-52's backend contract

These cannot be finalized until the architect design lands. Each has a
placeholder decision so scaffolding can start; each gets revisited the
moment the real contract arrives.

- **Auth transport** — placeholder: assume cookie-based session (matches
  today's `mun_hub_session` cookie) with `credentials: 'include'` on all
  fetches. If the new backend instead issues a bearer token, this becomes
  an Authorization-header interceptor in the React Query fetch wrapper —
  a contained, single-file change (`lib/api-client.ts`), not a rearchitect.
- **API base URL / endpoint shapes — no longer a placeholder.** Backend
  design has landed: base is `/api/v1`, routes are resource/action-oriented
  per its Section 3.2/3.3 (e.g. `getMunBySlug` → `GET /api/v1/muns/:slug`).
  Full route map: Section 5.2 of the backend design doc. Query key
  convention: its Section 6.1 (hierarchical arrays, prefix-invalidatable).
  Still doesn't block steps 1-3 (no real calls yet), but step 4's client
  should be built directly against this contract, not re-derived.
- **Idempotency-Key + date revival — new pending items, not yet built.**
  Backend Section 3.5/6.6: the typed client must inject a stable
  `Idempotency-Key` header generated once per user intent (not per retry —
  a `useRef`'d UUID, reset only when the triggering dialog/flow closes and
  reopens) for mutations that need it (`initiateRegistration`,
  `publishFromQueue`, others per Section 3.2), and must revive ISO date
  strings on an allowlisted key suffix (`At`/`Date`/`deadline`) back into
  `Date` objects so ported components need no date-handling changes. Both
  are step-4 work (real client), noted now so step-3 mock data uses real
  `Date` objects (matching what the client will eventually hand components),
  not strings.
- **The bimodal auth pattern in lib/actions** (some functions take
  `session: Session | null` as a param, others call `getSession()`
  internally) — per mun-hub-52's research, this matters for how the new
  API wraps them. Frontend impact: none directly (the frontend never
  called these functions directly, Next's Server Components did) — noted
  here only so the pending API contract is understood to already account
  for it.

## 4. Migration sequencing (frontend side)

1. Scaffold: Vite project, build config, folder structure, route tree
   skeleton (empty/placeholder route components matching every URL from
   section 2's table), React Router setup, React Query provider setup.
   **No API calls yet.** — safe to start now, zero dependency on backend
   contract.
2. Port `components/ui/*` and shared components verbatim (swap
   Next-specific imports for React Router/plain equivalents).
3. Build out each route tree's UI (presentational layer) using the
   existing Next page's JSX as the source of truth for markup/behavior,
   but with data fetching stubbed (hardcoded/mock data) until step 5.
4. **Blocked until backend contract lands:** build `lib/api-client.ts`
   (the fetch wrapper — auth transport, base URL, error handling) and
   wire real React Query hooks per route tree, replacing the stubs from
   step 3.
5. SSR entry setup for the 3 SEO routes, verify metadata/OG tags/sitemap
   parity with what Next currently produces.
6. Cutover plan (DNS/deploy — likely mun-hub-52's territory jointly with
   this, since it's infra not frontend code).

Steps 1-3 are the "start now" slice. Step 4 onward waits for the real
contract. This doc's implementation plan (next artifact) will task-break
steps 1-3 only; step 4+ gets its own plan once unblocked.

## 5. Testing

- Component/route tests: Vitest + React Testing Library (already the
  project's test runner, just add RTL) — one test per route confirming it
  renders its expected shell/loading state with mocked React Query data.
- No integration tests against a real backend possible yet (none exists
  outside `lib/actions` functions Next currently calls in-process) — this
  is explicitly a step-4+ concern.

## 6. Testing/verification for THIS slice (steps 1-3)

- `npm run build` (Vite) succeeds with zero errors.
- Every route in section 2's table renders without crashing (smoke test
  per route, RTL `render()` + assert no thrown error).
- `tsc --noEmit` clean.
- No route references a real API call yet — grep for `fetch(` / `useQuery`
  with a real URL should return nothing until step 4 explicitly unblocks.
