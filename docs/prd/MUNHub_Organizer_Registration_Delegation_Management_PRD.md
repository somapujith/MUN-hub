# MUNHub — Organizer Registration & Delegation Management PRD

**Document type:** Implementation PRD  
**Audience:** Claude Code / engineering agent  
**Product:** MUNHub  
**Primary objective:** Build a production-grade registration, delegation, allocation, and registration-operations system for organizers without duplicating or replacing the existing Organizer Go-Live pipeline.

---

## 1. Mission

Build the complete **Organizer Registration & Delegation Management** system for MUNHub.

The system must support the real-world ways students participate in MUNs:

- Individual Delegate
- Reporter / Press
- Observer
- Faculty / Teacher / Accompanying participant
- Other organizer-defined participation types

It must also support **group/delegation registration**, where one Head Delegate or authorized person registers a group of participants, manages invitations, and eventually gets the group allocated to committees/portfolios.

Integrate with:

- Organizer MUN setup
- Registration Types
- Registration Form Builder
- Pricing and capacity
- Payment state
- Committee capacity
- Portfolio allocation
- Organizer roster
- Waitlists
- Cancellation
- Refund architecture
- Notifications
- Audit history
- CSV/XLSX export

### Critical instruction

**Do not rebuild the existing Organizer Go-Live/onboarding pipeline.**

The current codebase already has registration products, a registration roster, capacity protection, registration-form backend pieces, and Go-Live backend infrastructure. Extend the existing architecture instead of creating parallel systems.

---

# 2. Current Codebase Reality

The primary working product is the **Next.js `app/` application** with real sessions, database access, and Server Actions.

The Hono `server/` application exists as a standalone API from migration work but is not yet the primary UI data source.

The Vite `web/` application is currently a UI rehearsal shell with mock data and should not be treated as the production source of truth until migration/cutover.

Therefore:

> Implement this feature in the existing Next.js architecture first, following current project conventions.

Do not migrate the entire feature to Vite as part of this PRD.

---

# 3. Product Model

Keep these concepts separate.

## 3.1 Registration Type

Defines **what kind of participant someone is**.

Examples:

- Delegate
- Reporter
- Observer
- Faculty
- Organizer-defined custom type

Each MUN should be able to configure:

- Name
- Description
- Active/inactive state
- Price
- Capacity rules
- Whether individual registration is allowed
- Whether delegation registration is allowed
- Required/optional form fields
- Eligibility restrictions if supported
- Display order

Do not hard-code these types.

---

## 3.2 Registration Mode

Defines **how the registration is created**:

```text
INDIVIDUAL
DELEGATION
```

An individual registration belongs directly to one participant.

A delegation contains multiple participant registrations under a common delegation/institution entity.

---

## 3.3 Participant

The actual person attending the MUN.

A participant can have:

- Name
- Email
- Phone
- Institution
- Registration type
- Registration
- Delegation membership when applicable
- Committee assignment
- Portfolio assignment
- Payment state
- Registration status

Avoid unnecessary duplication of user-account data.

---

## 3.4 Delegation

A group registration representing a school, college, university, institution, or team.

Support:

- Delegation name
- Institution
- Head Delegate
- Head Delegate contact details
- Registration type/default participation type
- Requested member count
- Confirmed member count
- Payment state
- Delegation status
- Invitation/join mechanism
- Notes
- Created/updated timestamps

Example:

```text
Oxford MUN Delegation
        |
        ├── Head Delegate
        ├── Delegate 1
        ├── Delegate 2
        ├── Delegate 3
        ├── ...
        └── Delegate 15
```

The implementation must comfortably support **15–20+ participants** in one delegation without special-case logic.

---

# 4. Roles & Permissions

Use the project's existing authentication and authorization patterns.

Do not introduce a separate permission system.

### Participant

Can:

- View own registration
- Complete own registration details
- View payment state
- View committee/portfolio assignment
- Join a delegation through an invitation
- Leave a delegation where policy allows
- View registration confirmation

