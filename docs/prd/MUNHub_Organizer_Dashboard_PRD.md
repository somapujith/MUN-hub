# MUNHub — Organizer Dashboard PRD

**Version:** 1.0  
**Status:** Product Definition  
**Module:** Organizer Dashboard  
**Product:** MUNHub

## 1. Executive Summary

The MUNHub Organizer Dashboard is the operating center for MUN organizers. It enables organizers to create, configure, submit, manage, and operate their conferences from one platform.

Core lifecycle:

```text
Create → Configure → Verify → Publish → Register Delegates
→ Manage Payments → Communicate → Check In → Results
→ Certificates → Complete
```

The goal is to replace fragmented workflows across Google Forms, spreadsheets, payment links, email lists, attendance sheets, and manual certificate generation.

## 2. Product Vision

> **MUNHub should become the operating system for running an MUN conference.**

The dashboard should let organizers manage most conference operations from one place while MUNHub retains control over verification and publishing.

## 3. Goals

- Create and configure MUN conferences.
- Manage committees, portfolios, and Executive Board members.
- Configure registration products and pricing.
- Build dynamic registration forms.
- Manage delegates and registrations.
- Track payments, refunds, and settlements.
- Communicate with delegates.
- Support QR-based check-in.
- Manage results and awards.
- Generate and distribute certificates.
- Provide useful analytics.
- Support organizer teams and permissions.
- Preview public MUN pages.
- Maintain MUNHub review and publishing controls.

## 4. Non-Goals for MVP

- Full live committee/debate software
- Virtual MUN infrastructure
- AI committee moderation
- Full accounting/payroll software
- Native mobile apps
- Full hotel/travel booking
- Advanced sponsorship management
- Advanced expense management

## 5. Dashboard Navigation

```text
Organizer Dashboard
├── Overview
├── My MUNs
├── MUN Setup
│   ├── General
│   ├── Branding
│   ├── Dates & Venue
│   ├── Schedule
│   ├── Rules
│   ├── FAQs
│   └── Contact
├── Committees
├── Portfolios
├── Executive Board
├── Registration Products
├── Registration Form
├── Registrations
├── Payments & Finance
├── Communications
├── Documents & Media
├── Conference Day
├── Results & Awards
├── Certificates
├── Analytics
├── Team & Permissions
└── Settings
```

## 6. Overview Dashboard

Display:

- Total registrations
- Confirmed registrations
- Pending registrations
- Total GMV
- Platform fees
- Refunds
- Available seats
- Registration conversion
- Registrations today/week/month
- Registration trend
- Deadline countdown
- Capacity utilization

Example:

```text
Registrations    GMV          Seats Left
437              ₹6,55,500    163

Confirmed        Pending      Conversion
421              16           8.7%
```

### Action Center

Highlight items requiring attention:

- Committee nearly full
- Registration deadline approaching
- Failed/pending payments
- MUNHub change requests
- New registrations
- Certificate completion
- Results awaiting verification

## 7. My MUNs

Organizers can manage multiple conferences.

Each MUN card displays:

- MUN name
- Edition
- Date
- Location
- Status
- Registrations
- GMV
- Registration deadline

Actions:

- Manage
- Edit
- Preview
- View live page
- Duplicate
- Archive

### Duplicate MUN

Allow organizers to duplicate a previous conference and retain:

- Committees
- Agendas
- Portfolios
- EB structure
- Registration products
- Registration form
- FAQs
- Rules
- Schedule structure
- Branding

The organizer then updates dates, pricing, capacity, and other event-specific data.

## 8. MUN Lifecycle

```text
DRAFT
↓
SUBMITTED
↓
UNDER REVIEW
↓
APPROVED / REJECTED / CHANGES REQUESTED
↓
ONBOARDING
↓
CONTENT SUBMITTED
↓
VERIFICATION
↓
PUBLISHED
↓
REGISTRATION OPEN
↓
REGISTRATION CLOSED
↓
CONFERENCE ACTIVE
↓
COMPLETED
↓
ARCHIVED
```

Organizers cannot bypass MUNHub verification.

## 9. MUN Setup

### General

- MUN name
- Edition
- Theme
- Short description
- Full description
- Organizer name
- Organizer description
- Conference type
- Expected delegate count

### Dates

