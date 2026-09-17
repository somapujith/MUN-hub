# Autonomous run — plan and lane ownership

Run window: 2026-09-17, ~08:20 → ~14:20 IST. The user is away. Lead session: **mun-hub-62**.
Source of the work list: the end-to-end + security audit delivered in mun-hub-62 just before
this run (summary in `CONTEXT.md` → "Audit summary").

## Decisions from the user (binding for every lane)

1. **No refunds anywhere in the product.** Payment *errors* (money taken with no registration
   behind it — late payment after the seat hold, double charge, technical error) are
   recorded as payment exceptions and resolved manually by an admin. No refund state machine,
   no refund buttons, no "Refund" support category in the UI.
2. **The real payment gateway is integrated by the user at the end.** Build a clean adapter
   seam and docs; the mock adapter is for dev/test only and is gated behind
   `MOCK_PAYMENTS_ENABLED=true`.
3. **Pushes and production deploys are allowed** — performed only by the lead (mun-hub-62),
   only from a verified commit, from a clean worktree.
4. Platform fee exists (configurable `PLATFORM_FEE_BPS` + GST); it is non-refundable.

## Lanes

| Lane | Owner | Scope (files) |
|---|---|---|
| Tests | mun-hub-84 | `E2E/**`, new test files for other lanes. Only session that runs the full E2E suite. |
| Organizer go-live unblockers | mun-hub-f1 | Organizer workspace pages except settings/finance/communications/registrations/conference_day/results; setup fields, portfolios UI, accommodation "not provided", branding upload, module confirm + progress UX + lock banner, reviewer notes, draft preview, multi-MUN organizers. |
| Email & notifications | mun-hub-4b | `lib/notifications/**`, email verification, delegate emails, Gate-1 decision emails, unsent pipeline events, SLA_DELAY job export. |
| Payments (gateway-ready) | mun-hub-62 agent `payments` | `lib/payments/**`, `server/routes/webhooks.ts`, `server/routes/registrations.ts`, `lib/actions/registration.ts`, `web/src/pages/register/**`, admin payments page, organizer finance page. |
| Security A — auth | mun-hub-62 agent `sec-auth` | `lib/auth/**`, `lib/actions/auth.ts`, `lib/actions/password-reset.ts`, `server/routes/auth.ts`, `server/routes/password-reset.ts`, rate limiting (`server/lib/rate-limit-store.ts`, `server/middleware/rate-limit.ts`), `web/src/lib/redirect.ts`, `lib/crypto/**`, `lib/db/seed*.ts` guard. |
| Security B — edge | mun-hub-62 agent `sec-edge` | Security headers (API + web worker + Vercel), CORS/CSRF allowlist (`server/src/app.ts`, `server/middleware/csrf.ts`), body limit, published-or-owner guards on by-id public reads (contact, documents, committees, schedule, media, accommodation, form-fields), `server/routes/sitemap.ts` env fix. |
| Admin console | mun-hub-62 agent `admin` | `web/src/pages/admin/**` (except payments-page), admin nav, `server/routes/admin-*.ts`, `lib/actions/admin-*.ts`, `lib/actions/organizer-admin.ts`. |
| Registration lifecycle | mun-hub-62 agent `lifecycle` | Open/close registration, start/complete/cancel/archive (lib + route + organizer `settings-page.tsx`). |
| Marketplace & MUN page | mun-hub-62 agent `marketplace` | `web/src/pages/{home,muns,mun-detail,not-found}-page.tsx`, marketplace components, `lib/actions/marketplace.ts`, `server/routes/muns.ts`, FAQ route, SEO files. |
| Privacy | mun-hub-62 agent `privacy` | Account deletion + data export (`lib/actions/account.ts`, `server/routes/account.ts`, profile page danger zone), guardian consent UI. |
| Organizer operations | mun-hub-62 agent `org-ops` | `communications-page.tsx`, `registrations-page.tsx` + roster backend, `conference_day-page.tsx` check-in, `results-page.tsx` publishing, delegate MUN pass page. |
| DevOps | mun-hub-62 agent `devops` | `.github/**`, root scripts/tsconfig, `server/src/worker.ts` scheduled handler + `lib/jobs/**`, wrangler environments/crons, READMEs, `.env.example`, `docs/operations/**`, dead-code removal. |

Shared files (`web/src/routes.tsx`, `server/src/app.ts`, `lib/db/schema.ts`, wrangler files):
lead-agent lanes work in isolated worktrees and the lead resolves merge conflicts; sessions in
the shared tree commit only their own hunks.

## Migration slots (serialized — one open at a time)

| Slot | Holder | Purpose | Status |
|---|---|---|---|
| 0030 | mun-hub-f1 | organizer_applications uniqueness for multi-MUN organizers | committed ba44e79 |
| 0031 | mun-hub-62 | payments fee breakdown, exceptions, webhook events, registration idempotency key | committed 3b122be |

Lead-agent lanes must not add migrations without a slot from the lead.

## Integration & release gates (lead)

1. Merge each lane branch into `main`; resolve conflicts.
2. `web`: `tsc -b --noEmit`, `oxlint`, `vite build`. `server`: `tsc --noEmit`. Root: vitest
   (`--no-file-parallelism`) against local Docker.
3. mun-hub-84 runs the E2E suite; failures routed to the owning lane.
4. Adversarial review workflow on the integrated diff (security + correctness).
5. Push `main`; deploy `munhub-api` and `munhub-web` from a clean worktree at the verified
   commit; apply additive migrations to Neon; set new Worker vars/secrets.
6. Compile `docs/autonomous-run/CHANGELOG.md`; update `CLAUDE.md`.