### Head Delegate

Can additionally:

- Create/manage a delegation
- Invite members
- Copy invite links
- See member completion status
- Manage eligible member details
- Submit delegation
- View delegation-level confirmation

### Organizer

Can:

- View registrations for their MUNs
- Search/filter registrations
- View participant details
- View delegation details
- Assign committees
- Assign portfolios
- Manage waitlists
- Cancel registrations according to policy
- Initiate supported refund workflows
- Export registration data
- View payment states
- Audit changes

### Admin

Can perform organizer-level operations plus platform-level oversight according to existing RBAC.

Do not silently expand the existing admin role model unless required by the existing architecture.

---

# 5. Registration Lifecycle

Use an explicit lifecycle compatible with the existing schema.

Recommended:

```text
DRAFT
PENDING_PAYMENT
PAYMENT_PENDING_CONFIRMATION
CONFIRMED
WAITLISTED
CANCELLED
REFUND_PENDING
REFUNDED
REJECTED
```

Payment status is separate:

```text
NOT_REQUIRED
PENDING
PAID
FAILED
REFUND_PENDING
REFUNDED
```

Do not conflate registration status and payment status.

---

# 6. Delegation Lifecycle

Recommended:

```text
DRAFT
OPEN
PARTIALLY_FILLED
FULL
SUBMITTED
CONFIRMED
CANCELLED
```

Follow existing project conventions if equivalent states already exist.

A delegation may be empty, partially filled, full, submitted, confirmed, or cancelled.

---

# 7. Registration Form Builder

Complete the existing registration-form backend/UI rather than creating another form system.

Support at minimum:

- Short text
- Long text
- Email
- Phone
- Number
- Date
- Select
- Multi-select
- Radio
- Checkbox
- File upload if existing storage supports it

Each field supports:

- Label
- Description/help text
- Required/optional
- Display order
- Validation
- Options
- Conditional visibility where supported

Preserve existing conditional/reordering capabilities.

All forms must be scoped to the correct MUN.

---

# 8. Registration Types Management

Organizer route:

```text
Organizer → MUN → Registrations → Registration Types
```

Actions:

- Create
- Edit
- Activate/deactivate
- Set price
- Configure individual/delegation availability
- Configure capacity where applicable
- Reorder

Example:

| Type | Individual | Delegation | Price | Status |
|---|---|---|---:|---|
| Delegate | ✓ | ✓ | ₹1,500 | Active |
| Reporter | ✓ | ✗ | ₹1,000 | Active |
| Observer | ✓ | ✗ | ₹750 | Active |
| Faculty | ✓ | ✓ | ₹0 | Active |

These must be configurable, not hard-coded.

---

# 9. Individual Registration Flow

Student flow:

```text
MUN Detail
   ↓
Choose Registration Type
   ↓
Choose Individual
   ↓
Registration Form
   ↓
Review
   ↓
Payment
   ↓
Confirmation
```

Extend the existing flow.

Requirements:

- Preserve current capacity protection
- Preserve current payment/webhook architecture
- Prevent duplicate registrations according to existing rules
- Validate fields server-side
- Recalculate price server-side
- Ensure MUN is published/accepting registrations

Never trust client-submitted price or capacity values.

---

# 10. Delegation Registration Flow

Student flow:

```text
MUN Detail
   ↓
Choose Registration Type
   ↓
Choose Delegation
   ↓
Create Delegation
   ↓
Add Head Delegate
   ↓
Set expected member count
   ↓
Payment / payment arrangement
   ↓
Invite members
   ↓
Members complete forms
   ↓
Delegation becomes complete
   ↓
Organizer allocation
   ↓
Confirmation
```

Prefer an invitation-driven workflow rather than forcing all members to register before the delegation can exist, unless the existing authentication architecture requires otherwise.

---

# 11. Head Delegate Dashboard

Example:

