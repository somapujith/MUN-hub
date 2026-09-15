# Vite Frontend Migration — Implementation Plan (Phases 3–6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Next.js `app/**` frontend with a Vite + React Router v7 (data-router mode) + TanStack Query SPA under `/web`, preserving 1:1 URLs and the `DESIGN-airtable.md` visual system, while never trusting client-supplied `userId`/`role`.

**Specs (authority order):**
1. Frontend design: `docs/superpowers/specs/2026-09-15-vite-frontend-migration-design.md`
2. Backend/full migration design: `.claude/worktrees/nextjs-to-react-migration/docs/superpowers/specs/2026-09-15-nextjs-to-react-spa-migration-design.md` (Sections 5–7 especially)
3. Parent plan (coordination outline): `.claude/worktrees/nextjs-to-react-migration/docs/superpowers/plans/2026-09-15-nextjs-to-react-spa-migration.md` Phases 3–6

**Owner:** frontend session (`worktree-vite-frontend-migration`). Backend peer owns Phases 0–2 in `nextjs-to-react-migration`. Phase 7 is joint.

**Design system:** preserve `DESIGN-airtable.md` + `app/globals.css` tokens (coral/forest/cream/dark-navy signature cards, Haas Grotesk → Inter substitute, hierarchical radius, 96px rhythm). Do not invent a new look.

---

## Global Constraints

- **No client-trusted identity.** Guards (`RequireAuth` / `RequireRole` / `RequireMunAccess`) are UX only. Every comment in those files must say so. Never accept `userId` or `role` from the client body/query; session comes from cookie → `GET /api/v1/auth/session`.
- **No Semgrep** — not MCP, not CI, not review routing. Verify with `npx tsc --noEmit`, Vitest + RTL, manual browser checks.
- **CSR-only for every route.** No Vite SSR entry, no `createStaticRouter`. Crawler HTML/meta for `/`, `/muns`, `/mun/:slug` is backend Section 7 (Hono prerender) — not this plan's build target. Frontend only: `react-helmet-async` for browser tab titles.
- **Data fetching = TanStack Query only.** React Router loaders are not used for data. Loaders, if any, are pre-auth guards only.
- **Do not start porting `app/` pages until Phase 1 signature changes land** on the backend branch (types imported by the typed client come from `lib/actions/*` / `lib/types/*`). Phase 3 Tasks 3.2–3.6 (Tailwind + route shell + mocks) may proceed; Task 3.7+ (real API client) waits for Phase 1 + a stable Phase 2 contract slice.
- **Never `import` runtime code from `@/lib/**` into `web/src/**`.** Type-only imports (`import type`) are allowed once an ESLint/oxlint rule enforces the ban (backend design §3.5). Careless value imports pull DB/crypto into the browser bundle.
- **Mock data uses real `Date` objects**, not ISO strings — matches what the date-reviving client will hand components later.
- **Known env quirk:** prefer `npx <binary>` over `npm run` if Semgrep-Guardian hooks misfire; never attempt Semgrep login.

---

## Package versions (as of prep; `web/` scaffold already present)

`web/` already exists with a create-vite skeleton and dependencies installed. **Do not re-scaffold or wipe it.** Documented pins from current `web/package.json` (adjust only if installs fail):

| Package | Installed / intended | Notes |
|---|---|---|
| `vite` | `^8.3.0` | Already in `web/` |
| `@vitejs/plugin-react` | `^6.1.1` | Already in `web/` |
| `react` / `react-dom` | `^19.2.8` | Match root |
| `react-router` | `^7.18.3` | **data-router only** — `createBrowserRouter` (v7 may not need separate `react-router-dom`) |
| `@tanstack/react-query` | `^5.102.8` | Already in `web/` |
| `react-helmet-async` | `^3.0.0` | Browser title/meta |
| `tailwindcss` | `^4.3.3` | Already in `web/` |
| `@tailwindcss/vite` | **add next** | Prefer Vite plugin over PostCSS-only; `@tailwindcss/postcss` is present as interim |
| `tw-animate-css` | `^1.4.0` | Match root |
| `next-themes` | `^0.4.6` | ThemeProvider |
| `lucide-react`, `sonner`, `cva`, `cn`, `shadcn`, `@base-ui/react` | present | Align with root UI stack |
| `@tanstack/react-query-devtools` | **add when wiring Query** | Dev only |
| `@testing-library/react`, `jsdom`, `vitest` | **add with Task 3.6 tests** | Prefer vitest `^4` to align with root |
| `@fontsource-variable/inter` (or Inter) | **add with Task 3.2** | Haas Grotesk substitute |