- Registration opening
- Early-bird deadline
- Registration deadline
- Late registration deadline
- Conference start/end

### Venue

- Venue name
- Address
- City
- State
- Country
- Map location
- Parking
- Travel information

### Branding

- Logo
- Cover image
- Gallery
- Sponsor logos
- Organizer logo

Enforce file type, size, image dimensions, and secure uploads.

## 10. Schedule Builder

Create conference schedules with:

- Date
- Start/end time
- Title
- Description
- Location
- Committee association

Example:

```text
Day 1
08:00 — Delegate Registration
09:00 — Opening Ceremony
10:00 — Committee Session 1
13:00 — Lunch
14:00 — Committee Session 2
18:00 — Day 1 Ends
```

## 11. Rules, FAQs & Contact

Organizers can publish:

- Rules of Procedure
- Code of Conduct
- Delegate guidelines
- Dress code
- Payment/cancellation rules
- FAQs
- Contact information
- Social links

## 12. Committees

Organizers can:

- Create/edit/delete committees
- Set capacity
- Add agenda
- Add description
- Assign EB
- Manage portfolios
- Close committee registration
- Enable waitlists

Example:

```text
UNSC  30/30  FULL
UNGA  80/100
WHO   45/60
```

Capacity must be enforced transactionally to prevent overbooking.

## 13. Portfolios

For each committee, configure:

- Country/role
- Position
- Availability
- Restrictions
- Description

Portfolio availability should update as allocations are made.

## 14. Executive Board

Add:

- Name
- Position
- Photo
- Bio
- Committee
- Social links

Supported positions may include Chairperson, Co-Chair, Director, and Moderator.

## 15. Registration Products

Organizers can create:

- Delegate
- Press
- International Press
- Observer
- Independent Participant
- Other approved types

Each product supports:

- Name
- Description
- Price
- Currency
- Capacity
- Registration start/end
- Deadline
- Eligibility
- Benefits
- Status

## 16. Registration Form Builder

A core feature that replaces external forms.

Supported fields:

- Text
- Long text
- Number
- Email
- Phone
- Dropdown
- Multiple choice
- Checkboxes
- Date
- File upload
- Institution
- Year of study
- MUN experience
- Committee preference
- Portfolio preference
- Emergency contact

Example:

```text
Registration Form

✓ Full Name
✓ Email
✓ Phone
✓ Institution
✓ Year
✓ MUN Experience

Committee Preferences
[1st Choice]
[2nd Choice]
[3rd Choice]

Portfolio Preferences
[1st Choice]
[2nd Choice]

+ Add Field
```

### Conditional Logic

Example:

```text
Accommodation required?
        ↓ YES
Number of nights
Arrival date
Departure date
Room preference
```

## 17. Registration Management

Registration table:

```text
ID       Name          Committee     Portfolio    Payment
MUN1021  Rahul Sharma  UNSC          USA          PAID
MUN1022  Arjun Rao     UNGA          India        PAID
MUN1023  Priya Singh   WHO           Japan        PENDING
```

Filters:

- Committee
- Portfolio
- Registration type
- Payment status
- Date
- Institution
- City
- Attendance

Actions:

- View
- Edit allocation
- Assign committee
- Assign portfolio
- Cancel
- Refund
- Export
- Contact delegate

Statuses:

```text
PENDING
PAYMENT_PENDING
CONFIRMED
CANCELLED
REFUNDED
ATTENDED
NO_SHOW
```

## 18. Payments & Finance

Display:

- Total GMV
- Platform fee
- Payment processing fee
- Refunds
- Organizer settlement

Example:

```text
Total GMV       ₹7,50,000
Platform Fee      ₹37,500
Payment Fee            ₹X
Refunds             ₹7,500
Settlement        ₹7,05,000
```

Sections:

- Transactions
- Successful payments
- Failed payments
- Refunds
- Settlements
- Invoices
- Platform fees
- Payment gateway fees

Exports:

- CSV
- XLSX
- PDF

Payment reconciliation should connect registration ID, payment ID, amount, status, refund, and settlement.

## 19. Communications

Organizers can send targeted email announcements.

Examples:

- Venue update
- Schedule update
- Committee allocation
- Conference reminder
- Payment reminder
- Certificate notification

Target groups:

```text
All delegates
UNSC delegates
Paid registrations
Pending registrations
Accommodation users
Specific institution
Specific registration type
```

Future channels:

- WhatsApp
- SMS
- Push notifications

## 20. Documents & Media

Centralized storage for:

```text
Brochure.pdf
Rules.pdf
Schedule.pdf
Delegate Handbook.pdf
```

Media:

- Logo
- Cover
- Gallery
- Sponsor logos

Organizers control public visibility.

## 21. Public Page Preview

Organizers can preview the public MUN listing before submitting it for verification.

Actions:

```text
[Preview MUN Page]
[View Live Page]
```

Each approved MUN can receive a dedicated subdomain under MUNHub's domain, for example:

```text
oxford-mun-2027.munhub.in
```

## 22. Conference Day

### QR Check-in

```text
MUN Pass
↓
QR Code
↓
Scan
↓
Registration Verified
↓
Delegate Checked In
```

### Attendance Dashboard

```text
Total Delegates   500
Checked In         437
Not Checked In      63

Attendance: 87.4%
```

Search delegates by:

- Name
- Registration ID
- Committee
- Portfolio
- Institution

Prevent duplicate check-ins.

## 23. Results & Awards

Organizers can enter:

- Best Delegate
- High Commendation
- Special Mention
- Verbal Mention
- Other approved awards

Each result is linked to:

- Student
- Registration
- MUN
- Committee
- Portfolio
- Award
- Verification status

### Verification

```text
Organizer submits results
↓
MUNHub verification
↓
Approved
↓
MUN Passport updated
↓
Certificate generated
```

## 24. Certificate Management

Generate certificates for:

- Participation
- Best Delegate
- High Commendation
- Special Mention
- Verbal Mention
- Other approved awards

### Template System

Support field mapping:

```text
{{student_name}}
{{committee}}
{{portfolio}}
{{award}}
{{mun_name}}
{{date}}
```

### Bulk Generation

```text
500 delegates
↓
500 certificates
↓
Generate
↓
Store in object storage
↓
Email through Amazon SES
```

Every certificate should receive a unique verification ID.

## 25. Certificate Verification

Certificate should contain:

- Certificate ID
- Student name
- MUN name
- Committee
- Portfolio
- Award
- Issue date
- Verification URL
- QR code

Example:

```text
munhub.in/verify/certificate/MUN2027-ABC123
```

## 26. Analytics

### Registration

- Total registrations
- Daily registrations
- Registration trend
- Conversion rate
- Registration source
- Average registration value

### Committee

- Registrations per committee
- Capacity utilization
- Popular committees
- Portfolio demand

### Financial

- GMV
- Platform fees
- Refunds
- Payment success rate
- Average order value

### Audience

- Institution distribution
- City/state distribution
- New vs returning delegates

## 27. Registration Funnel

```text
MUN Page Views
↓
Registration Started
↓
Payment Initiated
↓
Payment Completed
↓
Confirmed Registration
```

This allows organizers to identify conversion drop-offs.

## 28. Team Management

Organizations can invite team members.

Roles:

### Owner
Full access.

### Director
Conference management with configurable financial restrictions.

### Finance Manager
Payments, refunds, settlements, financial reports.

### Registration Manager
Registrations, delegates, allocations.

### Content Manager
MUN page, committees, schedule, documents.

### Volunteer
Conference-day check-in and delegate lookup.

All permissions must be enforced server-side.

## 29. Search

Global organizer search across:

- Delegates
- Registration IDs
- Committees
- Portfolios
- Payment IDs
- Certificates
- Results

Example:

```text
Search: Rahul Sharma
→ Registration
→ Certificate
→ Committee
→ Portfolio
→ Payment
→ Attendance
```

## 30. Exports

Support:

- CSV
- XLSX
- PDF

Export:

- Registrations
- Delegates
- Committee lists
- Portfolio lists
- Payments
- Attendance
- Results
- Certificates

Large exports should run asynchronously.

## 31. Notifications

Organizer notification center categories:

- Registration
- Payment
- Conference
- Verification
- Certificates
- System

Examples:

```text
3 new registrations
2 successful payments
UNSC is almost full
Registration deadline approaching
MUNHub requested listing changes
Certificate generation completed
Results approved
```

## 32. Security Requirements

Implement:

- Secure authentication
- Role-based access control
- Server-side authorization
- Tenant isolation
- Input validation
- Rate limiting
- Secure file uploads
- Audit logging
- Payment webhook verification
- Secret management
- HTTPS
- IDOR protection

Organizers must only access MUNs they are authorized to manage.

## 33. Audit Logs

Log important actions:

```text
Rahul added committee UNSC
Ananya changed UNSC capacity 30 → 40
Admin approved MUN
Finance Manager issued refund
Director published results
```

Store:

- User
- Action
- Target
- Previous/new value where appropriate
- Timestamp
- Relevant metadata

## 34. Multi-Tenant Architecture

All MUNs share the same application and database infrastructure while remaining logically isolated.

```text
MUNHub
├── MUN #1
│   ├── Committees
│   ├── Registrations
│   └── Payments
├── MUN #2
│   ├── Committees
│   ├── Registrations
│   └── Payments
└── MUN #3
    ├── Committees
    ├── Registrations
    └── Payments
```

Use `mun_id` as the tenant identifier for relevant records.

## 35. Recommended Tech Stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js Server Actions and Route Handlers
- **Database:** PostgreSQL via Neon
- **Authentication:** Secure Next.js-compatible auth provider
- **Storage:** Cloudflare R2
- **DNS/CDN/WAF:** Cloudflare
- **Payments:** Razorpay
- **Email:** Amazon SES
- **Background jobs:** Cloudflare Queues/Workers or equivalent
- **Analytics:** PostHog
- **Monitoring:** Sentry
- **Source control:** GitHub

A separate Express backend is not required for the MVP.

## 36. High-Level Architecture

```text
Organizer
    ↓
Cloudflare DNS / CDN / WAF
    ↓
Next.js
    ↓
┌───────────────┬───────────────┬───────────────┐
↓               ↓               ↓
Neon PostgreSQL Cloudflare R2   Razorpay
↓               ↓               ↓
Data            Files/PDFs      Payments
                                ↓
                             Webhooks
↓
Amazon SES
↓
Email
```

## 37. Core Database Entities

### organizers
- id
- organization_name
- contact_email
- contact_phone
- verification_status
- created_at

### organizer_members
- id
- organizer_id
- user_id
- role
- permissions
- created_at

### muns
- id
- organizer_id
- name
- slug
- edition
- theme
- description
- start_date
- end_date
- venue
- city
- country
- status
- published_at

### committees
- id
- mun_id
- name
- agenda
- description
- capacity

### portfolios
- id
- committee_id
- name
- type
- availability

### executive_board
- id
- mun_id
- committee_id
- name
- position
- bio
- photo_url

### registration_products
- id
- mun_id
- name
- price
- capacity
- deadline
- status

### registration_form_fields
- id
- mun_id
- field_type
- label
- required
- options
- validation_rules
- display_order

### registrations
- id
- user_id
- mun_id
- registration_product_id
- committee_id
- portfolio_id
- status
- created_at

### registration_responses
- id
- registration_id
- field_id
- response

### payments
- id
- registration_id
- provider
- provider_order_id
- provider_payment_id
- amount
- status
- created_at

### attendance
- id
- registration_id
- checked_in
- checked_in_at

### results
- id
- registration_id
- committee_id
- portfolio_id
- award
- verification_status

### certificates
- id
- registration_id
- certificate_type
- certificate_url
- verification_id
- verification_status
- issued_at

### audit_logs
- id
- user_id
- mun_id
- action
- entity_type
- entity_id
- metadata
- created_at

## 38. Registration Integrity

The platform must prevent duplicate registrations and overbooking.

```text
Check Capacity
↓
Create Registration Intent
↓
Reserve Seat
↓
Create Payment Order
↓
Razorpay Checkout
↓
Payment Webhook
↓
Verify Payment
↓
Confirm Registration
```

Use database transactions, unique constraints, idempotency, and controlled seat reservation.

## 39. MVP Priorities

### P0 — Must Have

1. Organizer authentication
2. Organizer application
3. MUN creation
4. MUN setup
5. Committees
6. Portfolios
7. Executive Board
8. Registration products
9. Registration form builder
10. Registration management
11. Payment visibility
12. Public-page preview
13. MUNHub verification workflow
14. Basic analytics
15. Team roles
16. Basic documents/media

### P1 — Important