```text
Delegation
Oxford MUN Delegation

15 members
12 completed
2 pending
1 invited

Payment
PAID

Allocation
8 / 15 assigned
```

Actions:

- Invite member
- Copy invite link
- Resend invite
- Remove member
- Edit eligible member data
- Submit delegation
- View assignments

Incomplete members must be obvious.

---

# 12. Delegation Invitations

Implement secure invitation tokens.

Requirements:

- Cryptographically secure token
- Expiration
- Single-use or controlled reuse
- No private participant data in URL
- Server-side validation
- Invitation status
- Created/accepted timestamps
- Revocation where appropriate

Flow:

```text
Create invitation
→ member opens link
→ login/signup if required
→ accepts
→ member becomes part of delegation
```

---

# 13. Bulk Registration Import

Organizer flow:

```text
Registrations
→ Import
→ Download CSV template
→ Upload CSV
→ Validate
→ Preview errors
→ Confirm import
```

Show row-level errors:

```text
Row 8:
Invalid email

Row 11:
Registration type "Reporter" is unavailable

Row 17:
Duplicate participant
```

Validate before creating registrations.

Avoid destructive partial imports. Prefer transactional behavior or an explicit partial-success report.

---

# 14. Committee Allocation

Organizers must be able to assign participants to committees.

Examples:

```text
UNGA
UNHRC
UNSC
AIPPM
Press
```

Respect:

- Committee capacity
- Registration-type eligibility
- MUN-specific configuration
- Existing committee records

Actions:

- Assign
- Reassign
- Unassign
- Bulk assign
- Filter unassigned

Capacity must be protected server-side with transactions/atomic checks where required.

---

# 15. Portfolio Allocation

Support assignment after committee assignment.

Example:

```text
Committee: UNGA

Country:
India

Portfolio:
Prime Minister
```

Actions:

- Assign
- Reassign
- Unassign
- View occupied portfolios

Prevent duplicate assignments where portfolios are unique.

Not every committee or registration type requires a portfolio.

---

# 16. Allocation Board

Build an operational allocation screen:

```text
-----------------------------------------------------
Registrations     Unassigned: 42
-----------------------------------------------------

Filters
[Committee] [Registration Type] [Status] [Search]

-----------------------------------------------------
Participant       Type       Committee      Portfolio
-----------------------------------------------------
Aarav             Delegate   UNGA           India
Ananya            Delegate   UNGA           USA
Rahul             Reporter   Press          —
-----------------------------------------------------
```

Actions:

- Bulk assign
- Quick assign
- Search
- Filter
- Unassigned-only
- Export
- Drag-and-drop only if it genuinely improves reliability/UX

Reliability is more important than animation.

---

# 17. Capacity Management

Potential capacity levels:

- MUN total
- Registration type
- Committee
- Delegation
- Accommodation where applicable

All capacity enforcement must happen server-side.

Never trust browser values such as:

```text
availableSeats
remainingCapacity
price
```

Use database-backed transactions/constraints for race-sensitive operations.

Preserve the existing anti-oversell implementation.

---

# 18. Waitlist

When a registration type or committee is full:

```text
Register
→ capacity unavailable
→ Join Waitlist
```

Store:

- Participant
- MUN
- Registration type
- Requested committee where applicable
- Position
- Created time
- Status

Recommended states:

```text
WAITING
OFFERED
ACCEPTED
EXPIRED
REMOVED
```

Organizer-controlled promotion is acceptable as the first implementation.

---

# 19. Organizer Registration Dashboard

Route:

```text
Organizer
→ MUN
→ Registrations
```

Summary:

- Total registrations
- Confirmed
- Pending payment
- Waitlisted
- Cancelled
- Unassigned
- Delegations

Table:

- Participant
- Registration type
- Mode
- Delegation
- Institution
- Committee
- Portfolio
- Payment
- Status
- Created
- Actions

Filters:

