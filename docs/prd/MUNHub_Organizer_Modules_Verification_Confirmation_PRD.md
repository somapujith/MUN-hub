# MUNHub --- Organizer Modules, Verification & Confirmation PRD

**Version:** 1.0\
**Product:** MUNHub --- Organizer Platform

## 1. Purpose

MUNHub is a curated marketplace and operating system for Model United
Nations conferences. The Organizer Platform lets approved organizers
configure, verify, publish and operate conferences.

**Core rule:** An organizer must never be able to publish a conference
directly. Public/bookable information requires organizer confirmation
plus MUNHub verification.

## 2. Organizer lifecycle

`APPLICATION → REVIEW → APPROVED → ONBOARDING → CONTENT SUBMITTED → ORGANIZER CONFIRMATION → MUNHUB VERIFICATION → VERIFIED → PUBLISHED → REGISTRATION OPEN → REGISTRATION CLOSED → CONFERENCE ACTIVE → RESULTS SUBMITTED → RESULTS VERIFIED → CERTIFICATES → COMPLETED → ARCHIVED`

Statuses: - DRAFT - SUBMITTED - UNDER_REVIEW - CHANGES_REQUESTED -
APPROVED - ONBOARDING - CONTENT_SUBMITTED - VERIFICATION - VERIFIED -
PUBLISHED - REGISTRATION_OPEN - REGISTRATION_CLOSED -
CONFERENCE_ACTIVE - RESULTS_PENDING - RESULTS_UNDER_REVIEW - COMPLETED -
ARCHIVED - CANCELLED

## 3. Roles

**Organizer:** Owner, Admin, Registration Manager, Content Manager,
Finance Manager, Conference Manager, Volunteer.

**MUNHub:** Operations Reviewer, Admin, Super Admin.

All permissions use RBAC and server-side authorization.

------------------------------------------------------------------------

# 4. Module: Organizer Application & Verification

### Objective

Verify that an organizer is legitimate before giving them a publishable
conference workspace.

### Application data

-   Organization name/type
-   Institution/company/club
-   Official email and phone
-   Website/social links
-   Representative details
-   Address
-   MUN name and edition
-   Proposed dates and city
-   Venue
-   Expected delegates
-   Previous editions/events
-   Expected pricing
-   Supporting documents

### Review

MUNHub checks identity, organization legitimacy, previous events,
venue/event credibility, duplicate/suspicious applications and policy
compliance.

Reviewer actions: - Approve - Reject - Request changes - Add internal
notes

### Confirmation

Organizer must confirm: \> "I confirm that the information submitted is
accurate and that I am authorized to represent this
organization/conference."

Store user, timestamp, submission version and audit metadata.

------------------------------------------------------------------------

# 5. Module: MUN Setup

Submodules: - General - Dates & Venue - Branding - Schedule - Rules -
FAQs - Contact

### Required fields

MUN name, edition, description/theme, dates, venue/address, registration
dates, contact information, logo/cover and required policies.

### Save model

Every module supports:
`DRAFT → COMPLETE → SUBMITTED → VERIFIED / CHANGES_REQUESTED`

------------------------------------------------------------------------

# 6. Module: Committees

Organizer can create/edit committees, capacity, agenda, description, EB,
portfolio rules, registration availability and waitlist.

Fields: - Committee name/type - Agenda - Description - Capacity - EB -
Portfolio rules - Registration status

### Confirmation

Before submission: \> "I confirm that the committee details, agenda and
capacity are correct."

### Verification

MUNHub checks completeness, agenda quality, capacity consistency and
public accuracy.

A verified committee change after publication may trigger
re-verification.

------------------------------------------------------------------------

# 7. Module: Portfolios

Features: - Add/remove country or role - Availability - Committee
mapping - Restrictions - Priority - Description

States: `AVAILABLE / RESERVED / ASSIGNED / BLOCKED / DISABLED`

### Integrity

A portfolio cannot be assigned to two confirmed registrations within the
same committee.

------------------------------------------------------------------------

# 8. Module: Executive Board

Fields: - Name - Position - Photo - Bio - Committee - Institution -
Social links

Organizer confirms that listed EB members have authorized their
representation.

MUNHub may request supporting evidence when required.

------------------------------------------------------------------------

# 9. Module: Registration Products

