# MUN Hub — Product & Module Analysis

**Date:** 2026-09-15
**Purpose:** Single-doc inventory of every module/feature/role in the product, current build state, and open gaps — for deciding what to build next. Not a status tracker (see `docs/planning/FEATURE_STATUS_BY_PERSONA.md` for that); this doc is organized for brainstorming, so it also flags things no PRD currently asks for.
**Source PRDs:** `docs/prd/MUN_Marketplace_PRD.md`, `MUNHub_Admin_Workflow_PRD.md`, `MUNHub_Client_Server_Rendering_PRD.md`, `MUNHub_Organizer_Dashboard_PRD.md`, `MUNHub_Organizer_Modules_Verification_Confirmation_PRD.md`, `MUNHub_Organizer_Onboarding_Go_Live_Pipeline_PRD.md`, `MUNHub_Organizer_Registration_Delegation_Management_PRD.md`, `MUNHub_Ultra_Fast_Performance_PRD.md`, `DESIGN-airtable.md`.

---

## How to read this

Every module gets: **what it is**, **build state**, **needs work on** (concrete next step). Status legend:

| Status | Meaning |
|---|---|
| 🟢 LIVE | Works end-to-end today on the Next.js production path |
| 🟡 PARTIAL | Backend exists, UI missing/placeholder — or vice versa |
| 🔴 NOT STARTED | Nothing built |
| ⚪ DEFERRED | Deliberately out of scope for now (documented reason) |
| ⚫ NOT SPECCED | No PRD covers this at all — flagged for your brainstorm, not a gap in delivery |

---

# Part 1 — Roles

## Student / Delegate
The person attending a MUN. Registers individually or as part of a delegation, gets assigned a committee/portfolio, pays, shows up.

## Head Delegate
A student who registers a group (school/college delegation). Manages invitations and member completion. **Role does not exist in the system yet** — no `roleEnum` value, no delegation-scoped authorization. Currently only a PRD concept (see Registration & Delegation PRD).

## Organizer
Runs a MUN — one organizer owns one MUN today (`muns.organizerId`, single FK, no team). Goes through Gate 1 (apply to host) → onboarding → Gate 2 (content review) → publish → runs the live conference.

## Operations / Admin / Super Admin
Platform staff. `OPERATIONS` < `ADMIN` < `SUPER_ADMIN` in the role enum, but authorization checks are inconsistent about where `OPERATIONS` is included (flagged below).

## ⚫ Not specced: sub-organizer / team roles
`mun_team_members` doesn't exist. Every MUN has exactly one owning organizer account — no co-organizers, no "treasurer can only see payments" style scoped roles. This is the single largest deliberate omission per CLAUDE.md, but worth surfacing here since it blocks any real-world MUN with more than one person running it.

---

# Part 2 — Modules (organizer-facing, the 15-module registry + beyond)

The system tracks 15 modules per MUN (`lib/lifecycle/module-registry.ts`), each with two independent axes: **completion** (has the organizer filled it in?) and **verification** (has MUNHub reviewed it?). Grouped by phase.

## CONTENT phase

| Module | Backend | UI | Status | Needs work on |
|---|---|---|---|---|
| Basic Info | `updateMunDetails` | Setup → General | 🟢 LIVE | — |
| Dates & Venue | same | Setup → Dates & venue | 🟢 LIVE | — |
| Branding | `lib/actions/mun-branding.ts` | Setup tab placeholder | 🟡 PARTIAL | Build the UI — backend already accepts logo/colors/etc |
| Committees | `mun-config.ts` | Full CRUD board | 🟢 LIVE | — |
| Portfolios | `mun-config.ts` (nested under committee) | Via committees UI | 🟢 LIVE | — |
| Executive Board | `executive-board.ts` | Placeholder | 🟡 PARTIAL | Build the UI |
| Contact | `mun-contact.ts` | Placeholder | 🟡 PARTIAL | Build the UI |

## COMMERCE phase

| Module | Backend | UI | Status | Needs work on |
|---|---|---|---|---|
| Registration Types | Products page (being renamed from "Registration Products" — Slice 1 in progress) | Products page | 🟢 LIVE (extending) | Slice 1: add description/individual-vs-delegation/eligibility/display-order fields to the UI form (backend done, UI not yet) |
| Registration Form Builder | `registration-form.ts` — full CRUD, reordering, conditional visibility, cycle detection | Placeholder | 🟡 PARTIAL, **critical gap** | UI doesn't exist AND the live registration funnel ignores the builder entirely — it writes hardcoded fields (`fullName, email, phone, institution, experience, dietary, accommodations`) regardless of what an organizer configures. Building the UI without also rewiring the funnel doesn't fix anything real. |
| Pricing & Capacity | Product fields (price/capacity/deadline) | Products page | 🟢 LIVE | — |
| Payment Settlement | Encrypted write-only bank details (`mun_payment_settings`) | Finance placeholder | 🟡 PARTIAL | UI to enter bank details doesn't exist. Real payout execution is ⚪ DEFERRED (no gateway integration, manual admin verify only) |

## OPERATIONS phase