17. QR check-in
18. Communications
19. Results management
20. Certificate generation
21. Financial reports
22. Advanced analytics
23. Duplicate MUN
24. Action center
25. Bulk exports

### P2 — Future

26. WhatsApp messaging
27. Accommodation management
28. Sponsorship management
29. Expense management
30. Automated committee allocation
31. Advanced CRM
32. Delegate engagement analytics
33. Organizer reputation
34. Advanced event operations

## 40. User Stories

### Organizer

- As an organizer, I want to create my MUN so that I can configure it on MUNHub.
- As an organizer, I want to create committees so delegates can select their preferences.
- As an organizer, I want to define portfolios so delegates can submit country preferences.
- As an organizer, I want to create registration products so I can charge different participant types.
- As an organizer, I want to build my registration form so I don't need Google Forms.
- As an organizer, I want to see all registrations so I can manage delegates.
- As an organizer, I want payment visibility so I know who has paid.
- As an organizer, I want to send announcements so delegates receive updates.
- As an organizer, I want QR check-in so I can manage attendance.
- As an organizer, I want to submit results so students receive verified achievements.
- As an organizer, I want bulk certificates so I don't create them manually.
- As an organizer, I want analytics so I can understand conference performance.
- As an organizer, I want team permissions so different members can work safely.

## 41. Success Metrics

### Organizer Adoption

- Organizer applications
- Approval rate
- Time to onboard
- Active organizers
- Organizer retention

### MUN Performance

- MUNs created
- MUNs published
- Registrations per MUN
- Average registrations per organizer
- Registration conversion
- Committee utilization

### Operational Efficiency

- Reduction in external form usage
- Reduction in spreadsheet usage
- Time to configure MUN
- Time to process registrations
- Time to issue certificates

### Revenue

- GMV
- Platform fee revenue
- Average GMV per MUN
- Average revenue per MUN
- Payment success rate
- Refund rate

## 42. Business Model Example

Assumptions:

- Average ticket: ₹1,500
- Platform fee: 5%
- GST on platform fee: 18%
- 500–600 registrations per MUN
- 2 MUNs per month

Per ticket:

```text
Ticket                  ₹1,500
Platform fee (5%)          ₹75
GST (18% of fee)        ₹13.50
Total platform charge   ₹88.50
```

At 500 registrations per MUN and 2 MUNs/month:

```text
1,000 registrations
GMV = ₹15,00,000
Platform fee = ₹75,000
GST = ₹13,500
Platform charges collected = ₹88,500
```

At 600 registrations per MUN and 2 MUNs/month:

```text
1,200 registrations
GMV = ₹18,00,000
Platform fee = ₹90,000
GST = ₹16,200
Platform charges collected = ₹1,06,200
```

GST is collected from customers and should be accounted for as tax liability rather than economic profit.

## 43. Launch Strategy

### Stage 1 — Internal MVP

Build:

- Organizer onboarding
- MUN setup
- Committees
- Portfolios
- Registration products
- Registration forms
- Registration dashboard
- Payments
- Admin verification

### Stage 2 — Pilot

Onboard a small number of trusted MUN organizers.

Measure:

- Registration reliability
- Organizer usability
- Payment reconciliation
- Support workload
- Organizer feedback

### Stage 3 — Public Launch

Add:

- Marketplace discovery
- Public MUN pages
- Subdomains
- MUN Pass
- Analytics
- Communications

### Stage 4 — Operating System

Add:

- Results
- Certificates
- MUN Passport
- Advanced organizer analytics
- Team management
- Conference-day operations

## 44. Final Product Principle

The marketplace gets organizers and students onto MUNHub.

The Organizer Dashboard keeps organizers on MUNHub.

MUNHub should progressively replace:

```text
Google Forms
Google Sheets
Payment Links
Email Lists
Manual Attendance
Manual Certificates
Separate Event Pages
```

with:

```text
MUNHub
```

The ultimate organizer experience is:

```text
Create
  ↓
Configure
  ↓
Get Verified
  ↓
Publish
  ↓
Collect Registrations
  ↓
Manage Payments
  ↓
Manage Delegates
  ↓
Communicate
  ↓
Run Conference
  ↓
Check In
  ↓
Publish Results
  ↓
Generate Certificates
  ↓
Complete Conference
```
