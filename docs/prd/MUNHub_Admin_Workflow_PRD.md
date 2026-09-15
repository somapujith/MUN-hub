# MUNHub — Admin Workflow PRD

**Version:** 1.0  
**Product:** MUNHub  
**Module:** Internal Admin / Operations Platform

## 1. Purpose

The MUNHub Admin Platform is the internal control center for organizer verification, MUN verification, moderation, payments, refunds, support, results, certificates, risk management and platform operations.

**Core principle:** Organizers operate their conferences; MUNHub controls trust, verification and exceptional actions.

---

## 2. Admin Roles

### Super Admin
Full platform access. Manages admins, permissions, emergency controls and critical overrides.

### Operations Admin
Reviews organizers and MUNs, requests changes, approves, publishes and monitors conferences.

### Verification Admin
Handles organizer, MUN, document, EB, result and certificate verification.

### Finance Admin
Handles payment monitoring, reconciliation, refunds, disputes and settlements.

### Support Admin
Handles user/organizer support and registration issues.

### Moderator
Reviews reported content and policy violations.

All roles use RBAC and server-side authorization.

---

## 3. Admin Navigation

1. Overview
2. Applications
3. MUNs
4. Verification
5. Registrations
6. Payments
7. Refunds & Disputes
8. Organizers
9. Users
10. Results & Awards
11. Certificates
12. Support
13. Moderation
14. Communications
15. Analytics
16. System Alerts
17. Audit Logs
18. Team & Permissions
19. Platform Settings

---

## 4. Overall Admin Workflow

```text
New Activity
    ↓
Automated Validation
    ↓
Admin Queue
    ↓
Review
    ↓
Approve / Request Changes / Reject / Escalate
    ↓
Action Executed
    ↓
Notification
    ↓
Audit Log
    ↓
Monitor
```

Every important decision must be traceable.

---

# 5. Organizer Application Workflow

```text
Application Submitted
        ↓
Automated Validation + Risk Screening
        ↓
Admin Review
        ↓
Approve / Request Changes / Reject / Escalate
        ↓
Organizer Notification
        ↓
Approved → Organizer Workspace
```

### Automated checks
- Duplicate organization/email/phone
- Duplicate MUN
- Missing documents
- Invalid files
- Suspicious patterns
- Potential policy issues

### Admin checks
- Organization legitimacy
- Representative identity/authority
- Previous event history
- Website/social presence
- Venue/event credibility
- Supporting documents

### Required decision data
- Admin ID
- Decision
- Reason
- Timestamp
- Application version

---

# 6. MUN Verification Workflow

The organizer can create and edit a draft without continuous admin review.

```text
Organizer Draft
    ↓
Completeness Validation
    ↓
Organizer Final Confirmation
    ↓
Submission Snapshot
    ↓
Automated Validation
    ↓
Admin Verification Queue
    ↓
Field / Module Review
    ↓
Verified / Changes Requested / Rejected
```

### Automated validation
- Dates are valid
- Venue and contact exist
- Pricing and capacity exist
- Registration deadlines are logical
- Committee capacities are valid
- No duplicate portfolios
- Required EB fields exist
- Documents meet upload rules

---

# 7. Admin Verification Workspace

Recommended layout:

```text
----------------------------------------------------
| MUN INFORMATION        | VERIFICATION PANEL      |
|                        |                         |
| General                | ✓ Verified              |
| Dates & Venue          | ✓ Verified              |
| Committees             | ⚠ Review                |
| Portfolios             | ✓ Verified              |
| Executive Board        | ⚠ Review                |
| Pricing                | ✓ Verified              |
| Registration Form      | ✓ Verified              |
| Documents              | ⚠ Review                |
----------------------------------------------------
```

Admin can review at module and field level.

### Checklist
- Organizer
- MUN name/edition
- Dates
- Venue/location
- Committees/agendas
- Portfolios
- Executive Board
- Products/pricing
- Capacity/deadlines
- Rules/refund policy
- Schedule/FAQs/contact
- Logo/cover/brochure/gallery

---

# 8. Admin Decision Model

## Approve
All mandatory information is valid.

`VERIFIED`

## Request Changes
Admin identifies the exact module/field, severity and correction.

Example:

> Venue address is incomplete. Please provide the complete address and supporting confirmation.