| Module | Backend | UI | Status | Needs work on |
|---|---|---|---|---|
| Rules & Documents | `mun-documents.ts` | Placeholder | 🟡 PARTIAL | Build the UI |
| Schedule | `mun-schedule.ts` | Placeholder | 🟡 PARTIAL | Build the UI |
| Accommodation | `accommodation.ts` — full CRUD, capacity-locked at registration time | Full UI | 🟢 LIVE | — |
| **Registrations (roster)** | `getDelegateList` — view/filter only | Read-only table | 🟡 PARTIAL | **In progress (Slice 1)**: committee/portfolio assignment enforcement doesn't exist server-side even though the columns do — a committee's `capacity` field is currently decorative. Building now: `assignCommittee`/`assignPortfolio`/bulk actions + row-lock enforcement. |
| **Delegations (group registration)** | ⚫ Nothing exists | ⚫ Nothing exists | 🔴 NOT STARTED | This is the PRD's headline ask and hasn't been touched yet — no `delegations`/`delegation_members`/`delegation_invitations` tables, no Head Delegate dashboard, no invite flow. Biggest single chunk of unbuilt work. |
| **Waitlist** | ⚫ Nothing exists | ⚫ Nothing exists | 🔴 NOT STARTED | When a registration type/committee is full today, the user just gets a hard rejection — no offer to wait. |
| Cancellation | ⚫ No cancel action exists at all (only a passive 15-min TTL expiry sweep) | ⚫ | 🔴 NOT STARTED | An organizer cannot cancel a registration today, at all |
| Refunds | Previously built, withdrawn after unresolved double-refund race | None | ⚪ DEFERRED (deliberate) | Explicitly out of scope until a DB-constraint-based redesign — see project memory `refund-concurrency-lesson.md`. Cancellation (when built) will stop at handing off to the existing support-ticket `REFUND` category, no automated processing |
| CSV/XLSX import (bulk registration) | ⚫ Nothing exists | ⚫ Nothing exists | 🔴 NOT STARTED | No import UI, no validation/preview, no template |
| CSV/XLSX export (roster) | ⚫ Nothing exists | ⚫ Nothing exists | 🔴 NOT STARTED | No export anywhere in the product |

## FINAL phase

| Module | Backend | UI | Status | Needs work on |
|---|---|---|---|---|
| Final Review / Go-Live | Full 15-module automated validation + SLA tracking (`go-live.ts`, `mun-submissions` table) | Gate 3 confirmation panel only | 🟡 PARTIAL | The backend can drive an organizer through the full "Get Your MUN Live" checklist (`getMunProgress`) and `submitMunForReview`, but there's no UI consuming it — the only thing wired up is the older, lighter-weight Gate 3 shim |

## ⚫ Not specced modules worth considering

| Idea | Why it might matter |
|---|---|
| Conference-day operations (QR check-in, live attendance) | PRD mentions it as Phase 2, schema has zero scaffolding — worth deciding now if it's really Phase 2 or should move up |
| Results & awards | Same — Phase 2, zero scaffolding |
| Certificates | Schema scaffold exists (`certificates`/`achievements` tables) but completely unwired |
| Team & permissions (sub-organizers) | See Part 1 — biggest structural gap if you ever want >1 person running a MUN |
| Communications (bulk email to registrants) | Placeholder page exists, zero backend. Real email delivery is also deferred (console-log adapter only) |
| Analytics | Placeholder page, zero backend beyond the basic overview counts (registrations/revenue/pending) |
| Multi-conference / recurring-edition support | Each MUN is a standalone row — no "BITSMUN 2025 → BITSMUN 2026" linkage, no carry-forward of committees/settings between editions |

---

# Part 3 — Student-facing features

| Feature | Status | Needs work on |
|---|---|---|
| Browse marketplace, filters, search | 🟢 LIVE | — |
| MUN detail page | 🟢 LIVE | — |
| Sign in | 🟡 PARTIAL | **Security-critical**: passwordless mock (email lookup, no password check) — flagged by its own red-team review as an unauthenticated-admin-takeover path if ever exposed publicly. Real auth is ⚪ DEFERRED pending provider decision |
| Sign up / account creation | 🔴 NOT STARTED | No `/signup` route — only seeded users exist today |
| Individual registration → pay → confirm | 🟢 LIVE | Capacity-locked, webhook-confirmed, mock payment gateway (Razorpay confirmed as real future provider) |
| Delegation (group) registration | 🔴 NOT STARTED | See Part 2 — the whole PRD's headline feature |
| Student dashboard (my registrations) | 🟢 LIVE | — |
| Profile edit | 🔴 NOT STARTED | Schema has the fields (name/phone/institution), no edit UI |
| Support ticket creation | 🟢 LIVE | — |
| MUN Pass / QR pass, Passport, reviews, recommendations, achievements | ⚪ DEFERRED | Explicitly Phase 2+ per CLAUDE.md, not touched |

---

# Part 4 — Admin/Operations-facing features

