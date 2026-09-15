# MUNHub — Organizer Onboarding & Go-Live Pipeline PRD

**Product:** MUNHub  
**Module:** Organizer Onboarding & MUN Go-Live Pipeline  
**Status:** Proposed

## 1. Objective

MUNHub must provide a controlled onboarding and publishing pipeline. An organizer must not be able to directly publish a MUN to the marketplace.

**Organizer Approved → MUN Created → Onboarding → Module Completion → Automated Validation → Organizer Confirmation → MUNHub Review → Approval → Go-Live Queue → Publishing → LIVE**

The system must clearly show what is complete, what remains, what needs correction, and the current MUNHub review status.

## 2. Goals

1. Structured MUN onboarding journey.
2. Mandatory and optional modules.
3. Field/module-level completion tracking.
4. Block incomplete submissions.
5. Automated validation.
6. Payment and settlement onboarding.
7. Final organizer confirmation.
8. MUNHub verification console.
9. Change requests and resubmission.
10. One-business-day publishing SLA.
11. Complete audit trail.
12. Protection against unverified changes.
13. Clear go-live timeline.
14. `LIVE` reachable only through the approved workflow.

## 3. High-Level Workflow

```text
ORGANIZER APPLICATION
        ↓
ORGANIZER APPROVED
        ↓
MUN CREATED
        ↓
ONBOARDING
        ↓
MODULE COMPLETION
        ↓
READY FOR SUBMISSION
        ↓
AUTOMATED VALIDATION
        ↓
ORGANIZER FINAL CONFIRMATION
        ↓
SUBMITTED
        ↓
MUNHUB REVIEW
        │
        ├── CHANGES REQUESTED → ORGANIZER FIXES → RESUBMITS
        │
        └── APPROVED
                ↓
          GO-LIVE QUEUE
                ↓
            PUBLISHING
                ↓
               LIVE
```

## 4. MUN Lifecycle States

| Status | Meaning |
|---|---|
| `DRAFT` | MUN created but onboarding has not started |
| `ONBOARDING` | Organizer is entering information |
| `ACTION_REQUIRED` | Missing/invalid information exists |
| `READY_FOR_SUBMISSION` | All required modules pass validation |
| `SUBMITTED` | Organizer submitted the MUN |
| `AUTOMATED_VALIDATION` | System validates submission |
| `UNDER_REVIEW` | MUNHub team reviews it |
| `CHANGES_REQUESTED` | Corrections required |
| `APPROVED` | MUNHub approved it |
| `GO_LIVE_QUEUE` | Approved and waiting for publication |
| `PUBLISHING` | Publication in progress |
| `LIVE` | Public marketplace listing |
| `REGISTRATION_OPEN` | Public registration active |
| `REGISTRATION_CLOSED` | Registration closed |
| `CONFERENCE_ACTIVE` | Conference running |
| `COMPLETED` | Conference completed |
| `CANCELLED` | Conference cancelled |
| `UNPUBLISHED` | Previously live MUN removed |

## 5. Organizer Go-Live Workspace

The organizer gets a dedicated **Get Your MUN Live** page.

Example:

```text
🚀 GET YOUR MUN LIVE

Oxford MUN 2027

████████████████░░░░ 82%

12 / 15 required modules complete

3 actions remaining

[ Continue Setup ]
```

Display:
- Overall percentage
- Completed modules
- Remaining modules
- Required vs optional modules
- Blocking issues
- Current lifecycle status
- Submission status
- Review status
- SLA information after submission

## 6. Required Onboarding Modules

1. Basic Information
2. Dates & Venue
3. Branding & Media
4. Committees
5. Portfolios
6. Executive Board
7. Registration Types
8. Registration Form
9. Pricing & Capacity
10. Payment & Settlement
11. Rules & Documents
12. Schedule
13. Accommodation
14. Contact Information
15. Final Review & Confirmation

Optional modules may be configured by MUNHub.

## 7. Module Statuses

- `NOT_STARTED`
- `IN_PROGRESS`
- `ACTION_REQUIRED`
- `COMPLETE`
- `LOCKED`

Completion must mean all mandatory fields and validation checks pass; merely entering data is not enough.

## 8. Module Validation

Example:

```text
UNHRC

✓ Committee name
✓ Description
✓ Agenda
✓ Capacity
✗ Executive Board
✗ Portfolios
```

Result: `ACTION_REQUIRED`

The system must say exactly what remains.

## 9. Basic Information

Required:
- MUN name
- Edition
- Theme
- Description
- Organizer
- Organizer description
- Conference type
- Target participant type

