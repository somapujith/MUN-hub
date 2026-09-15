# MUN Hub — Feature Status by Persona

**Date:** 2026-09-15  
**Repo:** `/Users/psoma/Projects/mun-hub` (`main` @ merge of Vite/Hono migration worktrees)  
**Audience:** Product + engineering — what each persona can use today vs what is still incomplete.

---

## How to read this document

| Status | Meaning |
|--------|---------|
| **DONE** | Works end-to-end on the **Next.js** production path (`app/` + `lib/` + live DB) |
| **PARTIAL** | Backend and/or UI exists but incomplete (placeholder page, mock SPA only, missing mutations, stale labels, etc.) |
| **MISSING** | Needed for MVP or go-live UX but not built |
| **DEFERRED** | Explicitly out of current MVP / Phase 2+ (do not build without asking) |

### Runtime reality (important)

| Surface | Role today |
|---------|------------|
| **Next.js `app/`** | **Primary working product** — real sessions, DB, Server Actions |
| **Hono `server/`** | Standalone API (Phases 0–2) — routes + integration tests exist; **not yet the UI’s data source** |
| **Vite `web/`** | SPA shells (Phases 3–6) — **mock data only**; no typed API client (`web/src/api/client.ts` still missing) |

Until Phase 7 cutover, **demo and ship against Next.js**. Vite is a UI rehearsal.

---

## Quick scoreboard

| Persona | DONE (usable now) | PARTIAL | MISSING / DEFERRED |
|---------|-------------------|---------|---------------------|
| **User (Student)** | Marketplace, register→pay→confirm, dashboard, support create | Mock auth, SEO depth, initiate idempotency key | Signup, profile edit, MUN Pass / Passport / reviews (deferred) |
| **Organizer** | Apply, workspace, setup basics, committees/portfolios, products, accommodation, roster read, Gate 3 confirm | Branding/contact/schedule/docs/EB/form/finance UI; go-live progress UI | Team, analytics, QR day, results, certificates, roster mutations, real payouts |
| **Admin** | Gate 1 review, module verification (legacy 4), search regs, payment exceptions list, organizers suspend, support, audit | Module labels for 15 modules; Vite mocks | Gate 2 submission UI, go-live queue UI (Next), refunds, settlement verify UI |

---

# 1. User (Student / Delegate)

## 1.1 Completed (DONE)

| Feature | Notes | Evidence |
|---------|-------|----------|
| Home marketplace | Live search/facets, filters, shelves | `app/page.tsx`, `lib/actions/marketplace.ts` |
| Browse `/muns` | Search, filters, sort, pagination | `app/muns/page.tsx` |
| MUN detail `/mun/[slug]` | Public MUN card, committees, products, seat counts, Register CTA | `app/mun/[slug]/page.tsx` |
| Sitemap + robots | Dynamic public slugs; private routes disallowed | `app/sitemap.ts`, `app/robots.ts` |
| Login + session cookie | Passwordless mock email lookup; httpOnly cookie | `app/login/`, `lib/auth/session.ts`, `lib/actions/auth.ts` |
| Sign-out | Destroys session + clears cookie | `app/actions/session.ts` |
| Registration initiate | Auth-gated form; capacity row-lock; no client `userId` | `app/register/[slug]/`, `lib/actions/registration.ts` |
| Capacity / anti-oversell | Concurrent registration tests; duplicate-active reject | `lib/actions/registration.test.ts` |
| Payment (mock) | Mock Razorpay + webhook confirm path | `app/register/[slug]/pay/`, `app/api/webhooks/payments/`, `lib/payments/mock-adapter.ts` |
| Confirmation page | Owner-only registration status | `app/register/[slug]/confirmation/` |
| Student dashboard | Upcoming vs past registrations | `app/dashboard/page.tsx`, `lib/actions/student-dashboard.ts` |
| Create support ticket | Auth-gated intake | `app/support/new/`, `lib/actions/support.ts` |

## 1.2 Partial

