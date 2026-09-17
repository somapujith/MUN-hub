# Admin / Operations UX walkthrough

**Walkthrough:** mun-hub-4b, 2026-09-17.

**Setup:**
- Local API on port 3901 (own port, per the shared-ports rule), local Docker Postgres.
- Web dev server on port 5901.
- Chrome via Playwright's `channel: 'chrome'`, driving the machine's already-installed
  system Chrome — the sandbox has no outbound network access to download Playwright's own
  bundled Chromium, so `playwright install` fails; pointing at the system browser works
  around that with no code changes. 1440×900 (desktop) and 390×844 (mobile).
- Signed in as `admin@munhub.test` / `munhub-demo` (seeded ADMIN account).

**Persona:** an operations/admin staffer working the queues — applications (Gate 1),
content verification (Gate 2), the go-live queue, conferences, registrations, payment
exceptions, organizers, support, staff, audit log — plus the new Security page (staff
2FA, landed earlier this run).

**Screenshots:** curated before/after images in [admin/](admin/). Every admin nav
destination was captured at both viewports; only the ones illustrating a real finding are
kept here. The Playwright scripts that drove the browser lived in the session scratchpad,
not in the repo.

## Fixed (c517696, 4d3d86e)

| # | Where | Friction | Fix |
|---|---|---|---|
| 1 | Sign-in, staff MFA step | Browser autofill filled the "Verification code" field with the email address just typed into the password step. Confirmed via the input's actual `.value`, not just a screenshot — React was patching the previous step's `<form>` in place (same position, same element type, no `key`), so the browser kept its autofill association with the underlying `<input>` DOM node across the step swap. ([before-03](admin/before-03-mfa-code-field-autofilled-with-email.png)) | Each of the three sign-in steps (password / MFA code / wrong-door redirect) now has a distinct `key`, so React mounts a fresh subtree instead of patching. Verified the code field comes up empty afterward. |
| 2 | Gate-1 review dialog (`review-page.tsx`), found by f1 at 1440×900 | The Cancel/Approve footer scrolled out of view with the rest of the dialog at 900px viewport height. | Only the middle content (detail summary + form fields) scrolls now; header and footer stay pinned. The same bug existed in the Gate-2 dialog (`gate2-review-dialog.tsx`) — fixed both. ([after-05](admin/after-05-gate1-dialog-footer-visible.png)) |
| 3 | Applications queue, found by f1 | The MUN name wasn't a link — only "Review" opened the dialog, and there was no way to reach the mun's own detail page from this queue. | Links to `/admin/muns/:munId`, the existing conference detail route (the queue row's `id` already is the mun id). |
| 4 | Registrations search box | The placeholder ("Delegate name or email, MUN, or registration ID") was visibly clipped — the search input rendered at 257px instead of the intended ~384px, because `max-w-sm` was set on the inner icon+input wrapper instead of the outer flex item, so the whole block shrank to fit its flex row. | Moved `w-full max-w-md` onto the outer wrapper, matching the Conferences page's working pattern. Confirmed the full placeholder renders. ([after-04](admin/after-04-registrations-search-full-placeholder.png)) |
| 5 | Registration receipt email (not this page, but found during the pass) | `formatMoney` divided by 100 as if amounts were paise; they're whole rupees everywhere else in this codebase. A ₹1,499 registration emailed as "INR 14.99". Found by mun-hub-84's E2E, not by me, but fixed as part of this session. | Now matches `formatPrice`'s own formatting (`Intl.NumberFormat('en-IN', {style:'currency', ...})`) — see `lib/notifications/registration-events.ts`, commit 4d3d86e. |

## Sent to other lanes / the lead (not fixed by me)

**Payments (structural — needs a server change, out of my authorized web-only scope):**
- The Payments (payment exceptions) page has **no pagination at all** — every open
  exception renders on one page. With 77 rows in the seeded local DB it's already an
  unusably long scroll; `listOpenPaymentExceptions` (`lib/payments/exceptions.ts`) has no
  `limit`/`offset` parameters, so this needs a server change (route + lib action), not
  just a frontend tweak. Every other list page in the console paginates.
  ([before-01](admin/before-01-payments-no-pagination.png))

**Search/filter gap (design decision, not urgent):**
- Applications, Verification, and the Audit log have no search or filter controls, unlike
  Conferences/Registrations/Organizers/Staff/Support, which all do. At real data volumes
  (the seeded local DB has 51/107/214 pages respectively, mostly E2E fixture noise, but a
  real production queue will grow the same way) there's no way to jump to a specific MUN
  or actor without paging through. Verification's decision column ("Verify"/"Reject" per
  row) is also the *payment account* verification, not the MUN-content verification shown
  in the same row's Status column — same word, two different things, easy to conflate at a
  glance. Worth a copy/label pass if it comes up again.
  ([before-02](admin/before-02-verification-no-search-filter.png))

**Mobile (not a bug, but worth knowing):**
- Wide tables (go-live queue, conferences, etc.) use `overflow-x-auto` + a fixed
  `min-w-[Nrem]`, same as desktop — confirmed the Payment account/Actions columns *are*
  reachable by horizontal swipe on a 390px viewport, not actually hidden. But there's no
  visual affordance (scroll shadow, "swipe" hint) indicating the table scrolls, so it's
  easy to assume — as I initially did — that columns are simply missing on mobile. Given
  this is an internal ops console realistically used mostly on desktop, I didn't treat this
  as urgent; flagging in case a design pass wants to add scroll affordances to the shared
  table wrapper.
- The top admin nav bar (`Overview Applications Verification Go-live queue ...`) also
  scrolls horizontally on mobile with no affordance, same consideration.

## Checked and fine

- Overview, Conferences, Organizers, Registrations, Staff, Security: search/filter and
  pagination present and working; layouts hold up at both viewports.
- Staff 2FA end-to-end, in a real browser: enroll → confirm with a live TOTP code →
  10 recovery codes shown once → sign out → sign back in → MFA challenge step →
  verify with a code from the *next* time step (replay protection correctly rejects the
  same step) → session established. Also exercised the "On" state, Regenerate recovery
  codes, and Turn off buttons visually. ([after-06](admin/after-06-mfa-recovery-codes.png))
- Audit log entries read clearly and already use the correct ₹-with-grouping format for
  money ("Returned ₹1,499 to the original method") — confirms the currency bug above was
  isolated to the one email template, not a systemic issue.
- Support page: two-pane inbox layout, list + reply pane. I initially flagged a large block
  of empty space below it as a possible layout bug, but couldn't reproduce it on a second,
  more careful DOM measurement (`document.body.scrollHeight` matched the expected
  header+nav+console+footer total exactly). Most likely a one-off artifact of concurrent
  E2E activity mutating the shared local ticket data between page loads, not a real
  frontend bug — noting it here rather than either asserting a fix or silently dropping it.