**Still missing / do not add:** Next.js packages under `web/`. Do not introduce pnpm workspaces / turborepo unless single-package layout proves impossible (flag for ruling first).

---

## Target directory layout (after Phase 3)

```
web/
  README.md
  package.json              # already present
  index.html
  vite.config.ts
  tsconfig*.json
  src/
    main.tsx
    App.tsx                 # QueryClientProvider + RouterProvider + HelmetProvider
    index.css               # port of app/globals.css (+ font imports)
    routes.tsx              # createBrowserRouter tree
    api/
      client.ts             # Task 3.7 — blocked until Phase 1/2
      query-keys.ts
      date-reviver.ts
      muns.ts / auth.ts …
    mocks/                  # Phase 3 stub data (Date objects)
    components/             # ported from repo-root components/
    pages/                  # one file (or folder) per route
    layouts/
      root-layout.tsx
    guards/                 # Phase 4
    hooks/                  # useSession etc. — Phase 4
    lib/                    # cn.ts, utils only — never DB
  public/
```

---

## Phase 3 — Vite SPA Skeleton + Public Routes

**Exit criteria (design §6 + parent plan):**
- `npx vite build` (from `web/`) succeeds with zero errors.
- `npx tsc --noEmit` (or `tsc -b`) clean for the web project.
- Every URL in the route table has a placeholder or real page that renders without throwing (RTL smoke).
- Public marketplace surfaces (`/`, `/muns`, `/mun/:slug`, `/login`) look like the Airtable design (visual parity with current Next pages), driven by **mock data** until Task 3.7.
- No real `fetch(` to `/api/v1` until Task 3.7 is unblocked.
- Grep for value-imports of `@/lib/` under `web/src` returns zero.

**Dependency gate:** Tasks 3.2–3.6 are unblocked now (scaffold exists). Task 3.7+ waits for backend Phase 1 + enough of Phase 2 that marketplace + auth session contracts are frozen.

### Task 3.0: Prep artifacts (this commit)

- [x] **Step 1:** Write this plan under `docs/superpowers/plans/2026-09-15-vite-frontend-migration.md`.
- [x] **Step 2:** Replace `web/README.md` with intended-stack description (leave existing Vite scaffold intact).
- [x] **Step 3:** Align frontend design doc with backend §5.1 / §7 (CSR-only, data-router, no Vite SSR).
- [x] **Step 4:** Write `.superpowers/sdd/frontend-prep-report.md`.
- [ ] **Step 5:** Commit prep on `worktree-vite-frontend-migration` only.

### Task 3.1: Normalize existing Vite scaffold (do not recreate)

**Status:** `web/` already has create-vite output + React Query / Router / helmet deps.

- [ ] **Step 1:** Replace default Vite demo `App.tsx` / `App.css` / hero assets with a minimal shell that mounts providers only (no marketing template leftover).
- [ ] **Step 2:** Add path alias `@` → `web/src` in `vite.config.ts` + `tsconfig`. Document type-only path to repo-root `lib/types` / `lib/actions` if needed — **no value imports**.
- [ ] **Step 3:** Add `@tailwindcss/vite` plugin (preferred) or confirm PostCSS pipeline; remove unused create-vite chrome.
- [ ] **Step 4:** Confirm `npx vite` / `npx vite build` succeed. Commit scaffold normalization alone.

### Task 3.2: Tailwind v4 + DESIGN-airtable tokens

**Files:** `web/src/index.css` (port of `app/globals.css`), `web/src/components/theme-provider.tsx`

- [ ] **Step 1:** Copy `app/globals.css` → `web/src/index.css`. Keep all `@theme` / signature-card / status tokens. Swap any Next-only font wiring for Inter/`@fontsource`.
- [ ] **Step 2:** Import `index.css` from `main.tsx`. Verify coral/forest/navy CSS variables resolve in DevTools.
- [ ] **Step 3:** Port `components/theme-provider.tsx` (next-themes) with hydration-safe mount (no Next APIs).
- [ ] **Step 4:** Visual smoke: temporary page rendering a signature-card + primary pill CTA matches Next homepage tokens. Commit.

### Task 3.3: React Router v7 data-router skeleton (all URLs, placeholders)