| Feature | What’s done | What’s left |
|---------|-------------|-------------|
| **Auth security** | Works for local demo | Passwordless = admin-takeover risk if exposed; real OAuth/password **DEFERRED** behind adapter |
| **Account creation** | Seeded users only | No signup UI/route (PRD §28 lists account creation) |
| **SEO metadata** | Title + description on detail | Open Graph image, JSON-LD, canonicals not done |
| **Initiate idempotency** | Hono requires `Idempotency-Key` header; duplicate-registration guard | Key not stored/replayed; Next funnel does not send key |
| **Vite student routes** | Full funnel UI shells | Still mock (`web/src/mocks/*`); no Hono client |

## 1.3 Missing

| Feature | Notes |
|---------|-------|
| Signup / account creation | No `/signup` or create-user student flow |
| Profile manage page | Schema fields exist; no `/profile` edit UI |
| Student sign-out on Vite | Placeholder no-op until API wiring |
| Real payment gateway | Razorpay confirmed as future provider; mock only today |

## 1.4 Deferred (Phase 2+)

| Feature | Source |
|---------|--------|
| MUN Pass / QR pass | PRD §28 named; plans/CLAUDE explicitly defer |
| MUN Passport | PRD §10 / §29 |
| Student certificates download | Schema scaffold only |
| Reviews / ratings | Phase 2 |
| Recommendations / saved MUNs | Phase 2 |
| Achievements / public student profiles | Phase 2 |

## 1.5 User module checklist (MVP intent)

- [x] Browse conferences  
- [x] View conference detail  
- [x] Sign in (mock)  
- [x] Register + hold seat + pay (mock) + confirm  
- [x] See my registrations  
- [x] Open a support ticket  
- [ ] Create account without seed  
- [ ] Edit profile  
- [ ] Real auth + real payments  
- [ ] MUN Pass / certificates / Passport *(deferred)*  

---

# 2. Organizer

## 2.1 Completed (DONE) — Next.js

| Feature | Notes | Evidence |
|---------|-------|----------|
| Organizer application (Gate 1 submit) | Apply form + submitted screen | `app/organizer/apply/` |
| Application status on overview | Under-review empty states | `app/organizer/dashboard/(workspace)/page.tsx` |
| Workspace shell | Auth layout, sidebar, 16-section nav | `app/organizer/dashboard/layout.tsx`, `nav-config.ts` |
| MUN switcher | Real owned-MUN list | `components/organizer/mun-switcher.tsx` |
| Overview + My MUNs | Aggregates (no GMV) | `(workspace)/page.tsx`, `muns/page.tsx` |
| Basic info + dates/venue | Setup General + Dates forms | `…/setup/` + `setup-forms.tsx` |
| Committees | Full CRUD board | `…/committees/` |
| Portfolios | Under committees (by design) | same |
| Registration products | Types + pricing + capacity + deadline | `…/products/` |
| Accommodation options | Full CRUD | `…/accommodation/` |
| Registrations roster (read/filter) | Delegate list | `…/registrations/`, `getDelegateList` |
| Gate 3 final confirmation panel | `submitFinalConfirmation` | `final-confirmation-panel.tsx`, `lib/lifecycle/organizer-confirmation.ts` |

## 2.2 Fifteen MODULE_REGISTRY modules

Tracked in `lib/lifecycle/module-registry.ts`. Backend completion/verification axes exist; **organizer “Get Your MUN Live” checklist UI is still missing**.

### CONTENT

| Module key | Backend | Organizer UI (Next) | Status |
|------------|---------|---------------------|--------|
| `BASIC_INFO` | `updateMunDetails` | Setup → General | **DONE** |
| `DATES_VENUE` | same | Setup → Dates & venue | **DONE** |
| `BRANDING` | `lib/actions/mun-branding.ts` | Setup tab placeholder | **PARTIAL** |
| `COMMITTEES` | mun-config | Full UI | **DONE** |
| `PORTFOLIOS` | mun-config | Via committees UI | **DONE** |
| `EXECUTIVE_BOARD` | `executive-board.ts` | `ModulePlaceholder` | **PARTIAL** |
| `CONTACT` | `mun-contact.ts` | Setup Contact placeholder | **PARTIAL** |