`CHANGES_REQUESTED`

## Reject
Used for false information, unauthorized events, fraud, serious policy violations or repeated failed verification.

A rejection reason is mandatory.

## Escalate
Used for legal, safety, serious payment, fraud or other cases requiring senior review.

---

# 9. Changes Requested Workflow

```text
Admin Requests Changes
        ↓
Organizer Notification
        ↓
Organizer Fixes Required Fields
        ↓
Organizer Confirms Changes
        ↓
Resubmission
        ↓
Admin Re-review
```

Only affected sections should return to `PENDING_REVIEW` where possible.

---

# 10. Publishing Gate

A MUN can be published only when all conditions are satisfied:

```text
Organizer Approved
      +
Required Content Complete
      +
Organizer Final Confirmation
      +
MUNHub Verification
      +
No Blocking Issues
      ↓
PUBLISH
```

The backend must enforce this. The UI alone must never be the security boundary.

---

# 11. Re-verification Workflow

Important changes after verification must trigger re-verification.

High-impact changes include:
- MUN name
- Date
- Venue
- Price
- Capacity
- Committee
- Agenda
- Executive Board
- Refund policy
- Registration terms

```text
Verified MUN
    ↓
High-impact Edit
    ↓
Verification Invalidated
    ↓
Organizer Re-confirms
    ↓
Admin Re-verifies
    ↓
Verified Again
```

Low-risk changes can use lighter review.

---

# 12. Unpublish / Suspend Workflow

```text
Issue / Report / Organizer Request
        ↓
Admin Review
        ↓
Suspend or Unpublish
        ↓
Stop New Registrations
        ↓
Notify Organizer
        ↓
Audit Log
```

Suspension should hide the MUN from discovery and prevent new orders while preserving existing registrations and historical records.

---

# 13. Conference Cancellation Workflow

```text
Cancellation Request
      ↓
Admin Review
      ↓
Suspend Registration
      ↓
Freeze New Orders
      ↓
Determine Refund Treatment
      ↓
Process Eligible Refunds
      ↓
Notify Students
      ↓
Mark CANCELLED
```

Use a dedicated cancellation checklist and preserve all transaction history.

---

# 14. Registration Monitoring

Global search should support:
- Registration ID
- Student
- Organizer
- MUN
- Committee
- Portfolio
- Payment ID
- Order ID

Admin normally has read-only access. Operational corrections require elevated permission and an audit reason.

---

# 15. Payment Monitoring

```text
Payment Received
      ↓
Webhook
      ↓
Signature Verification
      ↓
Amount Verification
      ↓
Order Match
      ↓
Registration Confirmation
```

Automatically flag:
- Failed payments
- Duplicate attempts
- Amount mismatch
- Webhook failures
- Unusual transaction patterns
- Refund failures
- Settlement mismatch

Mismatch state: `PAYMENT_EXCEPTION`

---

# 16. Refund Workflow

```text
Refund Request
      ↓
Eligibility Check
      ↓
Admin Approval if Required
      ↓
Refund Initiated
      ↓
Provider Confirmation
      ↓
Registration Updated
      ↓
Student Notified
```

Store requester, reason, amount, approver, payment ID, timestamp and provider refund ID.

Large/manual refunds should require elevated approval.

---

# 17. Results & Awards Workflow

```text
Organizer Submits Results
        ↓
Automated Validation
        ↓
Admin Review
        ↓
Verify / Request Changes / Reject
        ↓
Verified Result
        ↓
Certificate Generation
```

Validate that the delegate registered, attended, belongs to the stated committee/portfolio, and has a valid non-conflicting award.

Only verified results become verified MUN Passport achievements.

---

# 18. Certificate Workflow

```text
Verified Result
      ↓
Certificate Generation
      ↓
Data Validation
      ↓
Unique Certificate ID
      ↓
QR / Verification URL
      ↓
Issue
      ↓
Email
```

Admin can view, reissue or revoke certificates when permitted. Revocation requires a reason and audit record.

---

# 19. Support Workflow

Ticket lifecycle:

`NEW → ASSIGNED → IN_PROGRESS → WAITING → RESOLVED → CLOSED`

Categories:
- Registration
- Payment
- Refund
- MUN information
- Account
- Certificate
- Organizer
- Technical
- Safety/policy

Priorities:
`LOW / NORMAL / HIGH / URGENT`