Examples: - Delegate - Press - International Press - Observer -
Independent Participant - Custom approved category

Fields: - Product name - Price - Capacity - Eligibility - Benefits -
Deadline - Status - Applicable tax configuration

### Price protection

Existing registrations retain their original price. Material price
changes after publication/registration are logged and may require
re-verification.

------------------------------------------------------------------------

# 10. Module: Registration Form Builder

Supported fields: Text, long text, email, phone, number, dropdown,
multiple choice, checkbox, date, file upload, institution, academic
year, MUN experience, committee preference, portfolio preference,
emergency contact and accommodation.

### Conditional logic

Example:
`Accommodation = YES → show nights, arrival, departure, room preference`

### Data protection

Personal data must be access-controlled, validated, securely stored and
excluded from public pages.

------------------------------------------------------------------------

# 11. Module: Registrations

Lifecycle:
`STARTED → PAYMENT_PENDING → PAYMENT_FAILED / CONFIRMED → CANCELLED / REFUNDED → CHECKED_IN → ATTENDED / NO_SHOW`

Table: Registration ID, delegate, institution, product, committee,
portfolio, payment status, registration status, amount and date.

Actions: Search, filter, view, assign committee/portfolio, cancel,
refund request, export and contact.

### Critical rule

A registration becomes **CONFIRMED only after server-side payment
verification**. Never trust a frontend success screen.

------------------------------------------------------------------------

# 12. Module: Payments & Finance

Payment lifecycle:
`ORDER_CREATED → PAYMENT_INITIATED → PAYMENT_SUCCESS → WEBHOOK_VERIFIED → REGISTRATION_CONFIRMED`

Verify: - Order ID - Payment ID - Amount - Currency - Signature -
Webhook authenticity - Provider status

Reconciliation must connect:
`User → Registration → Order → Payment → Settlement`

Refunds:
`Request → Eligibility → Initiate → Provider confirmation → Update registration`

All financial actions are audited.

------------------------------------------------------------------------

# 13. Module: Content Verification

Every public-facing module/field has a verification state:

`NOT_SUBMITTED / PENDING_REVIEW / VERIFIED / CHANGES_REQUESTED / REJECTED`

Reviewer checklist: - Organizer identity - MUN name/edition - Dates -
Venue/location - Pricing/capacity/deadlines - Committees/agendas -
Portfolios - Executive Board - Description/rules/schedule/FAQs - Contact
details - Brochure/media

Reviewer records: - Reviewer - Timestamp - Module/field - Previous
value - New value - Decision - Reason/comment

------------------------------------------------------------------------

# 14. Module: Organizer Final Confirmation

This is a mandatory gate before final verification.

Organizer reviews a complete summary: - Event information - Committees -
Portfolios - EB - Products/pricing - Registration form - Policies -
Schedule - Documents - Contact information

Required statement: \> "I confirm that the information displayed in this
submission is accurate, complete and authorized for publication."

Store: - Confirming user - Timestamp - Version number - Submission
snapshot

------------------------------------------------------------------------

# 15. Module: MUNHub Verification Console

Internal reviewer dashboard: - Pending submissions - Priority -
Organizer - Conference date - Submission date - Current status - Review
history

Review screen provides field/module-level decisions.

Severity: - **BLOCKER:** must fix before publication - **HIGH:**
important accuracy/compliance issue - **MEDIUM:** correction required -
**LOW:** cosmetic/content issue

Actions: `VERIFY / REQUEST CHANGES / REJECT`

Change requests must identify the exact module/field and reason.

------------------------------------------------------------------------

# 16. Re-verification

Important changes after verification automatically trigger
re-verification.

High-impact examples: - MUN name - Date - Venue - Price - Capacity -
Committee - Agenda - EB - Refund policy - Registration terms

Flow:
`Verified → High-impact edit → Re-verification required → Organizer confirmation → MUNHub review → Verified`

Low-risk changes may use lighter review.

------------------------------------------------------------------------

# 17. Module: Public Page Preview

Organizer has **Preview as Student**.

Flow: `Preview → Completeness checklist → Final confirmation → Submit`

Preview must match the actual public page.

------------------------------------------------------------------------

# 18. Module: Conference Day

### QR check-in

Student presents MUN Pass/QR/Registration ID.