### COMMERCE

| Module key | Backend | Organizer UI (Next) | Status |
|------------|---------|---------------------|--------|
| `REGISTRATION_TYPES` | products | Products page | **DONE** |
| `REGISTRATION_FORM` | `registration-form.ts` (fields, reorder, conditionals) | Form page placeholder | **PARTIAL** |
| `PRICING_CAPACITY` | product fields | Products page | **DONE** |
| `PAYMENT_SETTLEMENT` | encrypted write-only settings | Finance placeholder; real payout **DEFERRED** | **PARTIAL** |

### OPERATIONS

| Module key | Backend | Organizer UI (Next) | Status |
|------------|---------|---------------------|--------|
| `RULES_DOCUMENTS` | `mun-documents.ts` | Documents + Setup Rules placeholders | **PARTIAL** |
| `SCHEDULE` | `mun-schedule.ts` | Setup Schedule placeholder | **PARTIAL** |
| `ACCOMMODATION` | `accommodation.ts` | Full UI | **DONE** |

### FINAL

| Module key | Backend | Organizer UI (Next) | Status |
|------------|---------|---------------------|--------|
| `FINAL_REVIEW` | validators + confirmation / go-live | Gate 3 panel only; no 15-module progress UI | **PARTIAL** |

## 2.3 Go-live / verification (organizer-facing)

| Feature | Backend | UI | Status |
|---------|---------|-----|--------|
| Per-module `confirmModule` | `lib/lifecycle/module-verification.ts` | No organizer UI | **PARTIAL** |
| `getMunProgress` checklist | `lib/actions/go-live-dashboard.ts` + Hono | **No** Next/Vite consumer | **MISSING** (UI) |
| `submitMunForReview` (15-module auto validation) | `lib/lifecycle/go-live.ts` + Hono | UI still Gate-3-only path | **MISSING** (UI) |
| Gate 3 `submitFinalConfirmation` | lifecycle | Panel on setup | **DONE** (narrow path) |
| FAQs setup tab | — | Placeholder only | **MISSING** |

## 2.4 Partial / placeholder nav sections (Next)

| Section route | Status | Notes |
|---------------|--------|-------|
| Executive Board | **PARTIAL** | Backend CRUD; UI placeholder |
| Registration form builder | **PARTIAL** | Backend done; UI placeholder |
| Finance | **PARTIAL** | Backend payment settings; UI placeholder |
| Documents | **PARTIAL** | Backend; UI placeholder |
| Communications | **MISSING / DEFERRED** | Placeholder; console email only |
| Conference day / QR | **DEFERRED** | Phase 2 |
| Results & awards | **DEFERRED** | Phase 2 |
| Certificates | **DEFERRED** | Phase 2 |
| Analytics | **DEFERRED** | Phase 2 |
| Team & permissions | **DEFERRED** | Deliberate omission (`mun_team_members`) |
| Settings | **MISSING** | Placeholder |

## 2.5 Registrations management — remaining

| Capability | Status |
|------------|--------|
| View / filter roster | **DONE** |
| Assign committee / portfolio | **MISSING** |
| Cancel / refund registration | **MISSING** |
| Export CSV | **MISSING** |

## 2.6 Vite organizer SPA

| Area | Status |
|------|--------|
| Routes + workspace chrome | Presentational shells |
| Apply form | Disabled mock |
| All `:munId/*` sections | `MunSectionShell` — “API wiring deferred” |
| Real Hono queries/mutations | **MISSING** |

## 2.7 Organizer checklist (MVP + go-live)

