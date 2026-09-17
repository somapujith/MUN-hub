# Actions only the user can take

Collected during the autonomous run (2026-09-17). Each item was blocked by a permission rule,
needs an account-level decision, or needs a credential the agents must not handle.

## 1. Critical — shared demo credentials are live in production

Verified read-only against production Neon at 08:58 IST:

- `admin@munhub.test` (the **only** staff account in production) and
  `student@munhub.test` + 8 `organizer-*@munhub.test` accounts all have a password hash,
  and that password (`munhub-demo`) is written in the repo (E2E fixtures, CLAUDE.md).
- The run tried to rotate the admin password and disable the other demo logins; the auto-mode
  permission classifier blocked it (writing a new admin credential to a local file counts as a
  secret-store write). Nothing was changed.

What to do (in order):
1. Create a real super-admin for yourself with the bootstrap script added in this run
   (`scripts/create-admin.ts`, see its header; it prints a set-password link and refuses a
   remote database unless `ALLOW_REMOTE_ADMIN_BOOTSTRAP=true`).
2. Sign in with it, then disable the demo accounts — either:
   - set `password_hash = NULL` for every `%@munhub.test` user in production and delete their
     sessions, or
   - suspend them from the admin console (Staff / Organizers pages).
3. Rotate `munhub-demo` out of anything that could reach production.

## 2. File storage (R2)

R2 is not enabled on the Cloudflare account (`wrangler r2 bucket list` → error 10042). This run
ships a Workers KV-backed upload store as the interim production store (≤ 25 MiB per file).
Enable R2 in the Cloudflare dashboard when convenient; the R2 adapter is already written and
takes over automatically once an `UPLOADS_BUCKET` binding is added.

## 3. Payment gateway

Integrate Razorpay by following `docs/payments/INTEGRATION.md`. Until then, paid checkout in
production shows "Online payments aren't available yet" (the mock checkout only runs where
`MOCK_PAYMENTS_ENABLED=true`, i.e. local dev and tests).

## 4. Business confirmations

- Contact mailboxes and policy dates in `web/src/lib/site-info.ts`; a named Grievance Officer.
- Platform fee rate (`PLATFORM_FEE_BPS`, default 0) and GST rate (`PLATFORM_FEE_TAX_BPS`, default
  1800) on the `munhub-api` Worker.
- Legal review of Terms / Privacy / Refund policy.

## 5. Uploads KV namespace (needed for real uploads in production)

The deploy token can list but not create KV namespaces (`Authentication error [code: 10000]`).
With a token that has **Workers KV Storage: Edit** (or in the dashboard), run
`cd server && npx wrangler kv namespace create munhub-uploads`, then uncomment the
`kv_namespaces` block in `server/wrangler.jsonc` with the printed id and redeploy
`munhub-api`. Until then production uploads use the mock store (files are not kept) and the
Worker logs `[storage] No UPLOADS_BUCKET or UPLOADS_KV binding in production`.
The existing `RATE_LIMIT_KV` namespace on the account is not referenced by this repo (it may
belong to another project), so it was deliberately not reused.

## 6. Product decision — a live MUN re-checked after a high-impact edit

Today a high-impact edit (dates, venue, prices, capacity, …) on a live conference moves it back to
VERIFICATION, which removes it from the marketplace and pauses registration until the review
passes (the organizer's Setup page now warns about this). Alternative: keep the last verified
version listed while the change is reviewed (needs the published page to render from
`mun_versions`). Decide which behaviour you want.

## 7. Decision — organizer team access (co-organizers)

The organizer "Team" page is still a placeholder: only the MUN's owner can manage it. A scoped
design is ready to build (OWNER / EDITOR / VIEWER roles, email invitations, one central
`assertMunAccess` check replacing `assertOwnsOrAdmin` at every organizer call site, staff keep
full access). It was not built because CLAUDE.md lists "team & permissions / sub-organizer
roles" as deferred — do not build without asking. Say the word and it can be scheduled
(needs one migration).