Validation:
- Name non-empty.
- Description meets minimum length.
- Edition valid.
- Organizer approved.
- No duplicate active slug.

## 10. Dates & Venue

Required:
- Conference dates
- Registration opening
- Registration deadline
- Venue
- Address
- City/state/country
- Map/location

Validation:
- End date after start date.
- Registration deadline before conference start.
- Opening before deadline.
- Venue complete.

## 11. Branding & Media

Required:
- MUN logo
- Cover image

Optional:
- Gallery
- Sponsors
- Organizer logo

Store files in secure object storage such as Cloudflare R2.

## 12. Committees

Every active committee should contain:
- Name
- Description
- Agenda
- Capacity
- Committee type
- Executive Board
- Portfolio availability

Validation:
- At least one committee.
- Agenda complete.
- Capacity configured.
- Portfolios configured.
- EB configured.

## 13. Portfolios

Configure:
- Portfolio/country/role
- Availability
- Committee
- Restrictions
- Optional description

Validation:
- No duplicate portfolio within a committee.
- At least one available portfolio per active committee.
- Assignments match committee rules.

## 14. Executive Board

Each EB member:
- Name
- Role
- Committee
- Photo
- Short biography

Possible roles:
- Chair
- Vice Chair
- Director
- Rapporteur
- Custom role

Every active committee must have its required EB structure.

## 15. Registration Types

Support configurable roles:
- Delegate
- Reporter
- Journalist
- Photographer
- Videographer
- Observer
- Faculty Advisor
- Volunteer
- Independent Participant
- Custom role

The organizer chooses which are active.

## 16. Registration Modes

### Individual
One participant registers independently.

### Delegation
A group registers together.

Delegation features:
- Create delegation
- Head Delegate
- Invite members
- Join by invitation link
- Bulk member upload
- Minimum/maximum size
- Institution
- Committee preferences
- Portfolio preferences
- Accommodation information
- Group payment where applicable

Example:

```text
ABC University Delegation
Minimum: 10
Maximum: 20

Head Delegate
  ├── Member 1
  ├── Member 2
  └── Member 15
```

## 17. Registration Form Builder

Supported fields:
- Short text
- Long text
- Email
- Phone
- Number
- Dropdown
- Multiple choice
- Checkbox
- Date
- File upload
- Institution
- Academic year
- MUN experience
- Committee preference
- Portfolio preference
- Emergency contact

Conditional logic must be supported.

Example:

```text
Accommodation = Yes
        ↓
Show nights, arrival, departure, room preference
```

## 18. Pricing & Capacity

Organizer configures:
- Registration product
- Registration type
- Price
- Capacity
- Early-bird price
- Standard price
- Deadline
- Eligibility
- Benefits
- Availability

Validate non-negative prices, positive capacities, valid deadlines, and valid product/type relationships.

## 19. Payment & Settlement

This is mandatory.

### Organization details
- Legal organization name
- Organization type
- Address
- PAN
- GSTIN where applicable
- Authorized representative

### Bank details
- Account holder
- Bank
- Account number
- IFSC
- Account type

### Payment configuration
- Payment gateway
- Currency
- Refund policy
- Settlement configuration

Sensitive details must be masked in UI.

Example:

```text
Bank Account
XXXX XXXX 4821

✓ PAN submitted
✓ Bank details submitted
🟡 Account verification pending
```

## 20. Rules & Documents

Required:
- Rules
- Code of conduct
- Refund/cancellation policy

Optional:
- Brochure
- Handbook
- Delegate guide
- Position papers

## 21. Schedule

Configure:
- Opening ceremony
- Committee sessions
- Breaks
- Lunch
- Crisis sessions
- Closing ceremony
- Awards

Validate timestamps and date ranges.

## 22. Accommodation

If offered:
- Property
- Availability
- Price
- Room type
- Check-in/out
- Capacity
- Contact

If not offered, organizer explicitly selects **Accommodation Not Provided**.

## 23. Contact Information

Required:
- Official email
- Phone
- Website/social links where applicable
- Authorized contact person

## 24. Automated Validation Engine

Run a server-side validation such as:

```text
validateMunForSubmission(munId)
```

Checks:
- Organizer approved
- Basic information complete
- Dates valid
- Venue complete
- At least one committee
- Committee agendas complete
- Capacities complete
- Portfolios configured
- Executive Board configured
- Registration types/products configured
- Registration form valid
- Pricing valid
- Capacity valid
- Registration deadline valid
- Payment details submitted
- Payment verification complete
- Required documents uploaded
- Schedule valid
- Contact information complete
- Refund policy configured
- No blocking verification issues