- [x] Apply to run a MUN  
- [x] Workspace + switch MUN  
- [x] Edit basic info + dates/venue  
- [x] Committees + portfolios  
- [x] Registration products (type/price/capacity)  
- [x] Accommodation inventory  
- [x] View registrations  
- [x] Gate 3 confirmation snapshot  
- [ ] Branding / contact / schedule / documents UI  
- [ ] Executive board UI  
- [ ] Registration form builder UI  
- [ ] Payment settlement settings UI  
- [ ] **Get Your MUN Live** progress + `submitMunForReview`  
- [ ] Roster mutations (assign / cancel / export)  
- [ ] Team / analytics / communications / QR / results / certificates *(mostly deferred)*  

---

# 3. Admin / Operations

**Roles:** `OPERATIONS` | `ADMIN` | `SUPER_ADMIN`  

**Gate vocabulary (do not confuse):**

- **Gate 1** = organizer *application* — statuses `SUBMITTED` / `UNDER_REVIEW` / `APPROVED`… → `reviewMunApplication`  
- **Gate 2** = MUN *content* review — statuses `VERIFICATION` / `VERIFIED` / `ACTION_REQUIRED`… → `reviewSubmission` / module review  
- `mun.status === 'UNDER_REVIEW'` **always means Gate 1**

## 3.1 Completed (DONE) — Next.js

| Feature | Notes | Evidence |
|---------|-------|----------|
| Admin layout + role gate | Nav for overview, apps, verification, regs, payments, organizers, support, audit | `app/admin/layout.tsx` |
| Overview dashboard | Live counts: Gate 1 apps, module reviews, NEW tickets, payment exceptions | `app/admin/page.tsx` |
| Gate 1 review queue | Decide APPROVED / REJECTED / CHANGES_REQUESTED | `app/admin/review/`, `lib/actions/admin-review.ts` |
| Module verification console | Review `PENDING_REVIEW` modules | `app/admin/verification/`, `reviewModule` |
| Registration search | Name / MUN / ids | `app/admin/registrations/`, `searchRegistrations` |
| Payment exceptions list | FAILED or paid≠confirmed (read-only) | `app/admin/payments/`, `listPaymentExceptions` |
| Organizers list + suspend/reinstate | Account login block | `app/admin/organizers/`, `organizer-admin.ts` |
| Support ticket queue | Assign self + resolve | `app/admin/support/` |
| Audit log + detail | Flat feed + per-target history | `app/admin/audit/` |
| Hono admin routes | Mirror of above + go-live | `server/routes/admin-*.ts`, `go-live.ts`, etc. |

## 3.2 Partial

| Feature | What’s done | What’s left |
|---------|-------------|-------------|
| Module verification labels | Works for **4 legacy** keys (`mun_details`, `committees`, `portfolios`, `registration_products`) | Expand UI labels to all **15** PRD modules |
| Publish / suspend buttons on Gate 1 row | Code exists | Unreachable — Gate 1 queue never loads publishable statuses; `canPublish` stale vs `VERIFIED` requirement |
| Payment exceptions | List only | No force-confirm / refund / resolve actions |
| Vite admin console | Full route map + mock tables | No API wiring; go-live page is mock-only |

## 3.3 Missing (needed for go-live ops)

| Feature | Backend | Next UI | Vite UI |
|---------|---------|---------|---------|
| Gate 2 mun-level `reviewSubmission` console | **DONE** (`go-live.ts`) | **MISSING** | **MISSING** |
| Go-live queue page | **DONE** (`getGoLiveQueue`) | **MISSING** (not in nav) | **PARTIAL** mock only |
| Publish from queue (`publishFromQueue` + Idempotency-Key) | **DONE** | **MISSING** dedicated UX | **MISSING** action |
| Payment settlement bank-verify UI | **DONE** (`setPaymentVerificationState`) | **MISSING** | **MISSING** |
| Published / suspended MUN ops list | Actions exist | **MISSING** dedicated list | **MISSING** |
| Overview go-live depth | API exists | Not on overview cards | Mock card only |

## 3.4 Deferred