**Files:** `web/src/routes.tsx`, `web/src/layouts/root-layout.tsx`, `web/src/pages/**` placeholders, `web/src/pages/not-found.tsx`

Route map (1:1 with Next — backend design §5.2):

| Path | Placeholder component | Auth (later) |
|---|---|---|
| `/` | `HomePage` | public |
| `/muns` | `MarketplacePage` | public |
| `/mun/:slug` | `MunDetailPage` | public |
| `/login` | `LoginPage` | public |
| `/support/new` | `SupportNewPage` | auth |
| `/register/:slug` (+ `/pay`, `/confirmation`) | register pages | auth |
| `/dashboard` | `StudentDashboardPage` | STUDENT+ |
| `/organizer/apply`, `/organizer/apply/submitted` | apply pages | auth |
| `/organizer/dashboard` (+ workspace + `:munId`/*) | organizer placeholders | ORGANIZER+ |
| `/admin` (+ review, verification, organizers, payments, support, registrations, audit, audit/:t/:id, **go-live-queue**) | admin placeholders | OPERATIONS+ |
| `*` | `NotFoundPage` | — |

- [ ] **Step 1:** `createBrowserRouter([...])` with nested layouts: `RootLayout`, pathless `WorkspaceLayout`, `MunWorkspaceLayout`, `AdminLayout`, `RegisterLayout` (shells can be empty `<Outlet />` for now).
- [ ] **Step 2:** Every leaf is a one-line placeholder (`<h1>…</h1>`) so the tree compiles. **No loaders for data.**
- [ ] **Step 3:** Wire `RouterProvider` in `App.tsx`.
- [ ] **Step 4:** Manually hit each path (or a small Vitest that renders the router with each path) — no crash. Commit.

### Task 3.4: TanStack Query provider + defaults (no real endpoints)

**Files:** `web/src/App.tsx`, `web/src/api/query-client.ts`, `web/src/api/query-keys.ts`

- [ ] **Step 1:** Create `QueryClient` with defaults from backend design §6.2: `staleTime: 30_000`, `gcTime: 5 * 60_000`, retry only on status ≥ 500 (max 2), `mutations.retry: 0`, `refetchOnWindowFocus: true`.
- [ ] **Step 2:** Wrap the tree in `QueryClientProvider` (+ optional Devtools in DEV).
- [ ] **Step 3:** Add typed `queryKeys` builders returning hierarchical arrays per §6.1 even if unused — so Phase 4 does not invent inline keys. Commit.

### Task 3.5: Port `components/ui/*` + shared presentational tree

**Source:** repo-root `components/{ui,mun,marketplace,dashboard,organizer,registration,shared,layout}/**`

- [ ] **Step 1:** Copy `components/ui/*` (15 primitives) into `web/src/components/ui/`. Fix imports (`@/lib/utils` → local `cn`).
- [ ] **Step 2:** Mechanical swap table (backend §5.4):

  | Next | Vite replacement |
  |---|---|
  | `next/link` `<Link href>` | `react-router` `<Link to>` |
  | `useRouter().push()` | `useNavigate()` |
  | `usePathname()` | `useLocation().pathname` |
  | `useSearchParams()` | RR `useSearchParams()` (tuple) |
  | `next/image` | `<img loading="lazy" width height>` |
  | `next/font` | already handled in CSS |

- [ ] **Step 3:** Port shared non-page components that public routes need first (`SiteHeader`/`Footer`, marketplace cards, mun status badge, etc.). Leave organizer/admin-only deep trees for Phases 5–6 if they block — but prefer one pass for `ui/` + marketplace/mun.
- [ ] **Step 4:** Grep `web/src` for `next/` — must be zero. Commit.

### Task 3.6: Build public routes with mock data (no API)

**Mocks:** `web/src/mocks/muns.ts` — use real `Date` for `startDate`/`endDate`/`deadline`.

- [ ] **Step 1 — Root layout:** Port SiteHeader/Footer, ThemeProvider, Sonner toaster from `app/layout.tsx` into `root-layout.tsx`. Add `HelmetProvider` + default title template.
- [ ] **Step 2 — Homepage `/`:** Port JSX from `app/page.tsx` against mocks. `react-helmet-async` title. Preserve signature-card composition (DESIGN-airtable).
- [ ] **Step 3 — Marketplace `/muns`:** Port `app/muns/page.tsx`. URL query params (`?q&city…`) remain source of filter state (backend §5.2).
- [ ] **Step 4 — Mun detail `/mun/:slug`:** Port `app/mun/[slug]/page.tsx`. Missing slug → 404 via `errorElement` / not-found pattern.
- [ ] **Step 5 — Login `/login`:** Port `app/login/page.tsx`. Preserve `?redirect=`. **Open-redirect hardening:** only allow relative same-origin paths (no `//`, no backslash bypass) — carry forward the fix already in the Next login.
- [ ] **Step 6:** RTL smoke: one test per public route renders shell with mocked Query data / props. `vite build` + `tsc` clean. Commit.

### Task 3.7: Typed API client + queryKeys wiring + date reviver (BLOCKED on Phase 1/2)

**Unblock when:** Phase 1 lands (`lib/actions` explicit session) and Phase 2 exposes at least marketplace + auth session routes under `/api/v1`.

**Files:** `web/src/api/client.ts`, `web/src/api/date-reviver.ts`, `web/src/api/muns.ts`, `web/src/api/auth.ts`

- [ ] **Step 1:** `client.ts` — `credentials: 'include'`, base `/api/v1`, typed error mapping. Cookie session placeholder (bearer swap = one interceptor later).
- [ ] **Step 2:** Date reviver allowlist suffix `At` / `Date` / `deadline` (§6.6). Unit test: ISO in → `Date` out; non-allowlisted ISO-looking string stays string.
- [ ] **Step 3:** Idempotency-Key helper — generate once per user intent (`useRef` UUID), inject on mutations that need it (`initiateRegistration`, `publishFromQueue`, …). Document which endpoints require it.
- [ ] **Step 4:** Domain modules import **types only** from `lib/actions` / `lib/types`. Lint ban on value imports.
- [ ] **Step 5:** Replace homepage/marketplace/detail mocks with real `useQuery` keyed via `queryKeys`. Invalidation map stub for later mutations (§6.3).
- [ ] **Step 6:** Integration smoke against local Hono (manual or Vitest with MSW) for `GET /muns` and `GET /muns/:slug`. Commit.

### Task 3.8: Reverse-proxy / strangler note (coordinate with backend)

- [ ] **Step 1:** Document local-dev proxy choice (Vite `server.proxy` `/api` → Hono; optional Caddy for path-split Next vs SPA). Decision depends on deploy target — do not hardcode Cloudflare-only config.
- [ ] **Step 2:** Phase 3 production exit (parent plan): public routes served by SPA; everything else still Next. Frontend delivers built assets; backend/infra owns edge routing. Capture the chosen split in `web/README.md`.

**CHECKPOINT — Phase 3:** public marketplace on the SPA with visual parity; cookies/CORS validated on real traffic once proxy is up; authenticated trees still placeholders or still on Next.

---

## Phase 4 — Authenticated Read-Heavy Routes (outlined)

**Exit:** students fully on the new stack (dashboard, register funnel, support).

### Task 4.1: Session hook + guards (UX only)

- [ ] `useSession()` → `useQuery(queryKeys.session(), …)` with `staleTime: Infinity`; invalidate only on sign-in/sign-out (`queryClient.clear()` on auth change — §6.3).
- [ ] `RequireAuth` — redirect `/login?redirect=`; **while `isPending`, render skeleton, never redirect** (§5.3).
- [ ] `RequireRole` — 403 page, not login loop.
- [ ] Comment in every guard: client guards are UX only; server enforces.

### Task 4.2: Student dashboard

- [ ] Port `app/dashboard/page.tsx` → `useQuery` for upcoming/past registrations.
- [ ] Lift loading skeletons from existing `loading.tsx`.

### Task 4.3: Registration funnel (highest correctness risk)

- [ ] Port `/register/:slug`, `/pay`, `/confirmation` under `RegisterLayout` + `RequireAuth`.
- [ ] Idempotency key once per confirm-dialog intent (§6.4).
- [ ] Availability: `staleTime: 0`, `refetchInterval: 15_000` while funnel open.
- [ ] All mutations `retry: 0`.
- [ ] Treat `409 CONFLICT_ACTIVE_SUBMISSION`-shaped errors as probable success → refetch-and-check.
- [ ] Never trust client `userId` in initiate payload — session cookie only.

### Task 4.4: Support intake

- [ ] Port `/support/new` form to `useMutation` → `POST` support ticket endpoint.

**CHECKPOINT — Phase 4:** student flows work end-to-end against Hono; Next still serves organizer/admin if strangler not fully cut.

---

## Phase 5 — Organizer Workspace (outlined; largest)

**Exit:** organizers fully migrated.

### Task 5.1: Nested layouts + MunSwitcher

- [ ] Pathless `WorkspaceLayout` (Next `(workspace)` analogue).
- [ ] `MunWorkspaceLayout` with sidebar + MunSwitcher for `/:munId/*`.
- [ ] 17 section routes (setup, committees, products, accommodation, form, executive-board, documents, registrations, finance, analytics, team, results, certificates, communications, conference-day, settings, overview) — §5.2.

### Task 5.2: Module CRUD (optimistic OK)

- [ ] Port committee/portfolio/product/etc. editors.
- [ ] Optimistic updates allowed for simple CRUD; invalidate `[mun, munId]` prefix on settle (§6.3 — over-invalidate on purpose).

### Task 5.3: Onboarding / go-live pipeline UI (no optimism)

- [ ] Render wizard **from** `getMunProgress` / `mun.status` — never local `currentStep`.
- [ ] `{passed:false, blockers:[]}` → success-shaped UI with blocker list, not error toast.
- [ ] Forbidden: optimistic `PUBLISHED`.
- [ ] Retire UI calls to `submitMunForVerification`; call `submitFinalConfirmation` / `submitMunForReview` per new contract. Coordinate shim deletion with backend.

### Task 5.4: Payment settings write UX

- [ ] Masked fields only; never display ciphertext. Align with write-only encryption rule.

**CHECKPOINT — Phase 5:** organizer workspace parity; lifecycle transitions correct under double-click / slow network.

---

## Phase 6 — Admin Console (outlined)

**Exit:** all traffic on the SPA (pending Phase 7 Next removal).

### Task 6.1: Admin shell + existing 9 routes

- [ ] `AdminLayout` + `RequireRole` for OPERATIONS|ADMIN|SUPER_ADMIN.
- [ ] Port: home, review, verification, organizers, payments, support, registrations (`?q=`), audit, audit/:targetType/:targetId.
- [ ] Queues: `staleTime: 0`; pagination via `limit`/`offset` + `placeholderData: keepPreviousData` — **not** infinite query (§6.5).

### Task 6.2: NEW `/admin/go-live-queue`

- [ ] Wire `getGoLiveQueue` (already tested in backend; no UI today). Connectivity rule: endpoint without UI is dead — this is the one net-new surface in the migration.
- [ ] `staleTime: 0` (SLA computed on read).

### Task 6.3: Hardening pass

- [ ] Mutation → invalidation map complete for admin actions (§6.3).
- [ ] Adversarial / red-team review on guards + open redirects + registration (no Semgrep).
- [ ] Visual pass vs DESIGN-airtable on admin tables (dense but editorial, not purple SaaS).

**CHECKPOINT — Phase 6:** SPA serves all product traffic behind the proxy; ready for joint Phase 7 (retire Next).

---

## Phase 7 — Retire Next (joint; not owned solely here)

Listed for awareness only — execute with backend peer after Phase 6 is stable in production:

- Remove `app/`, Next config, OpenNext/wrangler scaffolding, framework deps.
- Collapse reverse proxy if topology simplifies.
- Update `CLAUDE.md` / README / root scripts.
- Verify no remaining Next import surface outside historical docs.

---

## Verification cheatsheet (every Phase 3+ commit)

```bash
cd /Users/psoma/Projects/mun-hub/.claude/worktrees/vite-frontend-migration/web
npx tsc -b
npx vitest run   # once tests added
npx vite build
# rg "from ['\"]next" src/   → empty
# no value imports from @/lib under web/src
```

---

## Self-review notes

- Phase 3 is expanded to SDD-style tasks because the parent plan deliberately left Phases 3–6 as coordination outlines for this session to flesh out.
- SEO prerender (backend §7) is **out of `/web` scope** — called out so agents do not reintroduce Vite SSR contrary to the corrected frontend design.
- Highest frontend risk items: registration idempotency (4.3), lifecycle non-optimism (5.3), `revalidatePath` → `invalidateQueries` completeness (5.x/6.x), open-redirect on login (3.6).
- Prep commit must not port `app/` pages — that starts at Task 3.6 after Task 3.1–3.5, and real API wiring waits for Phase 1.
