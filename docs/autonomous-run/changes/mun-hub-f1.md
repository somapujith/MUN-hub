# mun-hub-f1 — organizer go-live unblockers

Lane: organizer workspace pages (not settings, finance, communications, registrations, conference_day or results), plus the lib/server code behind them. Lead: mun-hub-62.

## Plan

1. Setup page: address line 1, registration opens, registration deadline (UI + API + lib), so the Dates & Venue module can pass.
2. Committees page: portfolio create/edit/delete.
3. Accommodation: an "accommodation not provided" option.
4. Branding: logo + cover upload.
5. Go-live pipeline UX: per-module confirm, verification state and checks, lock banner, Gate-3 summary and attestation, reviewer notes.
6. Draft "preview as student".
7. One organizer can host more than one MUN.

## Log

- Started the lane and mapped the code.
- `ba44e79`: migration 0030 drops the unique constraint on `organizer_applications.organizer_id` and adds an index; `mun_id` stays unique. Applied locally only.
- Seed fix: `seed-go-live-modules.ts` now uses `mun_id` as its on-conflict target, because the `organizer_id` unique constraint no longer exists.
- Item 3 (accommodation "not provided"):
  - Added `setAccommodationProvided` (lib), `PUT /muns/:munId/accommodation/provided`, and a web client function.
  - The accommodation page now opens with a "Does your conference offer accommodation?" choice; the options UI only shows for "Yes".
  - `accommodationProvided` is a high-impact field for ACCOMMODATION, so changing the answer after verification triggers re-verification.
- Item 1 (backend): `updateMunDetails` and `PATCH /muns/:munId` accept `addressLine1`, `addressState`, `postalCode`, `mapUrl`, `registrationOpensAt` and `registrationDeadline`. `MunSetupDetails` exposes them, plus `accommodationProvided`.

- `f523604`: migration 0032 adds `expected_delegate_count`, `previous_editions` and `website_url` to `organizer_applications`. Applied locally only.
- Item 7 (multi-MUN organizers):
  - `submitOrganizerApplication` stores those three answers.
  - It now refuses a new application only while an earlier one still awaits review (`APPLICATION_PENDING`, 409), replacing the old one-application limit (`ALREADY_APPLIED`).
  - New `listMyOrganizerApplications` and `GET /organizer/applications` return the organizer's applications with Gate-1 reviewer notes.
  - `/organizer/apply` is now a real "Host another MUN" page with a "Your applications" list (status and reviewer note). It shows a "being reviewed" notice while an application is pending, and sends non-onboarded organizers to the wizard.
  - The wizard's completed screen links to it.
  - The admin review dialog shows expected start date and city, maximum expected delegates, previous editions, website and description.
- Error mapping: the module-lock message and "Cannot confirm — …" now return 409 instead of 500.
- Shared bright-form primitives moved to `web/src/components/organizer/bright-form.tsx`.

- `f6fcb7b`: item 5 backend.
  - `getMunProgress` returns each module's checks.
  - New `GET /muns/:munId/review-feedback` returns the Gate-1 application note, the latest Gate-2 round, staff log notes (never internal notes) and reviewer issues.
  - New `GET /muns/:munId/confirmation-preview` returns the Gate-3 snapshot and the attestation text.
  - `POST …/submit-final-confirmation` requires `{attested: true}`. The attestation text is stored in the snapshot.
  - At Gate 3, sections the organizer hadn't sent for review move to PENDING_REVIEW, and their reviewer issues are marked answered.
  - Confirmation version numbers now follow the latest one; before, they were always 2 after the first.
  - Resubmission fixes:
    - Stale automated issues are cleared before re-validating.
    - A CHANGES_REQUESTED round is closed (WITHDRAWN) so it no longer blocks with 409.
    - The progress recompute resolves automated issues whose check now passes.
    - `confirmModule` resolves reviewer issues on that module.
  - `updateMunDetails` refuses a registration deadline that isn't after opening, or isn't before the conference start (found by mun-hub-84).
- `aa2eaf1`: during VERIFICATION, a section a reviewer sent back (CHANGES_REQUESTED) is editable by the organizer. Before, it stayed locked, so the organizer could never fix it. The progress bar also no longer drops to zero while sections show LOCKED.
- `fc45913`:
  - RULES_DOCUMENTS no longer requires a refund policy, because MUN Hub has no refunds. The seed was updated to match.
  - `updateMunDetails` lock-checks BASIC_INFO or DATES_VENUE only when a value in that module actually changes.
  - review-feedback no longer exposes `rejectionReason`, because the log files it as an internal note.
