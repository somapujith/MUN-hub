# Organizer UX walkthrough

**Walkthrough:** mun-hub-f1, 2026-09-17.

**Setup:**
- Local API on port 3001, with `STORAGE_ADAPTER=local` and an email outbox file.
- Web dev server on port 5174.
- Local Docker database.
- Chrome through Playwright, at 1440×900 (desktop) and 390×844 (mobile).

**Persona:** a brand-new organizer, Asha. She signs up, completes onboarding, applies, and waits for approval. Then she sets up every section, previews the listing, submits, and confirms. After MUN Hub approves and publishes, she opens registration and checks the roster.

The walkthrough ran twice: once to find friction, and again after the fixes to confirm them.

**Screenshots:** `before-*.png` in [organizer/](organizer/) show the problems as found. The scripts live in the session scratchpad (`ux/*.mjs`); they are not part of the repo.

## Result

The whole journey now works end to end in the UI:

1. Signup with an email code.
2. The five-step onboarding wizard, followed by "Application submitted".
3. Staff approve the application in the admin review queue.
4. All 15 sections filled through their pages, and the checklist shows 15 of 15 complete.
5. Preview as a delegate.
6. Run checks, then "Make changes first", edit, run checks again, and confirm.
7. Staff verify the payout account, approve, queue and publish.
8. The organizer opens registration from Settings and sees the roster.

**Mobile:** no horizontal scroll on the organizer section pages I own (setup, committees, documents, accommodation, products, executive board).

## Fixed in my pages (4e62a1d)

| # | Where | Friction | Fix |
|---|---|---|---|
| 1 | Signup (`organizer-otp-form.tsx`) | "Enter your full name." stayed on screen after the name was typed. | The message clears as soon as a field changes. |
| 2 | Onboarding, profile step | The phone given at signup had to be typed again. The UPI mobile number did too. ([before-01](organizer/before-01-wizard-phone-not-prefilled.png)) | Both are prefilled from the signup phone when it's an Indian mobile number. |
| 3 | Application submitted | Used the delegate marketplace header, footer and a "Browse marketplace" button, then said nothing about what happens next. ([before-02](organizer/before-02-application-submitted-marketplace-chrome.png)) | Uses the organizer shell and lists the three next steps, with a single "Go to dashboard" button. |
| 4 | Dashboard overview | A pending MUN showed only a "Submitted" badge and "Manage", and an approved one only "Onboarding". "0/0 confirmed" appeared before any passes existed. ([before-03](organizer/before-03-dashboard-pending-no-guidance.png)) | Each MUN says what it's waiting for, with the right action: View application, Continue setup, Confirm submission, Review status, Registration settings or View registrations. The seat count only shows once there are seats. |
| 5 | Go-live checklist | Every complete section had a "Send X for review" button (13 of them), which competed with "Run checks and submit". "Show all 1 checks". Payment verification (MUN Hub's job, not blocking) counted as "needs attention". ([before-04](organizer/before-04-checklist-send-buttons-everywhere.png)) | The per-section button appears only for sections a reviewer sent back. Only blocking checks count as "things to fix"; the rest show as notes. Singular and plural wording fixed. |
| 6 | Locked sections | The error read `The "COMMITTEES" module is locked while this mun is under MUNHub review (current status: ORGANIZER_CONFIRMATION)…` ([before-05](organizer/before-05-lock-error-jargon.png)) | It now reads "Committees is locked while MUN Hub reviews this MUN. To edit it, choose "Make changes first" on MUN Setup." (During verification: "You can edit it again if a reviewer sends it back.") |
| 7 | Gate 3 (dead end) | Once the checks passed, every section was locked until MUN Hub finished reviewing. An organizer who spotted a mistake in the confirmation summary couldn't fix it or step back. | New **Make changes first** button: the submission is withdrawn, the MUN returns to Ready for submission, and every section unlocks. `POST /muns/:munId/actions/withdraw-submission`. The review banner mentions it. |
| 8 | Workspace pages | The floating support button covered "Save settlement settings" and other last actions on the page. ([before-06](organizer/before-06-support-button-covers-save.png)) | Workspace pages keep bottom room for the button. |
| 9 | MUN Setup after publishing | Still showed "Submit for review" with a disabled "Run checks and submit", the full checklist, and old reviewer notes. ([before-07](organizer/before-07-live-mun-still-shows-submit.png)) | A **Your MUN is live** card links to the public page and registration settings, and warns that high-impact edits send the MUN back for a re-check. The checklist and old notes are hidden once approved; notes stay visible if an issue is still open. |
| 10 | MUN Setup, first visit | The page is long, and the next thing to do was at the very bottom. | A "Next up: <section>" link sits in the progress card, and the progress and status cards come first on mobile. |
| 11 | Admin conference page | After approval, every section still showed "Locked for review". ([before-08](organizer/before-08-admin-stale-locked-and-payment-not-submitted.png)) | Approval recomputes section progress. |
| 12 | Passes and documents | Dates showed as "1/10/2027, 11:59:00 PM". | en-IN format: "10 Jan 2027, 11:59 pm". |

## Sent to other lanes (not my pages)

**Payments lane (mun-hub-62):**
- Saving payout details leaves `mun_payment_settings.verificationState` at NOT_SUBMITTED. The admin page then shows "Details not submitted" next to the saved details. It should become PENDING on save. (Also in before-08.)
- Onboarding collects UPI details, but **Payments & Finance** asks for PAN, GSTIN and a bank account. The user asked for no PAN or GST details during onboarding, so the finance page contradicts the wizard.

**Admin lane:**
- Gate-1 review dialog at 1440×900: the Cancel and Approve buttons are cut off at the bottom of the modal.
- Applications queue: the MUN name isn't a link. Only the "Review" button opens the dialog.

**Product and lifecycle (for the lead to decide):**
- A high-impact edit on a live MUN (dates, venue, committees, passes, payouts) moves it to VERIFICATION, which removes it from the public site until it is re-checked, even while registration is open. The setup page now warns about this, but it may deserve a softer path (stay listed while re-checked).
- The public page and preview say "Hosted by Asha Reddy". No organization name is collected anywhere, so the host is always the person.
- Preview hero shows the internal status ("Ready for submission"), and key facts say "Registration: Closed" before launch.

**Delegate lane:**
- `student@munhub.test` can't register ("Complete your profile before registering for a MUN"). The seed doesn't complete the new profile fields.

**Global:**
- Toasts appear top-centre and cover the breadcrumb and status badge.
- Registrations page: "No delegates yet" appears twice (count line and empty state).

## Checked and fine

- Wrong OTP: shows "Incorrect code". A full code submits by itself.
- Accommodation "not provided": clear, saved at once.
- Settings "Open registration": disabled before the opening date, with the reason and a link to change the date.
- Preview: banner, registration off, images load, and another organizer gets "Forbidden".
- Locked sections: the review banner explains which sections stay editable.