Example failure:

```text
❌ Cannot submit

1. UNHRC has no Executive Board
2. Payment verification is pending
3. Registration deadline is before conference date
```

## 25. Final Organizer Review

When all requirements pass:

```text
🎯 READY FOR MUNHUB REVIEW

✓ 15/15 required modules complete
✓ Automated validation passed
✓ Payment information submitted
✓ Required documents uploaded
✓ No blocking issues

[ Submit for MUNHub Verification ]
```

Require explicit confirmation that the organizer is authorized and the information is accurate.

## 26. Submission Snapshot

On submission, create an immutable version/snapshot of the MUN information being reviewed.

Critical information should be locked during review where appropriate:
- Pricing
- Capacity
- Registration dates
- Committees
- Portfolios
- Payment details
- Refund policy
- Critical public information

## 27. MUNHub Admin Verification Console

Admin should see:

```text
MUN Verification

Oxford MUN 2027
Organizer: Oxford University MUN Society

Submitted: 14 Sep 2026, 10:32 AM
SLA: Publish within 1 business day

████████████████████ 100%

✓ Basic Information
✓ Dates & Venue
✓ Branding
✓ Committees
✓ Portfolios
✓ Executive Board
✓ Registration
✓ Pricing
✓ Payment
✓ Documents
✓ Schedule
✓ Accommodation
✓ Contact
```

Admin can inspect each module.

## 28. Admin Decisions

### Approve
Everything is correct → `APPROVED`.

### Request Changes
Select module + issue.

Example:
> Executive Board — UNHRC Chair information is missing.

### Reject
For serious issues. Rejection reason is mandatory.

## 29. Change Request Workflow

```text
UNDER_REVIEW
      ↓
CHANGES_REQUESTED
      ↓
ORGANIZER NOTIFIED
      ↓
ORGANIZER FIXES
      ↓
AUTOMATED VALIDATION
      ↓
READY_FOR_SUBMISSION
      ↓
RESUBMITTED
      ↓
UNDER_REVIEW
```

## 30. Organizer Review Timeline

Example:

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

Always show the current status.

## 31. One-Business-Day SLA

Once a complete valid submission enters MUNHub review, the SLA clock starts.

Target:
> Publish within 1 business day, unless changes, verification issues, or exceptional circumstances require additional review.

Store:
- Submitted time
- SLA deadline
- Review start
- Reviewer
- Decision time
- Published time

SLA states:
- `ON_TRACK`
- `DUE_SOON`
- `OVERDUE`
- `PAUSED`
- `COMPLETED`

## 32. Go-Live Queue

Approved MUNs enter:

`GO_LIVE_QUEUE`

Example:

```text
Ready to Publish

Oxford MUN 2027

✓ Approved
✓ Payment verified
✓ No blocking issues
✓ Required modules complete

[ Publish MUN ]
```

Then:

`GO_LIVE_QUEUE → PUBLISHING → LIVE`

## 33. Publishing Rules

Publishing must be blocked if:
- Organizer not approved.
- Required module incomplete.
- Automated validation fails.
- Payment verification blocks publication.
- MUNHub review incomplete.
- Blocking issue exists.
- Organizer confirmation missing.
- Required content missing.

`LIVE` must only be reachable through the approved publishing workflow.

## 34. High-Impact Changes After Approval

Changes that should trigger re-verification include:
- Price
- Capacity
- Registration deadline
- Committees
- Portfolios
- Venue
- Payment details
- Refund policy
- Major schedule changes

Workflow:

```text
LIVE
 ↓
HIGH-IMPACT CHANGE
 ↓
RE-VERIFICATION
 ↓
APPROVED
 ↓
UPDATED LIVE VERSION
```

Keep historical versions auditable.

## 35. Notifications

Organizer notifications:
- Onboarding started
- Module incomplete
- Action required
- Ready for submission
- Submission received
- Under review
- Changes requested
- Approved
- Publishing
- Published
- SLA delay

Admin notifications:
- New submission
- SLA approaching
- SLA overdue
- Resubmission
- Payment verification issue
- Critical validation failure

Initial implementation can use email; in-app notifications can follow.

## 36. Audit Logs

Log:
- Module completion/change
- Submission
- Organizer confirmation
- Review start
- Change request
- Approval/rejection
- Publishing/unpublishing
- Payment-detail changes
- High-impact changes
- Re-verification

Suggested fields:

```text
actor
actor_role
action
entity_type
entity_id
old_value
new_value
reason
timestamp
```

## 37. Recommended Database Entities

### `mun_go_live_submissions`

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