System validates: - Registration exists - Correct MUN - Payment
confirmed - Not already checked in

Valid result: `CHECKED_IN`

Duplicate check-ins are blocked unless an authorized operator corrects
them.

------------------------------------------------------------------------

# 19. Module: Results & Awards

Awards: - Best Delegate - High Commendation - Special Mention - Verbal
Mention - Honourable Mention - Custom approved award

Organizer submits: - Delegate - Committee - Portfolio - Award

Validation: - Delegate registered - Delegate attended - Committee
matches - Portfolio matches - Award is valid - No invalid duplicate
result

Status:
`DRAFT → SUBMITTED → UNDER_REVIEW → VERIFIED / CHANGES_REQUESTED / REJECTED`

Organizer cannot directly make an achievement "verified."

------------------------------------------------------------------------

# 20. Results Verification

MUNHub validates: 1. Participation/attendance 2. Committee 3. Portfolio
4. Award 5. Organizer authorization 6. Duplicate/conflicting results

Only verified results become **Verified Achievements** on MUN Passport.

------------------------------------------------------------------------

# 21. Module: Certificates

Types: - Participation - Award - Custom approved certificate

Template fields: `{{student_name}}`, `{{mun_name}}`, `{{committee}}`,
`{{portfolio}}`, `{{award}}`, `{{date}}`, `{{registration_id}}`,
`{{certificate_id}}`

Lifecycle:
`Verified result → Generate → Quality check → Issue → Store → Email → Public verification`

Each certificate gets: - Unique certificate ID - Verification URL - QR
code - Issue date

Public verification should expose only appropriate verification
information.

------------------------------------------------------------------------

# 22. Module: Communications

Audience: - All delegates - Confirmed - Pending payment - Committee -
Portfolio - Accommodation - Institution - Registration type - Checked-in

Email first; WhatsApp/SMS/push can be future channels.

Organizer communications must be conference-related and logged.

------------------------------------------------------------------------

# 23. Module: Documents & Media

Uploads: Brochure, rules, handbook, schedule, logo, cover, gallery and
sponsor assets.

Checks: - File type - File size - Security/malware scanning - Image
requirements - Public/private visibility

Changing a verified public document creates a new version and may
require re-verification.

------------------------------------------------------------------------

# 24. Module: Analytics

Registration: - Total/confirmed/pending/cancelled - Daily
registrations - Conversion - Committee utilization - Portfolio demand

Finance: - GMV - Platform fee - Tax collected where applicable -
Refunds - Payment success - Average order value

Funnel:
`Page View → Registration Started → Payment Initiated → Payment Success → Confirmed`

------------------------------------------------------------------------

# 25. Module: Team & Permissions

Least-privilege access.

Example: - Owner: full access - Finance: payments/refunds -
Registration: registrations/check-in - Content: public content -
Volunteer: conference-day limited access

Every sensitive action must be permission checked server-side.

------------------------------------------------------------------------

# 26. Module: Audit Logs

Critical events include:
`MUN_CREATED, MUN_SUBMITTED, VERIFICATION_STARTED, FIELD_VERIFIED, CHANGES_REQUESTED, MUN_APPROVED, MUN_PUBLISHED, PRICE_CHANGED, COMMITTEE_CHANGED, REGISTRATION_CONFIRMED, REFUND_INITIATED, RESULT_SUBMITTED, RESULT_VERIFIED, CERTIFICATE_ISSUED, TEAM_MEMBER_ADDED, PERMISSION_CHANGED`

Store: - Actor - Action - Target - Timestamp - Previous/new value when
applicable - Reason - Request/session metadata where appropriate

Normal users cannot edit audit logs.

------------------------------------------------------------------------

# 27. Verification vs Confirmation

This distinction is fundamental.

### Organizer Confirmation

The organizer says: \> "This information is accurate and authorized."

This creates **organizer accountability**.

### MUNHub Verification

MUNHub says: \> "This information passed platform review."

This creates **platform trust**.

For high-risk/public information:

`Organizer Confirmation + MUNHub Verification = Trusted Public Information`

------------------------------------------------------------------------

# 28. Mandatory Gates

### Gate 1 --- Organizer approval

Required before publishable onboarding.

### Gate 2 --- Content completion

All mandatory modules complete.