- Registration status
- Payment status
- Registration type
- Individual/delegation
- Delegation
- Committee
- Assignment status
- Search

Use server-side filtering/pagination for large datasets.

---

# 20. Delegations Dashboard

Route:

```text
Organizer
→ MUN
→ Registrations
→ Delegations
```

Columns:

- Delegation
- Institution
- Head Delegate
- Members
- Completion
- Payment
- Status
- Created
- Actions

Example:

```text
Oxford MUN       15/15     Paid       Confirmed
Delhi Public     12/15     Paid       Submitted
ABC College      8/10      Pending    Open
```

Clicking a delegation opens its management page.

---

# 21. Registration Detail

Organizer view should contain:

```text
Participant
Registration
Payment
Delegation
Committee
Portfolio
Form Responses
Audit History
```

Actions must be permission-aware.

Expose only necessary sensitive information.

---

# 22. Cancellation

Cancellation must:

1. Validate authorization
2. Validate current state
3. Update registration state
4. Release relevant capacity
5. Update delegation counts
6. Create audit record
7. Trigger required notification
8. Start refund workflow if eligible

Never mark a paid registration `REFUNDED` unless the refund actually completed.

Use `REFUND_PENDING` where appropriate.

---

# 23. Refund Architecture

There has previously been instability around refund implementation.

Therefore:

> Do not reintroduce a fragile direct refund mutation.

Preferred lifecycle:

```text
Cancellation
   ↓
Refund eligibility check
   ↓
Refund request
   ↓
REFUND_PENDING
   ↓
Gateway/refund processor
   ↓
Webhook/verified result
   ↓
REFUNDED
```

Refund operations must be idempotent.

If real gateway refunds are still deferred, implement the correct state machine/workflow without falsely claiming money was returned.

---

# 24. Payment Integration

Reuse the existing payment architecture.

Rules:

- Server calculates amount
- Server validates registration type price
- Payment references registration/delegation
- Webhook is authoritative for confirmation
- Frontend success callback is not final payment proof
- Payment status is independently queryable
- Failed payments are retryable where appropriate

Do not create a second payment system.

---

# 25. Notifications

Build against the project's future email abstraction.

Events:

### Participant

- Registration created
- Payment confirmed
- Registration confirmed
- Waitlisted
- Committee assigned
- Portfolio assigned
- Cancellation
- Refund status
- Delegation invitation

### Head Delegate

- Delegation created
- Member joined
- Member pending
- Payment confirmed
- Delegation submitted
- Allocation completed

### Organizer

- New registration
- Delegation submitted
- Payment exception
- Capacity threshold
- Waitlist activity

If real email delivery is not enabled, create events/abstractions without pretending an email was sent.

---

# 26. CSV/XLSX Export

CSV is mandatory.

Include:

- Registration ID
- Participant name
- Email
- Phone
- Institution
- Registration type
- Registration mode
- Delegation
- Head Delegate
- Payment status
- Registration status
- Committee
- Portfolio
- Created date

Exports must respect current filters and organizer/MUN authorization.

XLSX may be added if it fits the existing stack cleanly.

---

# 27. Audit History

Track important mutations:

```text
Registration created
Payment confirmed
Status changed
Committee assigned
Portfolio assigned
Registration cancelled
Refund requested
Refund completed
Delegation created
Member joined
Member removed
Bulk import executed
```

Capture:

- Actor
- Action
- Entity
- Entity ID
- Timestamp
- Before/after information where practical

Audit logs should be append-only.

---

# 28. Data Model Guidance

Before adding tables/models:

1. Inspect the existing schema.
2. Reuse existing registration/product/committee/portfolio/user models.
3. Extend instead of duplicating.
4. Add migrations safely.
5. Preserve existing data.

Potential conceptual entities:

```text
RegistrationType
Registration
Delegation
DelegationMember
DelegationInvitation
RegistrationForm
RegistrationFormField
RegistrationFormResponse
CommitteeAssignment
PortfolioAssignment
WaitlistEntry
RefundRequest
RegistrationAuditEvent
```