### `mun_onboarding_modules`

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
```

### `mun_validation_issues`

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

### `mun_versions`

Immutable snapshots of submitted/approved versions.

## 38. Module Keys

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

## 39. Permissions

### Organizer Owner
Can complete onboarding, edit MUN, submit, respond to changes, manage team.

### Organizer Managers
Module-specific permissions such as:
- Content Manager
- Registration Manager
- Finance Manager
- Communications Manager

### MUNHub Admins
Review, verify, approve, reject, and publish according to permissions.

## 40. Security

1. Server-side authorization on every mutation.
2. Never trust client-side completion.
3. Validate required fields server-side.
4. Verify payment webhooks.
5. Encrypt/mask sensitive payment information.
6. Prevent IDOR across organizers/MUNs.
7. Validate uploaded files.
8. Restrict file types/sizes.
9. Maintain audit logs.
10. Immutable submission snapshots.
11. Idempotent submission/publishing.
12. Explicit confirmation for critical operations.
13. Future two-person approval for high-risk admin actions.
14. Never expose secrets to client components.

## 41. Performance

Targets:
- Button visual response: <50ms
- Normal UI acknowledgement: <100ms
- API p50: <100ms
- API p95: <300ms
- Database p50: <50ms
- Initial meaningful content: <1s where practical

Long operations should be asynchronous:
- Bulk email
- Certificates
- Large exports
- File processing
- Large validation jobs
- Publishing jobs

## 42. Rendering

### Server
Use server rendering for:
- Go-live status
- MUN configuration
- Verification status
- Initial dashboard state
- Public MUN pages

### Client
Use client components for:
- Form builder
- Drag/drop
- Interactive tables
- Modals
- Filters
- Upload UI
- Interactive progress

The server remains authoritative for completion, validation, permissions, payment status, submission, approval, and publishing.

## 43. Implementation Order

### Phase 1 — Foundation
1. Lifecycle/state machine
2. `mun_onboarding_modules`
3. Completion engine
4. Validation issues
5. Progress calculation
6. Go-live dashboard

### Phase 2 — Required Modules
7. Registration Form Builder
8. Executive Board
9. Payment & Settlement
10. Team & Permissions
11. Remaining required content modules

### Phase 3 — Submission
12. Automated validation
13. Final confirmation
14. Submission snapshots/versioning
15. Critical-field locking

### Phase 4 — MUNHub Review
16. Verification queue
17. Module review
18. Change requests
19. Resubmission
20. Approval/rejection

### Phase 5 — Publishing
21. Go-live queue
22. SLA tracking
23. Publishing workflow
24. Marketplace activation
25. Notifications

### Phase 6 — Hardening
26. Audit logs
27. Re-verification
28. Background jobs
29. Monitoring
30. Performance optimization
31. Security testing
32. Load testing

## 44. Acceptance Criteria

### Organizer
- [ ] Can create a MUN.
- [ ] Sees all required modules.
- [ ] Every module has a status.
- [ ] Progress is accurate.
- [ ] Missing required fields are identified.
- [ ] Cannot submit incomplete MUN.
- [ ] Automated validation runs before submission.
- [ ] Must explicitly confirm submission.
- [ ] Can see review status.
- [ ] Receives change requests.
- [ ] Can fix and resubmit.
- [ ] Sees approval/publishing status.

### Admin
- [ ] Sees submissions.
- [ ] Can inspect every module.
- [ ] Can request changes.
- [ ] Can approve.
- [ ] Can reject with reason.
- [ ] Can see SLA.
- [ ] Can publish approved MUNs.
- [ ] Publishing is blocked when requirements fail.
- [ ] Critical actions create audit logs.

### System
- [ ] Submission snapshot created.
- [ ] High-impact changes trigger re-verification.
- [ ] Status transitions validated server-side.
- [ ] Payment details protected.
- [ ] Tenant isolation enforced.
- [ ] Submission/publishing idempotency implemented.

## 45. Final Product Experience

```text
WELCOME TO MUNHUB

Let's get your MUN live.

████████████████░░░░ 82%
12 / 15 modules complete

        ↓

Fix remaining issues

        ↓

100% COMPLETE

        ↓

Automated validation ✓

        ↓

Confirm & Submit

        ↓

MUNHUB TEAM REVIEW
Target: within 1 business day

        ↓

APPROVED ✓

        ↓

GO-LIVE QUEUE

        ↓

PUBLISHED 🚀

        ↓

Your MUN is now LIVE on MUNHub.
```

This pipeline is the controlled gateway between an organizer's workspace and the public MUNHub marketplace.