---

# 20. Organizer Suspension Workflow

```text
Report / Automated Detection
        ↓
Risk Assessment
        ↓
Evidence Review
        ↓
Warning / Temporary Suspension / Permanent Suspension
        ↓
Organizer Notification
        ↓
Appeal if applicable
        ↓
Final Decision
```

When an organizer is suspended, admins must review all active MUNs belonging to that organizer.

---

# 21. Fraud & Risk Management

Automatically flag:
- Rapid account creation
- Duplicate organizer identities
- Unusual payment failures
- Repeated chargebacks
- Suspicious refunds
- Registration spikes
- Portfolio anomalies
- Repeated certificate changes

Risk levels:
`LOW / MEDIUM / HIGH / CRITICAL`

High-risk cases enter a dedicated admin queue.

---

# 22. Admin Task Queue

Every operational review should become an assignable task.

Example:

```text
Task #1042
Type: MUN Verification
MUN: Oxford MUN 2027
Priority: High
SLA: 06:42 remaining
Assigned: Verification Admin
Status: In Progress
```

Actions:
- Assign
- Reassign
- Escalate
- Complete
- Request information

Suggested routing:
- MUN verification → Verification Team
- Payment issue → Finance Team
- Certificate issue → Operations/Support
- Fraud alert → Senior Operations

---

# 23. SLA Tracking

Recommended initial targets:

| Task | Target |
|---|---:|
| Organizer application | < 24 hours |
| Standard MUN verification | < 24 hours |
| Changes re-review | < 12 hours |
| Urgent conference issue | < 2 hours |
| Payment escalation | < 24 hours |
| Result verification | < 48 hours |

Dashboard should show elapsed time, remaining SLA and overdue status.

---

# 24. Admin Search

Global search:

`Student / Registration ID / MUN / Organizer / Committee / Portfolio / Order ID / Payment ID / Certificate ID / Ticket ID`

A registration search should connect:

```text
Student
  ↓
Registration
  ↓
MUN + Organizer
  ↓
Order + Payment
  ↓
Committee + Portfolio
  ↓
Check-in
  ↓
Result
  ↓
Certificate
  ↓
Support History
```

---

# 25. Admin Confirmation for Dangerous Actions

Before destructive or high-impact actions, show consequences and require explicit confirmation.

Example:

> Are you sure you want to suspend Oxford MUN 2027?
>
> New registrations will stop. The MUN will disappear from discovery. Existing registrations will remain. The organizer will be notified.

Require:
`Confirm Suspension`

High-risk actions require a reason.

---

# 26. Two-Person Approval

Require two admins for:
- Permanent organizer suspension
- Large/manual refunds
- Financial corrections
- Mass certificate revocation
- Permanent data deletion
- Major platform configuration changes

```text
Admin A Requests
      ↓
Admin B Approves
      ↓
Action Executes
```

---

# 27. Audit Logs

Critical events include:

`ORGANIZER_APPROVED`  
`MUN_VERIFIED`  
`MUN_REJECTED`  
`MUN_PUBLISHED`  
`MUN_SUSPENDED`  
`PRICE_CHANGE_APPROVED`  
`REFUND_APPROVED`  
`REFUND_REJECTED`  
`RESULT_VERIFIED`  
`CERTIFICATE_REVOKED`  
`USER_SUSPENDED`  
`ORGANIZER_SUSPENDED`  
`PERMISSION_CHANGED`

Each event stores:
- Actor ID and role
- Action
- Target entity and ID
- Timestamp
- Previous/new value where applicable
- Reason
- Appropriate request/session metadata

Normal admins cannot edit audit logs.

---

# 28. Admin Notifications

Notify admins about:
- New organizer application
- New MUN submission
- SLA warning
- Payment anomaly
- Refund request
- Dispute
- Fraud alert
- Cancellation
- Result submission
- Certificate issue
- Support escalation
- System outage

Critical alerts should be visually separated from routine notifications.

---

# 29. Admin Analytics

### Marketplace
- Active/published MUNs
- Approval/rejection rate
- Verification turnaround
- Registration volume

### Finance
- GMV
- Platform fees
- Refunds
- Chargebacks
- Payment success rate
- Settlement status

### Trust
- Verification failure rate
- Suspended organizers
- Reported MUNs
- Fraud flags
- Dispute rate

