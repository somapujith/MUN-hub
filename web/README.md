# MUN Hub web app (`/web`)

The MUN Hub single-page app: marketplace, delegate area, organizer workspace and admin console, all in one Vite build. In production it's served by the Cloudflare Worker `munhub-web` (`app.`, `publish.`, `organize.`, `admin.` and `*.munhub.in`) and by Vercel (`munhub.in`, `www`).

## Stack

| Layer | Choice |
|---|---|
| Bundler | Vite 8 |
| UI | React 19 + TypeScript |
| Routing | React Router v7 in data-router mode (`createBrowserRouter`, `src/routes.tsx`). No loaders for data fetching. |
| Server state | TanStack Query v5; API clients in `src/api/*`, query keys in `src/api/query-keys.ts` |
| Styling | Tailwind CSS v4 with the tokens in `src/index.css`, components in `src/components/ui` (design reference: `docs/prd/DESIGN-airtable.md`) |
| Head | react-helmet-async |
| Theme | next-themes (framework-agnostic despite the name) |

## Hosts

Every host serves the same bundle. `src/lib/host-routing.ts` decides what a hostname means: `app.` is the delegate area, `publish.` the organizer workspace (`organize.` is an alias), `admin.` the admin console, any other `*.munhub.in` label a MUN's own page, and everything else, including localhost, the marketplace with plain path routing. Links that change zone must be full navigations (`<a href>`); React Router can't cross origins.

## Rules

- Client-side rendering only. There's no SSR entry.
- Route guards (`src/guards`) are for UX only. The API's session cookie decides who can do what. Never trust a client-side user id or role.
- Only type imports may come from the repo-root `lib/`. Never bundle runtime `lib/` code (database, crypto) into the browser.
- API calls go to `VITE_API_URL` (default `http://localhost:3001/api/v1` in development, `https://api.munhub.in/api/v1` in production builds) with `credentials: 'include'`.
- `cn()` (the `cn` package) drops custom text-size tokens such as `text-body-md` when a text colour class follows. Don't combine the two through `cn()`.

## Develop

```bash
npm ci
npx vite                      # http://localhost:5174, expects the API on :3001
```

Start the API from `server/` first (see `server/README.md`) and make sure it trusts `http://localhost:5174`: `ALLOW_LOCALHOST_ORIGINS="true"` (as in `.env.example`) or an explicit `CORS_ORIGINS` entry.

## Check and build

```bash
npx tsc -b --noEmit           # typecheck (also: npm run typecheck)
npx oxlint                    # lint (config: .oxlintrc.json)
npx vite build                # production bundle in dist/
```

## Deploy

```bash
VITE_API_URL=https://api.munhub.in/api/v1 npx vite build
npx wrangler deploy --env=""
```

Production deploys normally go through the **Deploy (production)** GitHub Actions workflow (`docs/operations/RUNBOOK.md`). For staging (`--env staging`, built against the staging API), see `docs/operations/ENVIRONMENTS.md`.