These are conceptual, not instructions to blindly create every table.

Normalize appropriately and avoid unnecessary participant-data duplication.

---

# 29. Security

This feature handles participant information and payment state.

Required:

- Server-side authorization
- MUN ownership checks
- Organizer authorization checks
- Input validation
- Secure invitation tokens
- No sensitive data in URLs
- No client-trusted pricing
- No client-trusted capacity
- No client-trusted payment confirmation
- Rate limiting on invitation-sensitive endpoints where supported
- Safe CSV parsing
- File validation for uploads
- Audit logging for privileged mutations

Explicitly test:

```text
Organizer A must not access Organizer B's registration.
```

---

# 30. Concurrency

Protect against:

- Registration capacity overselling
- Committee capacity overselling
- Duplicate portfolio allocation
- Duplicate refunds
- Duplicate invitation acceptance
- Duplicate delegation membership
- Duplicate bulk import

Use appropriate database constraints and transactions.

Add uniqueness constraints only where they accurately represent business rules.

---

# 31. UX Requirements

The organizer UI is an operational ERP-style workspace.

It should be:

- Clean
- Dense but readable
- Fast
- Minimal
- Professional
- Desktop-first
- Responsive
- Easy to scan
- Consistent with the existing Organizer dashboard

Avoid:

- Giant decorative cards
- Excessive gradients
- Unnecessary animation
- Deep modal nesting
- Confusing terminology
- Hiding important status information

Use clear status badges and progressive disclosure.

---

# 32. Recommended MUN Navigation

```text
Overview

Setup
  Basic Info
  Dates & Venue
  Branding
  Committees
  Portfolios
  Executive Board
  Registration Types
  Registration Form
  Pricing & Capacity
  Payment & Settlement
  Accommodation
  Rules & Documents
  Schedule
  Contact

Operations
  Registrations
  Delegations
  Allocation
  Waitlist

Final
  Review & Go Live
```

Do not duplicate the existing Go-Live navigation.

---

# 33. Registrations UX

Use a data-table-first approach:

```text
Registrations

[Search registrations...]

[All] [Confirmed] [Pending] [Waitlisted] [Cancelled]

Filters ▾                         Export ↓

------------------------------------------------------------
Name       Type       Delegation    Committee   Payment Status
------------------------------------------------------------
Aarav      Delegate   Oxford        UNGA        Paid
Ananya     Reporter   —             Press       Paid
Rahul      Delegate   Delhi Public  UNHRC       Pending
------------------------------------------------------------
```

Bulk actions:

```text
Assign Committee
Assign Portfolio
Cancel
Export
```

Only show actions valid for the selected records.

---

# 34. Delegation UX

Dedicated delegation detail page:

```text
Delegation Header
--------------------------------
Oxford MUN
15 members
12 completed
Paid
Confirmed

Members
--------------------------------
Name       Role       Status      Committee
...

Allocation
--------------------------------
Committee / Portfolio assignments

Activity
--------------------------------
Timeline of important events
```

---

# 35. Empty / Loading / Error States

Every major screen must have deliberate states.

Empty:

```text
No registrations yet.
Once students register, they'll appear here.
```

Loading:

- Use skeletons instead of blank screens.

Error:

- Explain the issue and provide retry.

Permission:

```text
You don't have permission to manage registrations for this MUN.
```

---

# 36. Performance

The system may eventually handle thousands of participants.

Therefore:

- Server-side pagination
- Server-side filtering
- Debounced search
- Proper database indexes
- Avoid N+1 queries
- Lazy-load heavy detail sections
- Safe bulk operations
- Do not render thousands of rows at once

Do not introduce a new caching layer unless the existing architecture requires it.

---

# 37. Accessibility

Required:

- Keyboard-navigable tables
- Visible focus states
- Semantic labels
- Accessible dialogs
- Accessible status indicators
- Status cannot rely on color alone
- Clear form errors