### Gate 3 --- Organizer final confirmation

Explicit confirmation of complete submission.

### Gate 4 --- MUNHub verification

Required before publication.

### Gate 5 --- Payment verification

Required before registration confirmation.

### Gate 6 --- Results submission

Required before achievement processing.

### Gate 7 --- Results verification

Required before verified achievements/certificates.

------------------------------------------------------------------------

# 29. Security Requirements

-   Authentication
-   RBAC
-   Server-side authorization
-   Tenant isolation
-   IDOR protection
-   Rate limiting
-   Secure uploads
-   Payment signature/webhook verification
-   Audit logs
-   HTTPS
-   Secure secrets
-   Input validation
-   Duplicate-payment protection
-   Duplicate-registration protection
-   Duplicate-portfolio protection

------------------------------------------------------------------------

# 30. Multi-Tenant Architecture

MUNHub uses shared infrastructure with logical tenant isolation.

Examples: - `oxford.munhub.in` - `vit-mun-2027.munhub.in` -
`hyderabad-mun-2027.munhub.in`

Flow: `Hostname → MUN slug → MUN ID → Tenant data`

Every query must be scoped to the correct organizer/MUN.

------------------------------------------------------------------------

# 31. Recommended Architecture

`Cloudflare DNS/CDN/WAF/SSL → Next.js → Neon PostgreSQL`

Supporting services: - Cloudflare R2 --- media/certificates - Razorpay
--- payments - Amazon SES --- email - Queue/background jobs ---
certificates, emails, exports - Sentry --- monitoring - PostHog ---
analytics

------------------------------------------------------------------------

# 32. Core Data Model

Entities:
`users, organizers, organizer_members, muns, mun_versions, mun_verification_reviews, verification_issues, committees, portfolios, executive_board_members, registration_products, registration_forms, registration_form_fields, registrations, registration_answers, orders, payments, refunds, documents, media, communications, check_ins, results, awards, certificates, audit_logs, notifications`

Important relationship:

`Organizer → MUN → Committees/Portfolios/Products/Registrations/Documents/Results/Certificates`

------------------------------------------------------------------------

# 33. Versioning

Public MUN information should be versioned.

Example:
`Version 1 → Verified → Organizer changes price → Version 2 → Re-verification → Published`

A registration should retain the relevant MUN configuration/version at
the time of purchase.

------------------------------------------------------------------------

# 34. Acceptance Criteria

### Organizer

-   Can create drafts.
-   Cannot publish directly.
-   Must complete required modules.
-   Can preview.
-   Must confirm final data.
-   Can submit for review.
-   Receives structured change requests.
-   Can resubmit.

### MUNHub

-   Can review submissions.
-   Can verify individual modules/fields.
-   Can request changes.
-   Can reject.
-   Can see history.
-   Can publish only after required verification.

### Registration

-   Cannot confirm without verified payment.
-   Cannot exceed capacity.
-   Cannot duplicate portfolio assignment.

### Results

-   Organizer submits results.
-   MUNHub verifies.
-   Only verified results become verified achievements.

### Certificates

-   Generated from valid data.
-   Unique ID.
-   Verification page.
-   Issuance audited.

------------------------------------------------------------------------

# 35. MVP Priority

**P0:** Organizer application, verification, MUN setup, committees,
portfolios, EB, products, form builder, registrations, payment
verification, content verification, organizer confirmation, public
listing, email, audit logs.

**P1:** QR check-in, results/awards, certificates, certificate
verification, analytics, team permissions, segmented communications.

**P2:** WhatsApp, advanced analytics, waitlists, automated portfolio
allocation, accommodation, sponsors and advanced workflow automation.

------------------------------------------------------------------------

# 36. Final Product Principle

MUNHub should not be only a listing site or ticketing system.

It should become the **trusted operating system for MUN conferences**:

`DISCOVERY → TRUSTED INFORMATION → REGISTRATION → PAYMENT → DELEGATE MANAGEMENT → CONFERENCE OPERATIONS → RESULT VERIFICATION → CERTIFICATES → MUN PASSPORT`

The platform should always answer:

1.  **Who submitted this information?**
2.  **Did the organizer confirm it?**
3.  **Did MUNHub verify it?**

That verification layer is the foundation of MUNHub's trust and
differentiation.
