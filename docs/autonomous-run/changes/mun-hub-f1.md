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

### Bugs found while mapping (to fix in this lane)

- `assertModuleNotLocked`'s message and `submitFinalConfirmation`'s "Cannot confirm — validation now fails" are unmapped, so both surface as 500s.
- Resubmitting after a failed automated check always fails, because the previous round's AUTOMATED blockers are still unresolved while validation runs.
- Resubmitting after Gate 2 CHANGES_REQUESTED returns 409, because that submission row still counts as active.
- REVIEWER issues are never resolved.
- `getMunProgress` always returns `checks: []`.
- Uploaded media URLs point at `/mock-storage/…`, which nothing serves.