---

# 38. Server Actions / API Operations

Follow existing project conventions.

Potential operations:

```text
createRegistrationType
updateRegistrationType
toggleRegistrationType

createRegistration
updateRegistration
cancelRegistration

createDelegation
updateDelegation
inviteDelegationMember
acceptDelegationInvitation
removeDelegationMember
submitDelegation

assignCommittee
bulkAssignCommittee
assignPortfolio
bulkAssignPortfolio

joinWaitlist
promoteWaitlistEntry

importRegistrations
exportRegistrations

requestRefund
```

These names are illustrative.

Reuse existing actions when equivalent functionality already exists.

Every mutation should follow:

```text
Authentication
→ Authorization
→ Input validation
→ Business-rule validation
→ Database mutation
→ Audit event
→ Notification/event
```

---

# 39. Testing Requirements

Add tests for critical rules.

## Registration

- Valid registration
- Invalid registration
- Duplicate registration
- Full capacity
- Concurrent capacity requests
- Price tampering
- Unauthorized access

## Delegation

- Create delegation
- Add member
- Accept invitation
- Expired invitation
- Duplicate invitation acceptance
- Remove member
- Completion
- 15–20+ members

## Allocation

- Committee assignment
- Full committee
- Concurrent assignment
- Portfolio assignment
- Duplicate portfolio
- Reassignment

## Payments

- Pending
- Success
- Webhook confirmation
- Duplicate webhook
- Failure
- Refund pending
- Duplicate refund request

## Security

- Cross-MUN access
- Cross-organizer access
- Unauthorized mutation
- Invalid invitation token

## Import

- Valid CSV
- Invalid CSV
- Duplicate rows
- Invalid registration type
- Capacity overflow
- Transaction/partial-failure behavior

---

# 40. Acceptance Criteria

The feature is complete only when:

### Registration Types

- Organizer can create/edit/disable registration types.
- Individual/delegation availability is configurable.
- Pricing is enforced server-side.

### Individual Registration

- Student can register for an available type.
- Form data is saved.
- Capacity cannot be oversold.
- Payment state is accurate.
- Confirmation occurs only after valid confirmation conditions.

### Delegations

- Head Delegate can create a delegation.
- Delegation supports 15–20+ members.
- Members can join through secure invitations.
- Head Delegate sees completion state.
- Organizer can manage the entire delegation.

### Allocation

- Organizer can assign committees.
- Organizer can assign portfolios where applicable.
- Capacity constraints are enforced.
- Bulk assignment works safely.

### Operations

- Search/filter registrations works.
- Search/filter delegations works.
- Registration export works.
- Waitlist works.
- Cancellation follows valid transitions.
- Refund workflow never falsely claims a refund.

### Security

- Cross-MUN access is blocked.
- Cross-organizer access is blocked.
- Server validates privileged mutations.

### Reliability

- Critical race conditions are protected by database constraints/transactions.
- Existing marketplace, registration, and payment behavior continues working.

---

# 41. Implementation Order

## Phase 1 — Audit Existing System

Before coding:

- Inspect schema/database models.
- Inspect existing registration actions.
- Inspect registration products/types.
- Inspect registration-form backend.
- Inspect committee/portfolio models and actions.
- Inspect payment/webhook logic.
- Inspect current organizer registration pages.
- Inspect enums/statuses.
- Inspect audit/event infrastructure.
- Inspect authorization helpers.

Create a short internal implementation map before structural changes.

**Do not create duplicate models when equivalent functionality exists.**

---

## Phase 2 — Registration Types + Form Builder UI

Finish:

- Registration Types UI
- Registration Form Builder UI
- Validation
- Preview
- Save/publish behavior

Use existing backend capabilities.

---

## Phase 3 — Registration Data Model

Extend schema only where necessary:

- Delegation
- Delegation members
- Invitations
- Waitlist
- Allocation relations
- Refund request/state if missing
- Audit events if missing

