# MUNHub — Master Implementation Plan

**Project:** MUNHub  
**Purpose:** Single source of truth for implementing the product from the current codebase state toward a production-ready MUN marketplace and organizer operating system.

---

# 1. Current State

## Student

| Area | Status |
|---|---|
| Account/Login | BUILT |
| Marketplace/Search/Filters | BUILT |
| MUN Details | BUILT |
| Registration | BUILT |
| Payment/Webhook Confirmation | BUILT |
| Registration History | BUILT |
| MUN Pass | DEFERRED |

## Organizer

| Area | Status |
|---|---|
| Organizer Application | BUILT |
| Organizer Onboarding | BUILT |
| MUN Configuration | BUILT |
| Committees | BUILT |
| Portfolios | BUILT |
| Registration Products | BUILT |
| Registration Management | BUILT |
| Accommodation | BUILT |
| Final Confirmation | BUILT |
| Registration Form Builder | SHELL |
| Executive Board | SHELL |
| Finance/Payments | SHELL |
| Communications | SHELL |
| Documents/Media | SHELL |
| Conference Day/QR | SHELL |
| Results/Awards | SHELL |
| Certificates | SHELL |
| Analytics | SHELL |
| Team/Permissions | SHELL + NO SCHEMA |
| Settings | SHELL |

## Admin

| Area | Status |
|---|---|
| Authentication | BUILT |
| Organizer Review | BUILT |
| MUN Verification | BUILT |
| Change Requests | BUILT |
| Publish/Unpublish | BUILT |
| Organizer Management | BUILT |
| Registration Search | BUILT |
| Payment Monitoring | BUILT |
| Refund Workflow | WITHDRAWN |
| Granular RBAC | PARTIAL |
| Admin Notifications | NOT BUILT |
| Advanced Verification/Risk/SLA/Task Queue | FUTURE |

## Infrastructure

| Area | Status |
|---|---|
| PostgreSQL/Neon | PRESENT |
| Cloudflare/R2 architecture | PLANNED |
| Background Jobs | NOT BUILT |
| Caching Layer | NOT BUILT |
| Sentry | NOT WIRED |
| PostHog | NOT WIRED |

---

# 2. Master Product Principle

The public marketplace must never be the first place where organizer data becomes visible.

The controlled gateway is:

```text
Organizer Approved
      ↓
MUN Draft
      ↓
Onboarding
      ↓
Required Modules Complete
      ↓
Automated Validation
      ↓
Organizer Final Confirmation
      ↓
MUNHub Review
      ↓
Approved
      ↓
Go-Live Queue
      ↓
Publishing
      ↓
LIVE
```

---

# 3. Priority Order

## P0 — Go-Live Foundation

1. Onboarding module registry
2. Module completion engine
3. Validation issue system
4. Progress calculation
5. Go-Live lifecycle
6. Organizer Go-Live dashboard
7. Submission snapshot/versioning
8. Final organizer confirmation
9. Admin review queue
10. Change request/resubmission
11. Approval
12. Go-Live queue
13. Publishing gate
14. One-business-day SLA

## P0 — Mandatory Organizer Modules

15. Registration Form Builder
16. Executive Board
17. Payment & Settlement
18. Organizer Team & Permissions

## P1 — Organizer Operations

19. Finance dashboard
20. Communications
21. Documents & Media
22. Conference Day / QR Check-in
23. Results & Awards
24. Certificates
25. Analytics
26. Settings

## P1 — Platform Hardening

27. Background jobs
28. Notifications
29. Caching
30. Sentry
31. PostHog
32. Granular admin RBAC
33. Refund workflow redesign

## P2 — Future

34. Student MUN Pass
35. Public profiles
36. Verified achievements
37. Reviews
38. Saved MUNs
39. Recommendations
40. Advanced fraud/risk
41. Two-person approval
42. SLA automation
43. Advanced admin task assignment

---

# 4. Phase 1 — Go-Live Foundation

## 4.1 Database

Create:

### `mun_onboarding_modules`

Fields:

```text
id
mun_id
module_key
status
is_required
completion_percentage
validation_status
blocking_issue_count
last_updated_at
completed_at
created_at
updated_at
```

Unique constraint:

```text
(mun_id, module_key)
```

### `mun_validation_issues`

Fields:

```text
id
mun_id
module_key
severity
code
message
field_key
status
created_at
resolved_at
```

Severity:

```text
INFO
WARNING
BLOCKING
```

### `mun_go_live_submissions`

Fields:

```text
id
mun_id
submitted_by
status
progress_percentage
submitted_at
review_started_at
approved_at
published_at
sla_deadline
reviewer_id
version_id
created_at
updated_at
```

### `mun_versions`

Use immutable snapshots for submitted and approved states.

---

# 5. Module Registry

Create one central definition rather than scattering requirements across UI files.

Example:

```text
BASIC_INFO
DATES_VENUE
BRANDING
COMMITTEES
PORTFOLIOS
EXECUTIVE_BOARD
REGISTRATION_TYPES
REGISTRATION_FORM
PRICING_CAPACITY
PAYMENT_SETTLEMENT
RULES_DOCUMENTS
SCHEDULE
ACCOMMODATION
CONTACT
FINAL_REVIEW
```

Each definition should specify:

```text
key
displayName
required
route
validationRules
dependencies
order
```

Example:

```text
COMMITTEES
required: true
dependsOn: BASIC_INFO
```

---

# 6. Completion Engine

Create a server-side service:

```text
getMunOnboardingStatus(munId)
```

It must return:

```text
overallProgress
completedCount
requiredCount
remainingCount
blockingIssues
modules[]
canSubmit
```

Never calculate authoritative completion only on the client.

---

# 7. Validation Engine

Create:

```text
validateMunForSubmission(munId)
```

Responsibilities:

1. Validate organizer.
2. Validate basic information.
3. Validate dates.
4. Validate venue.
5. Validate branding.
6. Validate committees.
7. Validate portfolios.
8. Validate Executive Board.
9. Validate registration types.
10. Validate registration products.
11. Validate registration form.
12. Validate pricing/capacity.
13. Validate payment information.
14. Validate documents.
15. Validate schedule.
16. Validate accommodation.
17. Validate contact.
18. Check verification issues.
19. Create/update validation issues.
20. Return final submission eligibility.

Output:

```text
{
  valid: boolean,
  blockingIssues: [],
  warnings: [],
  modules: []
}
```

---

# 8. Go-Live Dashboard

Route:

```text
/organizer/dashboard/[munId]/go-live
```

Display:

```text
GET YOUR MUN LIVE

Oxford MUN 2027

████████████████░░░░ 82%

12 / 15 required modules complete

3 actions remaining
```

Module cards:

```text
✓ Basic Information
✓ Dates & Venue
⚠ Branding & Media
✓ Committees
⚠ Portfolios
✗ Executive Board
...
```

Each card must show:

- Status
- Missing items
- Completion percentage
- Route
- Continue/Edit button

---

# 9. Final Review

When all required modules pass:

```text
READY FOR MUNHUB REVIEW

15/15 required modules complete
Automated validation passed
Payment verification complete
No blocking issues

[Submit for MUNHub Verification]
```

Require explicit confirmation.

---

# 10. Submission Transaction

Submission must be atomic.

Server-side flow:

```text
Authorize organizer
      ↓
Lock/validate current state
      ↓
Run validation
      ↓
Create immutable version
      ↓
Create submission record
      ↓
Set lifecycle = SUBMITTED
      ↓
Calculate SLA deadline
      ↓
Write audit event
      ↓
Send notification
```

Use idempotency so repeated clicks cannot create duplicate submissions.

---

# 11. Review Locking

While under review, critical fields should be locked or changes should automatically create a new review requirement.

Critical examples:

- Price
- Capacity
- Registration dates
- Committees
- Portfolios
- Venue
- Payment details
- Refund policy

---

# 12. Admin Verification Queue

Admin route:

```text
/admin/verification
```

Queue columns:

```text
MUN
Organizer
Submitted
Status
SLA
Reviewer
Priority
```

Filters:

- Status
- Reviewer
- SLA
- Submission date
- Organizer
- MUN
- Priority

---

# 13. Admin Review

Admin opens:

```text
Oxford MUN 2027

100% Complete

Basic Information       ✓
Dates & Venue           ✓
Branding                ✓
Committees              ✓
Portfolios              ✓
Executive Board         ✓
Registration            ✓
Pricing                 ✓
Payment                 ✓
Documents               ✓
Schedule                ✓
Accommodation           ✓
Contact                 ✓
```

Admin actions:

```text
[Approve]
[Request Changes]
[Reject]
```

Reject/change request must require a reason.

---

# 14. Change Request Model

Change requests must identify:

```text
module
field
issue
severity
reason
requestedBy
status
```

Organizer sees:

```text
Action Required

Executive Board

UNHRC Chair information is missing.

[Fix Issue]
```

After fixes:

```text
Automated Validation
        ↓
Resubmit
        ↓
Admin Review
```

---

# 15. Approval

When approved:

```text
status = APPROVED
approved_at = now()
reviewer_id = admin.id
```

Create audit entry.

Then enqueue:

```text
GO_LIVE_QUEUE
```

Do not directly mark the MUN LIVE from the review action.

---

# 16. Go-Live Queue

Admin sees:

```text
READY TO PUBLISH

Oxford MUN 2027

✓ Approved
✓ Payment verified
✓ No blocking issues
✓ Required modules complete

SLA:
Within 1 business day

[Publish MUN]
```

Publishing must run through a server-side gate.

---

# 17. Publishing Gate

Create:

```text
publishMun(munId)
```

Before publishing, verify:

```text
Organizer approved
AND
MUN approved
AND
All required modules complete
AND
No blocking validation issues
AND
Payment requirements satisfied
AND
Final organizer confirmation exists
AND
Approved version exists
```

If any condition fails:

```text
PUBLISH_BLOCKED
```

---

# 18. Marketplace Activation

Publishing should atomically:

1. Validate approval.
2. Select approved version.
3. Activate public visibility.
4. Set appropriate MUN lifecycle status.
5. Generate/update public metadata.
6. Update search/indexing data if applicable.
7. Write audit event.
8. Notify organizer.

Final state:

```text
LIVE
```

---

# 19. One-Business-Day SLA

At submission:

```text
submitted_at
sla_deadline
```

SLA should account for configured MUNHub business hours/holidays.

Track:

```text
ON_TRACK
DUE_SOON
OVERDUE
PAUSED
COMPLETED
```

Pause SLA when:

```text
CHANGES_REQUESTED
```

Resume when organizer resubmits.

---

# 20. Organizer Status Timeline

Display:

```text
✓ Organizer Approved
✓ MUN Setup
✓ Required Information Submitted
✓ Automated Validation Passed
● MUNHub Team Reviewing
○ Approval
○ Go-Live Queue
○ Publishing
○ LIVE
```

---

# 21. Phase 2 — Registration Form Builder

This is a P0 dependency.

Build:

- Form fields
- Required/optional
- Ordering
- Conditional logic
- Role-specific fields
- Committee preferences
- Portfolio preferences
- Delegation fields
- Preview
- Validation
- Versioning

Registration types must support:

```text
Delegate
Reporter
Journalist
Photographer
Videographer
Observer
Faculty Advisor
Volunteer
Independent Participant
Custom
```

Registration modes:

```text
INDIVIDUAL
DELEGATION
```

Delegations must support group sizes, head delegate, invitations, members, institution and bulk upload.

---

# 22. Phase 3 — Executive Board

Create data model and UI for:

- Member
- Name
- Role
- Committee
- Photo
- Biography

Every active committee must satisfy its EB requirements before submission.

---

# 23. Phase 4 — Payment & Settlement

Build a secure organizer financial onboarding flow.

Capture:

- Legal entity
- PAN
- GSTIN where applicable
- Authorized representative
- Bank details
- Gateway configuration
- Refund policy
- Settlement configuration

Sensitive values must be masked and protected.

---

# 24. Phase 5 — Team & Permissions

Create:

### `organizer_members`

Suggested fields:

```text
id
organizer_id
user_id
role
status
invited_by
created_at
updated_at
```

Roles:

```text
OWNER
CONTENT_MANAGER
REGISTRATION_MANAGER
FINANCE_MANAGER
COMMUNICATIONS_MANAGER
```

Implement module-level authorization.

---

# 25. Phase 6 — Organizer Operations

Build in order:

1. Finance
2. Communications
3. Documents & Media
4. Conference Day / QR
5. Results & Awards
6. Certificates
7. Analytics
8. Settings

---

# 26. Results → Certificates Dependency

Results should be implemented before certificates.

Flow:

```text
Conference
    ↓
Attendance
    ↓
Committee/Portfolio validation
    ↓
Awards submitted
    ↓
MUNHub verification
    ↓
Certificates generated
    ↓
Stored in R2
    ↓
Email delivered
```

Certificates should never be generated from unverified results.

---

# 27. Infrastructure

Implement background jobs for:

- Bulk emails
- Certificate generation
- Exports
- Notifications
- Image processing
- Large validation jobs

Implement:

- Sentry
- PostHog
- Caching
- Queue monitoring
- Error alerts

---

# 28. Admin Improvements

After core go-live flow:

### Granular RBAC

Move from generic roles toward:

```text
SUPER_ADMIN
OPERATIONS_ADMIN
VERIFICATION_ADMIN
FINANCE_ADMIN
SUPPORT_ADMIN
MODERATOR
```

