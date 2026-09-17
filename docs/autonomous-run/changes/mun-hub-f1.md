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

### Bugs found while mapping (status)

- Done: unmapped lock and confirm errors (now 409).
- Done: resubmission after failed checks.
- Done: resubmission after Gate-2 changes.
- Done: reviewer issues never resolved.
- Done: `checks: []`.
- Handled by mun-hub-62's storage work: uploaded media URLs pointed at `/mock-storage/…`, which nothing served. Local dev needs `STORAGE_ADAPTER=local` to preview uploads.