| Feature | Notes |
|---------|-------|
| Refunds console | Built then reverted; concurrency concerns |
| SLA delay / approaching notifications | Needs scheduler |
| Two-person approval for high-risk actions | Spec §9 |
| Real payout execution / penny-drop verify | Config write-only today |
| Real email delivery | Console adapter only |

## 3.5 Admin checklist

- [x] Gate 1 application review  
- [x] Module-level verification (legacy 4 labels)  
- [x] Search registrations  
- [x] View payment exceptions  
- [x] Suspend / reinstate organizers  
- [x] Support queue  
- [x] Audit history  
- [ ] Expand module console to 15 PRD modules  
- [ ] Gate 2 submission review UI (`reviewSubmission`)  
- [ ] Go-live queue + publish-from-queue UI on Next  
- [ ] Payment settlement verification UI  
- [ ] Refunds / remediation actions  
- [ ] Wire Vite admin to Hono  

---

# 4. Cross-cutting platform work (affects all personas)

| Workstream | Status | Notes |
|------------|--------|-------|
| Lib decoupled from Next (`getSessionByToken`, explicit session) | **DONE** | Phase 1 |
| Hono API skeleton + middleware (CSRF, rate limit, session, errors) | **DONE** | Phase 2.1 |
| Hono route coverage (muns, auth, registrations, go-live, admin, webhooks…) | **MOSTLY DONE** | Integration tests 10/10 for go-live slice |
| Trusted-parameter audit artifact | **DONE** | `docs/superpowers/artifacts/2026-09-15-trusted-parameter-audit.md` |
| Vite SPA public + auth + organizer + admin shells | **DONE** (mock) | Phases 3–6 UI |
| Typed API client + date reviver + lint ban on `lib/` value imports | **MISSING** | Task 2.3 / 3.7 |
| Vite ↔ Hono end-to-end | **MISSING** | Blocks “SPA is production” |
| Reverse proxy / dual-run Next+Vite | **MISSING** | Phase 3 exit criterion |
| Crawler prerender for SEO | **MISSING** | Spec §7 |
| Retire Next.js (`app/`, OpenNext, wrangler) | **NOT STARTED** | Phase 7 — only after SPA stable in prod |
| Real auth adapter | **DEFERRED** | Must block passwordless mock in public prod (`boot-guard`) |
| Real Razorpay | **DEFERRED** | Mock adapter only |

---

# 5. Recommended completion order (practical)

1. **Finish Next organizer module UIs** that already have backends (branding, contact, schedule, documents, EB, form builder, finance settings) — unblocks Gate 2 completeness.  
2. **Ship organizer Get-MUN-Live UI** (`getMunProgress` + `submitMunForReview`) and **admin go-live queue + Gate 2 review** — closes the largest trust-pipeline gap.  
3. **Expand admin module console** to 15 PRD module labels.  
4. **Wire Vite API client** to Hono; replace mocks for User → Organizer → Admin in that order.  
5. **Real auth + real payments** before any public internet deploy.  
6. **Phase 7** retire Next only after SPA is stable.

---

# 6. Source docs

| Doc | Path |
|-----|------|
| Project context | `CLAUDE.md` |
| Marketplace PRD (MVP §28) | `docs/prd/MUN_Marketplace_PRD.md` |
| Verification / confirmation | `docs/prd/MUNHub_Organizer_Modules_Verification_Confirmation_PRD.md` |
| Onboarding / go-live | `docs/prd/MUNHub_Organizer_Onboarding_Go_Live_Pipeline_PRD.md` |
| Module registry | `lib/lifecycle/module-registry.ts` |
| Migration design | `docs/superpowers/specs/2026-09-15-nextjs-to-react-spa-migration-design.md` |
| Frontend design | `docs/superpowers/specs/2026-09-15-vite-frontend-migration-design.md` |

---

*Generated 2026-09-15 from codebase audit of Next.js `app/`, Hono `server/`, Vite `web/`, and `lib/` actions/lifecycle.*