### Refunds

Do not restore the previous refund implementation directly.

Redesign with database-level concurrency protection and idempotency before production use.

---

# 29. Testing Strategy

Every pipeline transition must have tests.

### Unit tests

- Module validators
- Progress calculation
- State transitions
- SLA calculation
- Permission checks

### Integration tests

- Submit MUN
- Request changes
- Resubmit
- Approve
- Publish
- Re-verification

### Security tests

- Cross-organizer access
- IDOR
- Unauthorized publishing
- Unauthorized payment access
- Duplicate submission
- Duplicate publishing
- Race conditions

### E2E

Complete flow:

```text
Organizer login
→ Create MUN
→ Complete modules
→ Submit
→ Admin review
→ Approve
→ Publish
→ Public marketplace
```

---

# 30. Definition of Done — Go-Live Pipeline

The pipeline is production-ready when:

- [ ] Every required module has a server-side validator.
- [ ] Progress is server-authoritative.
- [ ] Incomplete MUNs cannot submit.
- [ ] Blocking issues prevent submission.
- [ ] Organizer confirmation is required.
- [ ] Submission creates immutable version.
- [ ] Admin can review module-by-module.
- [ ] Admin can request changes.
- [ ] Organizer can resubmit.
- [ ] Approval is audited.
- [ ] Approved MUN enters Go-Live Queue.
- [ ] Publishing has server-side gate.
- [ ] Unapproved MUN cannot become LIVE.
- [ ] SLA is tracked.
- [ ] Organizer sees complete timeline.
- [ ] Critical changes trigger re-verification.
- [ ] Duplicate submissions/publishing are prevented.
- [ ] Full E2E flow passes.

---

# 31. Recommended First Coding Sprint

Do NOT implement all modules at once.

### Sprint 1

**Database**
- `mun_onboarding_modules`
- `mun_validation_issues`
- `mun_go_live_submissions`
- `mun_versions`

**Backend**
- Module registry
- Completion service
- Validation service
- Submission lifecycle
- Status transition guards

**Frontend**
- `/go-live`
- Progress card
- Module checklist
- Blocking issues
- Final review

### Sprint 2

- Registration Form Builder
- Executive Board
- Payment & Settlement

### Sprint 3

- Team & Permissions
- Admin verification improvements
- Change-request UI
- SLA tracking

### Sprint 4

- Go-Live Queue
- Publishing gate
- Notifications
- Audit hardening

---

# 32. Source-of-Truth Rule

`CLAUDE.md` must be updated after every implementation phase.

It should maintain a concise implementation matrix:

```text
[x] Built
[~] Partially built
[ ] Not implemented
[D] Deferred
[W] Withdrawn
```

This prevents coding agents from confusing placeholder routes with completed features.

The Organizer Dashboard, Client/Server Rendering, Ultra-Fast Performance, and Go-Live Pipeline statuses must be explicitly tracked.

---

# 33. Golden Rules

1. Organizer owns MUN content.
2. MUNHub controls marketplace publication.
3. Client-side completion is never authoritative.
4. No incomplete MUN can be submitted.
5. No unapproved MUN can go LIVE.
6. No confirmed registration without verified payment.
7. No verified achievement without verified results.
8. High-impact changes trigger re-verification.
9. Critical actions are audited.
10. Historical approved versions must remain traceable.
11. Financial and registration history must not be silently overwritten.
12. Every exception must have a reason.
13. Publishing must be idempotent.
14. Submission must be idempotent.
15. Security and tenant isolation apply to every server action.

---

# 34. Target End State

```text
ORGANIZER APPROVED
        ↓
CREATE MUN
        ↓
GET YOUR MUN LIVE
        ↓
15 REQUIRED MODULES
        ↓
████████████████████ 100%
        ↓
AUTOMATED VALIDATION ✓
        ↓
ORGANIZER CONFIRMATION ✓
        ↓
SUBMITTED
        ↓
MUNHUB REVIEW
        │
        ├── CHANGES REQUESTED
        │       ↓
        │   FIX + RESUBMIT
        │
        └── APPROVED ✓
                ↓
          GO-LIVE QUEUE
                ↓
           PUBLISHING
                ↓
              LIVE 🚀
                ↓
        REGISTRATION OPEN
                ↓
           CONFERENCE
                ↓
        RESULTS + ATTENDANCE
                ↓
          CERTIFICATES
                ↓
          MUN PASSPORT
```

This document is the implementation-level roadmap for moving MUNHub from its current partially implemented organizer dashboard to a controlled, verified, production-ready marketplace publishing system.