Create safe migrations.

---

## Phase 4 — Delegation Registration

Build:

- Create delegation
- Head Delegate
- Member invitations
- Join flow
- Member management
- Completion tracking
- Delegation submission

---

## Phase 5 — Organizer Registration Operations

Build:

- Registration dashboard
- Registration detail
- Delegation dashboard
- Delegation detail
- Search/filter
- Status management

---

## Phase 6 — Allocation

Build:

- Committee assignment
- Portfolio assignment
- Bulk allocation
- Capacity protection
- Unassigned views

---

## Phase 7 — Waitlist + Cancellation + Refund State Machine

Implement:

- Waitlist
- Promotion
- Cancellation
- Refund request
- Refund status
- Idempotency

Do not fake completed refunds.

---

## Phase 8 — Import / Export

Build:

- CSV template
- CSV validation
- Preview
- Import
- CSV export
- XLSX export if cleanly supported

---

## Phase 9 — Notifications + Audit

Wire:

- Registration events
- Delegation events
- Allocation events
- Payment events
- Cancellation/refund events

Add audit timeline.

---

## Phase 10 — Testing / Hardening

Run:

- Unit tests
- Integration tests
- Authorization tests
- Concurrency tests
- Import tests
- Payment/webhook tests
- Existing regression suite

Then perform a full UI/UX pass.

---

# 42. Claude Code Execution Rules

### Rule 1 — Inspect before modifying

Search the repository and understand the existing architecture first.

### Rule 2 — Reuse existing code

If a model/action/helper already exists, extend it.

Do not create parallel implementations.

### Rule 3 — Preserve existing functionality

Existing marketplace, registration, payment, organizer setup, and Go-Live functionality must continue working.

### Rule 4 — No fake completion

A feature is complete only when:

```text
UI
+
Server action/API
+
Database
+
Authorization
+
Validation
+
Error handling
+
Tests
```

are correctly integrated.

### Rule 5 — No client-side trust

Never trust browser-supplied:

- Price
- Capacity
- Payment success
- MUN ownership
- Organizer permissions
- Assignment availability

### Rule 6 — Strict tenant boundaries

Every registration query/mutation must be scoped to the correct MUN/organizer context.

### Rule 7 — Follow the current design system

Use existing Tailwind/shadcn/ui conventions.

Do not introduce a new component library without a strong reason.

### Rule 8 — Do not rebuild Go-Live

The existing Go-Live pipeline is separate.

Integrate with it where required; do not replace it.

### Rule 9 — Safe migrations

Protect existing data.

### Rule 10 — Explain blockers

If the current architecture blocks safe implementation:

1. Identify the blocker.
2. Explain the smallest required architectural change.
3. Implement the safe path.
4. Never silently introduce fragile workarounds.

---

# 43. Definition of Done

An organizer should be able to realistically run registrations for a real MUN:

```text
Create MUN
   ↓
Configure registration types
   ↓
Configure registration form
   ↓
Publish MUN
   ↓
Student registers individually
        OR
Head Delegate creates delegation
   ↓
Members join
   ↓
Payments confirmed
   ↓
Organizer sees live roster
   ↓
Organizer filters/searches
   ↓
Organizer assigns committees
   ↓
Organizer assigns portfolios
   ↓
Organizer manages waitlist/cancellations
   ↓
Organizer exports final roster
   ↓
Audit trail exists
```

The result must feel like a **real conference operations platform**, not a collection of CRUD pages.

---

# 44. Final Engineering Principle

Treat registration as a **core transactional system**, not simply a form.

Priorities:

1. Correctness
2. Capacity safety
3. Payment correctness
4. Authorization
5. Delegation workflows
6. Allocation reliability
7. Operational visibility
8. Auditability
9. Performance
10. Clean UX

Build the smallest correct architecture that can scale from a single 100-person MUN to multiple conferences with thousands of registrations, without unnecessary complexity.