### Operations
- Verification backlog
- Tickets per admin
- Resolution time
- SLA compliance
- Re-review rate

---

# 30. Admin MUN Detail Page

Header:
- MUN name
- Organizer
- Status
- Verification status
- Conference date
- Registration status

Tabs:
1. Overview
2. Verification
3. Public Page
4. Registrations
5. Payments
6. Committees
7. Executive Board
8. Documents
9. Results
10. Certificates
11. Communications
12. Reports
13. Audit History

The Public Page tab must show the exact student-facing representation.

---

# 31. Admin Override Rules

Overrides are exceptional.

Every override requires:
- Reason
- Admin identity
- Explicit confirmation
- Audit event

Never silently bypass capacity, payment, portfolio or verification rules.

---

# 32. Data Deletion

Use:

`ACTIVE → DEACTIVATED → RETENTION → DELETION`

Avoid destructive deletion of financial, registration and verification history unless legally and operationally appropriate.

Deletion must be heavily restricted and audited.

---

# 33. Emergency Controls

Super Admin may have:
- Global registration pause
- Payment pause
- MUN suspension
- Organizer suspension
- Email sending pause
- Certificate issuance pause
- Maintenance mode

Every emergency action creates a critical audit event.

---

# 34. Admin Security

Required:
- Strong authentication
- MFA for privileged accounts
- RBAC
- Server-side authorization
- Session management
- Rate limiting
- Audit logs
- Sensitive-action confirmation
- Two-person approval for critical actions
- Secure secret management
- Session timeout
- IDOR protection
- No password access
- Least privilege

---

# 35. Admin Database Entities

Recommended:

```text
admin_users
admin_roles
admin_permissions
admin_role_permissions
admin_tasks
admin_task_assignments
organizer_applications
mun_verification_reviews
verification_issues
risk_flags
fraud_cases
support_tickets
refund_requests
disputes
moderation_cases
admin_actions
audit_logs
admin_notifications
platform_settings
```

---

# 36. Core Admin State Machine

```text
                 SUBMITTED
                     ↓
              AUTO VALIDATION
                     ↓
                ADMIN REVIEW
                     ↓
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
   APPROVED       CHANGES       REJECTED
       ↓          REQUESTED
   VERIFIED           ↓
       ↓          ORGANIZER FIX
   PUBLISHED           ↓
                    RESUBMIT
                       ↓
                  ADMIN REVIEW
```

---

# 37. Golden Rules

1. **Admin reviews; organizer owns the content.**
2. **No public MUN without verification.**
3. **No confirmed registration without verified payment.**
4. **No verified achievement without verified result.**
5. **No critical admin action without an audit log.**
6. **High-risk actions require explicit confirmation.**
7. **Critical actions may require two-person approval.**
8. **Never silently modify historical financial or registration data.**
9. **Use versioning instead of overwriting important public information.**
10. **Every exception requires a reason.**

---

# 38. MVP Priority

## P0
- Admin authentication
- RBAC
- Admin overview
- Organizer applications
- Organizer verification
- MUN verification
- Change requests
- Publish/unpublish
- Organizer management
- Registration search
- Payment monitoring
- Refund workflow
- Audit logs
- Basic support
- Admin notifications

## P1
- Results verification
- Certificate verification
- Risk/fraud flags
- Task assignment
- Moderation
- Advanced analytics
- Two-person approval
- SLA tracking

## P2
- Automated risk scoring
- Advanced fraud engine
- Automated workload assignment
- Advanced dispute management
- AI-assisted verification
- Advanced platform controls

---

# 39. Final Recommended Operating Model

```text
ORGANIZER ACTION
       ↓
AUTOMATED CHECK
       ↓
ADMIN REVIEW
       ↓
ORGANIZER CONFIRMATION
       ↓
MUNHUB VERIFICATION
       ↓
PLATFORM ACTION
       ↓
AUDIT LOG
       ↓
MONITORING
```

The **Organizer Dashboard** answers: “How do I run my MUN?”

The **Admin Dashboard** answers: “Can MUNHub trust this organizer, conference, transaction and result?”

The **Automated System** answers: “Does this action satisfy the platform's rules?”

The **Audit System** answers: “Who did what, when, and why?”

Together these four layers create the operational backbone of MUNHub.