**Reminder — two review gates share vocabulary but are different systems, don't conflate them:**
- **Gate 1** = "can this organizer host a MUN at all" (`organizerApplications`, `reviewMunApplication`)
- **Gate 2** = "is this MUN's content good enough to publish" (`mun_submissions`, `reviewSubmission`, distinct enum values `CONTENT_SUBMITTED`/`VERIFICATION`/`VERIFIED` to avoid colliding with Gate 1's `SUBMITTED`/`UNDER_REVIEW`)

| Feature | Status | Needs work on |
|---|---|---|
| Gate 1 application review | 🟢 LIVE | — |
| Module-level verification console | 🟡 PARTIAL | Only labels the 4 legacy module keys; needs expansion to all 15 PRD modules |
| Gate 2 mun-level content review UI | 🟡 PARTIAL | Backend fully built (`reviewSubmission`, SLA tracking, automated validation) — **no UI at all** consumes it |
| Go-live queue + publish UI | 🟡 PARTIAL | Backend built (`getGoLiveQueue`, `publishFromQueue`, idempotent) — not in the admin nav |
| Registration search | 🟢 LIVE | — |
| Payment exceptions | 🟡 PARTIAL | List-only — no force-confirm/resolve action |
| Payment settlement (bank detail) verification | 🟡 PARTIAL | Backend exists (`setPaymentVerificationState`) — no UI |
| Organizer suspend/reinstate | 🟢 LIVE | — |
| Support ticket queue | 🟢 LIVE | — |
| Audit log | 🟢 LIVE | Currently admin-only reads; PRD wants organizer-visible audit trail on their own registrations too — an authorization-widening decision, not yet made |
| Refunds console | ⚪ DEFERRED | Same reason as student-facing refunds |

---

# Part 5 — Platform / cross-cutting

| Workstream | Status | Needs work on |
|---|---|---|
| Next.js `app/` (production) | 🟢 LIVE | Primary, real DB/sessions/actions |
| Hono `server/` API | 🟡 PARTIAL | Fully built + integration-tested, but **zero inbound traffic** — the Vite SPA doesn't call it yet |
| Vite `web/` SPA | 🟡 PARTIAL, mock-only | No API client exists (`web/src/api/client.ts` never built), fake auth, every page reads mock data. Do not retire the Next app until this is wired — confirmed by audit this session |
| Real authentication provider | 🔴 NOT STARTED (⚪ deferred pending decision) | Passwordless mock everywhere; provider (OAuth vs password) not yet chosen |
| Real payment gateway | ⚪ DEFERRED | Razorpay confirmed as target, mock adapter only today |
| Real email delivery | ⚪ DEFERRED | Console-log adapter only |
| Background job scheduler | 🔴 NOT STARTED | Needed for SLA-approaching notifications, waitlist auto-promotion, expired-hold sweeps beyond the current lazy on-request sweep |
| Crawler prerendering for SEO | 🔴 NOT STARTED | Flagged in the migration spec as "new infrastructure not yet assigned a task" — matters once the SPA goes live publicly |
| Encryption key rotation | ⚪ DEFERRED | Single env-var key, no KMS/HSM |
| Two-person approval for high-risk admin actions | ⚪ DEFERRED | Spec mentions it, nothing built |

---

# Part 6 — Where the biggest gaps are (for your brainstorm)

Ranked by how much they block a real MUN from running end-to-end on this platform:

1. **Delegation/group registration** — the PRD's headline feature, zero code exists. Most MUN conferences run primarily on school/college delegations, not individual sign-ups — this may be a bigger gap than the module-UI placeholders combined.
2. **Registration form builder is disconnected from the funnel** — an organizer can configure custom fields today and no student will ever see them. This is worse than "not built" because it silently looks like it works.
3. **No cancellation action at all** — an organizer cannot cancel a bad registration today, only wait for a 15-minute TTL to expire an unpaid one.
4. **No CSV export anywhere** — every conference operations team will ask for this on day one.
5. **Committee/portfolio capacity is fake** — the fields exist and look real in the UI, but nothing stops a committee capped at 20 from accepting 500 registrations. (Being fixed now, in progress.)
6. **Sub-organizer/team roles don't exist** — blocks any MUN run by more than one person, which is most of them.
7. **Real auth** — blocks any public deployment, full stop.
8. **Vite SPA has no backend wiring** — blocks retiring the old Next app, and is a large amount of already-spent UI work sitting idle.

---

# Part 7 — Questions worth deciding before adding more scope

- Is delegation/group registration actually the highest-priority next build, or is finishing the placeholder module UIs (branding/contact/schedule/documents/EB) higher value for less effort?
- Should team/sub-organizer roles get pulled forward, given it blocks realistic multi-person conference operations?
- Is Phase 2 (QR check-in, results, certificates, reviews) really "later," or does the target market (student-run Hyderabad MUN circuit) actually need certificates sooner than delegation management?
- What's the real timeline pressure on real auth + real payments — is a public launch imminent, or is mock-everything fine for a longer pilot period?
- Does the product need multi-conference/recurring-edition support (BITSMUN 2025 → 2026 carrying forward committees/settings), or is "each MUN is a fresh row" fine indefinitely?