- `87d7102`: items 1, 4 and 5 UI.
  - MUN Setup gained:
    - address, state, postal code, map link and registration window fields;
    - a go-live checklist with verification state, checks, section links and per-section "Send … for review";
    - "Feedback from MUN Hub";
    - "Confirm your submission" (summary plus attestation checkbox);
    - a details lock during review.
  - A review banner shows on every MUN section.
  - Documents & Media has logo and cover upload, a required-documents indicator, a 10MB PDF label, and no refund-policy option for new uploads.
  - Checked in a browser against the local API with `STORAGE_ADAPTER=local`, on desktop and at 390px.

- `f73ce26` + `6f3d74f`: item 2 (portfolios).
  - Portfolio create, update and bulk add refuse duplicate names within a committee (409), ignoring case.
  - `POST /committees/:id/portfolios/bulk` adds up to 300 portfolios in one transaction.
  - Each committee card lists its portfolios with add, "Add a list" (paste), inline edit and remove, and shows a no-seat warning.
  - The page is renamed "Committees & Portfolios". Checked in a browser on desktop and mobile; the mobile overflow was fixed with `min-w-0`.
- `fc05d9e`: republishing after unpublish (bug found by mun-hub-84, routed by mun-hub-62).
  - `enqueueForGoLive` opens a fresh APPROVED submission for a previously published MUN that is UNPUBLISHED, or VERIFIED again after re-verification.
  - Re-queueing is refused while a required section awaits review.
  - Gate-2 approval now marks every section VERIFIED and resolves open reviewer issues.
- `aa85127`: item 6 ("Preview as a delegate").
  - `getMunPreview` and `GET /organizer/muns/:munId/preview` serve owner and staff only.
  - `/organizer/muns/:munId/preview` renders the public page with a preview banner and registration turned off, marked noindex.
  - MUN Setup has a button that opens it.
- All seven lane items are done.
- Organizer UX pass (Phase 3). The full organizer journey was walked twice in a real browser, desktop and mobile. Findings, fixes and hand-offs are in `docs/autonomous-run/ux/organizer.md` (`5888df1`).
- `4e62a1d`: fixes from the UX pass.
  - Gate-3 "Make changes first" (`withdrawSubmission`; new ORGANIZER_CONFIRMATION → READY_FOR_SUBMISSION transition).
  - Plain-language lock errors.
  - Approval recomputes section progress.
  - Onboarding prefills the phone number; the signup error clears on edit.
  - The overview shows the next step for each MUN; the "Application submitted" page uses the organizer shell.
  - MUN Setup shows a status card per stage, a "live" card and a "next up" link, and hides the checklist after approval.
  - Checklist: blocking checks vs notes, and the per-section send button only for sections a reviewer sent back.
  - Support-button padding; en-IN dates.
- `cb5abc7`: Executive Board member photos are uploaded instead of pasted as URLs.
  - POST/DELETE `/executive-board/:id/photo`; old files are removed on replace, remove or member delete.
  - The redundant "Display order" field is removed from the form.
  - My MUNs: the button now reads "Host a MUN", and each card shows "Open".
- `fb9b3a6` (requested by the lead):
  - The organizer preview shows the launch state (no internal status; "Opens <date>" instead of "Closed").
  - Toasts moved to bottom-right, above the support button.
  - The empty roster says "No delegates yet" once, not twice.
- `58a7c5c` (requested by the lead): the organizing body appears as the host.
  - The onboarding profile step asks for it.
  - `PUT /organizer/organization` edits it, and the overview has a "hosted by" card.
  - Stored in `users.institution` (no migration). Public pages and search use it, falling back to the organizer's name.
- Declined the lead's request to build scoped team access (`mun_team_members`, invitations, roles) without the user's approval — it's on CLAUDE.md's deferred list and out of scope per `docs/autonomous-run/CONTEXT.md`. The lead added it to `docs/autonomous-run/USER_ACTIONS.md` and released migration slot 0037.
- `8ec283c`: Registration Form field keys, found in the UX pass (every card showed "Field key: grade_class").
  - New fields get a key generated from the label; the organizer no longer has to invent one.
  - The key input moved under a collapsed "Advanced" section and is read-only once a field exists.
  - The field list and the conditional-field dropdown show only labels, never keys.
  - Deleting a field another field's condition depends on now shows a plain toast up front.
  - Checked in a browser, desktop and mobile, against the local API.

### Bugs found while mapping (status)

- Done: unmapped lock and confirm errors (now 409).
- Done: resubmission after failed checks.
- Done: resubmission after Gate-2 changes.
- Done: reviewer issues never resolved.
- Done: `checks: []`.
- Handled by mun-hub-62's storage work: uploaded media URLs pointed at `/mock-storage/…`, which nothing served. Local dev needs `STORAGE_ADAPTER=local` to preview uploads.
