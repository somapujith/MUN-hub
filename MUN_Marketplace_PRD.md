# MUN Marketplace & Conference Management Platform — Product Requirements Document

**Version:** 1.0  
**Status:** Product Definition  
**Product:** MUN Marketplace & Conference Management Platform  
**Document Type:** Product Requirements Document

---

## 1. Executive Summary

The product is a centralized marketplace and management platform for Model United Nations (MUN) conferences.

The core idea is **“BookMyShow for MUNs”**: students can discover, compare, register for, and pay for MUN conferences from one platform, while organizers receive structured tools to create and manage their conferences.

The platform also creates a long-term student identity layer through a **MUN Passport**, allowing delegates to maintain a verified history of conferences, committees, portfolios, awards, certificates, and organizing experience.

The platform follows a **curated marketplace model**. Organizers cannot instantly publish conferences. Every MUN goes through platform review and verification before becoming publicly available.

---

# 2. Product Vision

Build the central digital infrastructure for the MUN ecosystem where:

- Students discover MUNs from one trusted marketplace.
- Organizers get professional registration and conference-management infrastructure.
- Payments and registrations are standardized.
- Every delegate can build a verified MUN history.
- High-quality MUN conferences become easier to discover and fill.
- The platform can eventually expand beyond MUNs into other student competitions and conferences.

### Long-Term Vision

Become the **discovery, registration, management, and identity layer for student conferences and competitions**.

---

# 3. Problem Statement

The current MUN ecosystem is fragmented.

Students typically discover MUNs through:

- Instagram
- WhatsApp groups
- College/school communities
- Google searches
- Personal networks
- Individual organizer websites/forms

This creates several problems:

### Student Problems

1. Difficult to discover relevant MUNs.
2. No standardized information format.
3. Difficult to compare registration fees, dates, committees, and locations.
4. Registration is often handled through separate Google Forms.
5. Payment processes differ between organizers.
6. Students have no centralized history of their MUN participation.
7. Certificates and awards are scattered across files and emails.
8. No reliable verified MUN portfolio.

### Organizer Problems

1. Need to create registration forms manually.
2. Need separate payment systems.
3. Need to manage delegates using spreadsheets.
4. Difficult to reach new delegates.
5. No standardized event page.
6. Manual certificate distribution.
7. Manual registration tracking.
8. Limited analytics and reporting.

### Platform Opportunity

Create one standardized infrastructure layer connecting students and MUN organizers.

---

# 4. Target Users

## 4.1 Students / Delegates

Students looking to:

- Discover MUNs
- Compare conferences
- Register
- Pay
- Track registrations
- Access MUN passes
- Download certificates
- Build their MUN portfolio

## 4.2 MUN Organizers

Schools, colleges, universities, independent MUN organizations, student clubs, and conference teams.

They need to:

- Submit their MUN
- Configure conference information
- Create committees
- Define portfolios
- Configure registration products
- Manage delegates
- Track payments
- Submit results

## 4.3 Platform Operations Team

Responsible for:

- Reviewing MUN applications
- Verifying conference information
- Approving listings
- Managing organizers
- Handling disputes
- Managing registrations
- Managing platform content

## 4.4 Administrators

Responsible for:

- Platform configuration
- User management
- Finance
- Moderation
- Analytics
- Security
- Platform-wide controls

---

# 5. Product Model

The platform combines four major products:

### 1. Marketplace

Discover and compare MUN conferences.

### 2. Registration Platform

Register and pay for MUNs.

### 3. Organizer Infrastructure

Allow organizers to configure and manage their conferences.

### 4. MUN Passport

Maintain a verified digital history of delegate participation and achievements.

---

# 6. Core User Journey

## Student Journey

```text
Discover MUN
      ↓
Search / Filter
      ↓
MUN Details
      ↓
Select Registration Type
      ↓
Select Committee
      ↓
Select Portfolio Preferences
      ↓
Complete Registration Form
      ↓
Payment
      ↓
Payment Verification
      ↓
Registration Confirmation
      ↓
MUN Pass / QR Code
      ↓
Attend Conference
      ↓
Results Submitted
      ↓
Verified Achievement / Certificate
      ↓
MUN Passport Updated
```

## Organizer Journey

```text
Submit MUN Application
      ↓
Platform Review
      ↓
Approved
      ↓
Organizer Onboarding
      ↓
Configure MUN
      ↓
Configure Committees
      ↓
Configure Portfolios
      ↓
Configure Registration Products
      ↓
Configure Registration Form
      ↓
Submit for Final Verification
      ↓
Platform Verification
      ↓
Changes Requested / Approved
      ↓
Published
      ↓
Registration Open
      ↓
Manage Delegates
      ↓
Conference
      ↓
Submit Results
      ↓
Certificates / Achievements
```

---

# 7. MUN Listing

Every MUN should have a standardized public listing.

## Basic Information

- MUN name
- Edition
- Theme
- Organizer
- Description
- Conference dates
- Registration deadlines
- Location
- Venue
- City
- Country
- Cover image
- Logo
- Gallery

## Committees

Each committee should support:

- Committee name
- Committee type
- Agenda/topic
- Committee description
- Capacity
- Portfolio list
- Executive Board

## Portfolio Information

Each portfolio should support:

- Country / role
- Portfolio name
- Availability
- Restrictions
- Preference order

## Executive Board

Each EB member can have:

- Name
- Position
- Photo
- Bio
- Committee assignment

## Registration

Each registration product can include:

- Registration type
- Price
- Currency
- Capacity
- Registration deadline
- Availability
- Eligibility
- Included benefits

Examples:

- Delegate
- Press
- International Press
- IP / Independent Participant
- Observer
- Campus Ambassador
- Other organizer-defined categories

## Additional Information

- Accommodation
- Rules of procedure
- Brochure
- Schedule
- FAQs
- Contact information
- Social links
- Venue map
- Travel information

---

# 8. Marketplace

The marketplace is the main discovery layer.

## Homepage

The homepage should include:

- Search
- Upcoming MUNs
- Featured MUNs
- Popular MUNs
- MUNs near the user
- Recently added MUNs
- Registration closing soon
- Recommended MUNs
- Browse by city
- Browse by institution
- Browse by date

## Search

Users should be able to search by:

- MUN name
- Organizer
- Institution
- City
- Country

## Filters

Filters should include:

- Date
- Location
- Price
- Committee type
- Registration type
- Institution
- Organizer
- Online / Offline
- Registration status

## Sorting

Possible sorting options:

- Recommended
- Date
- Price
- Popularity
- Newly added
- Registration deadline

---

# 9. Student Accounts

Students can create accounts using:

- Email/password
- OTP
- Google authentication

## Student Dashboard

Dashboard sections:

### Upcoming

- Upcoming registrations
- MUN date
- Committee
- Portfolio
- Venue
- MUN Pass

### Past MUNs

- Conference
- Date
- Committee
- Portfolio
- Award
- Certificate

### Saved MUNs

Students can bookmark conferences.

### Profile

- Name
- Profile photo
- Username
- Institution
- City
- MUN history
- Achievements

---

# 10. MUN Passport

MUN Passport is the platform's long-term student identity feature.

It should provide a verified record of:

- Conferences attended
- Committees
- Countries / portfolios
- Awards
- Certificates
- Organizing experience
- Number of MUNs
- Conference history

## Public Profile

Example:

```text
munatlas.in/@username
```

Possible information:

- Name
- Institution
- MUN count
- Committees attended
- Countries represented
- Awards
- Certificates
- Organizing experience

## Verification

Students should not be able to self-claim verified achievements.

Results should be verified through:

- Organizer submissions
- Platform verification
- Registration records
- Certificate records

---

# 11. MUN Pass

Every confirmed registration generates a digital MUN Pass.

It should contain:

- Student name
- MUN name
- Registration ID
- Committee
- Portfolio
- Date
- Venue
- QR code

The QR code can eventually support:

- Delegate check-in
- Attendance
- Identity verification
- Committee allocation
- Conference access

---

# 12. Organizer Application

Organizers should not instantly publish MUNs.

## Submission

Organizer submits:

- Organization name
- Organizer contact
- Conference name
- Edition
- Expected date
- Location
- Previous editions
- Website/social links
- Short description
- Expected delegate count

## Platform Review

Operations team can:

- Approve
- Reject
- Request changes

---

# 13. Organizer Onboarding

After approval, the organizer receives access to an onboarding workspace.

The organizer configures:

### Conference

- Name
- Edition
- Theme
- Description
- Dates
- Venue
- Location
- Map

### Branding

- Logo
- Cover image
- Gallery
- Social links

### Committees

- Committees
- Agendas
- Descriptions
- Capacities

### Portfolios

- Countries
- Roles
- Availability
- Preference rules

### Executive Board

- Names
- Positions
- Photos
- Bios

### Registration Products

- Product name
- Price
- Capacity
- Deadline
- Eligibility
- Benefits

### Registration Form

Organizers can configure approved dynamic fields such as:

- Name
- Email
- Phone
- Institution
- Year
- MUN experience
- Committee preferences
- Portfolio preferences
- Dietary requirements
- Accommodation requirements
- Emergency contact

Platform controls the allowed field types and schema.

---

# 14. Verification & Publishing

The platform must have a final verification gate.

## MUN Lifecycle

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
CHANGES REQUESTED / RESUBMITTED
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

Only verified MUNs can become publicly available.

---

# 15. Subdomain Architecture

Each MUN can receive a dedicated subdomain.

Examples:

```text
oxford.munatlas.in
vit-mun-2027.munatlas.in
example-mun.munatlas.in
```

The recommended architecture uses a wildcard domain:

```text
*.munatlas.in
```

The application determines the MUN tenant based on the hostname.

Example:

```text
oxford.munatlas.in
        ↓
Hostname detected
        ↓
Slug = oxford
        ↓
Database lookup
        ↓
MUN configuration
        ↓
Render MUN page
```

This avoids manually creating DNS records for every MUN.

---

# 16. Multi-Tenant Architecture

Each MUN is treated as a tenant.

Core tenant identifier:

```text
mun_id
```

Every relevant table references the MUN where applicable.

Example:

```text
MUN
 ├── Committees
 ├── Portfolios
 ├── Registration Products
 ├── Registration Forms
 ├── Registrations
 ├── Payments
 ├── Certificates
 └── Results
```

The same application serves all MUNs.

---

# 17. Payments

Initial payment provider:

**Razorpay**

Payment flow:

```text
Student
   ↓
Registration
   ↓
Create Payment Order
   ↓
Razorpay Checkout
   ↓
Payment
   ↓
Webhook
   ↓
Server-side Verification
   ↓
Payment Confirmed
   ↓
Registration Confirmed
```

The frontend must never be trusted as the final payment authority.

Payments should be confirmed using server-side verification and webhooks.

---

# 18. Registration Management

Each registration should have:

- Registration ID
- User ID
- MUN ID
- Registration product
- Committee
- Portfolio
- Registration form responses
- Payment status
- Registration status
- Created timestamp

Possible registration states:

```text
PENDING
PAYMENT_PENDING
CONFIRMED
CANCELLED
REFUNDED
ATTENDED
NO_SHOW
```

---

# 19. Organizer Dashboard

Dashboard should provide:

### Overview

- Total registrations
- Revenue
- Pending payments
- Available seats
- Registration conversion
- Registration trend

### Delegates

- Search
- Filter
- Export
- View registration
- Committee
- Portfolio
- Payment status

### Committees

- Capacity
- Filled seats
- Remaining seats
- Portfolio allocation

### Payments

- Paid
- Pending
- Failed
- Refunded

### Results

Organizers can submit:

- Award winners
- Special mentions
- Committee
- Portfolio
- Certificate information

---

# 20. Admin Dashboard

Platform administrators need:

## MUN Management

- View all MUNs
- Review submissions
- Approve
- Reject
- Request changes
- Publish
- Unpublish
- Suspend
- Archive
- Feature

## Organizer Management

- Verify organizers
- View organizer history
- Manage access

## Registration Management

- Search registrations
- Payment status
- Refund status
- User details
- MUN details

## Content Moderation

- Images
- Descriptions
- Conference details
- Suspicious listings

## Finance

- GMV
- Platform fees
- Payment fees
- Refunds
- Organizer settlements

---

# 21. Roles & Permissions

## Student

- Browse MUNs
- Register
- Pay
- View own registrations
- View own certificates
- Manage profile

## Organizer

- Manage assigned MUNs
- Configure listings
- Manage registrations
- Submit results

## Operations

- Review submissions
- Verify content
- Manage listings
- Moderate organizers

## Admin

- Platform-wide management
- Finance
- Users
- MUNs
- Analytics

## Super Admin

- Full platform access
- Role management
- System configuration

---

# 22. Recommended Tech Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

## Backend

Start with:

- Next.js Server Actions
- Next.js Route Handlers

A separate Express backend is not required for the MVP.

## Database

- PostgreSQL
- Supabase

## Authentication

- Supabase Auth

## File Storage

- Cloudflare R2

Store:

- Logos
- Posters
- Gallery images
- Certificates
- Brochures

## CDN / DNS / Security

- Cloudflare

Use:

- DNS
- CDN
- SSL
- WAF
- Caching
- Wildcard subdomains

## Hosting

Recommended initial options:

- Cloudflare Workers
- Vercel

## Payments

- Razorpay

## Email

- Resend

## Background Jobs

- Cloudflare Queues / Workers

Use jobs for:

- Bulk certificates
- Email campaigns
- CSV generation
- Image processing

## Analytics

- PostHog

## Monitoring

- Sentry

## Source Control

- GitHub

---

# 23. High-Level Architecture

```text
                    USERS
                      │
                      ▼
             Cloudflare DNS/CDN/WAF
                      │
                      ▼
              Next.js Application
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
      Supabase       R2       Razorpay
     PostgreSQL    Storage      Payments
          │
          ▼
   MUN / Users / Registrations
   Payments / Results / Passport
```

---

# 24. Core Database Entities

Recommended initial entities:

### users

- id
- name
- email
- phone
- role
- username
- institution
- profile_image
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

### registration_products

- id
- mun_id
- name
- price
- capacity
- deadline
- status

### registrations

- id
- user_id
- mun_id
- registration_product_id
- committee_id
- portfolio_id
- status
- created_at

### payments

- id
- registration_id
- provider
- provider_order_id
- provider_payment_id
- amount
- status
- created_at

### certificates

- id
- user_id
- mun_id
- registration_id
- certificate_url
- verification_status

### achievements

- id
- user_id
- mun_id
- registration_id
- committee
- portfolio
- award
- verification_status

### organizer_applications

- id
- organizer_id
- status
- review_notes
- submitted_at

### verification_logs

- id
- mun_id
- reviewer_id
- action
- notes
- created_at

---

# 25. Security Requirements

The platform must implement:

- Secure authentication
- Role-based access control
- Server-side authorization
- Payment verification
- Webhook signature verification
- Input validation
- Rate limiting
- Secure file uploads
- Malware/file-type validation
- Audit logs
- Protection against unauthorized tenant access
- Protection against IDOR / insecure direct object references
- HTTPS
- Secure secrets management

Tenant isolation must be enforced at the application/database level.

---

# 26. Non-Functional Requirements

## Performance

Public MUN pages should be heavily cached where possible.

Target:

- Fast initial page load
- SEO-friendly rendering
- CDN delivery for static assets

## Scalability

The architecture should support:

- Thousands of MUN listings
- Hundreds of thousands of students
- Large registration spikes
- High concurrent traffic during registration openings

## Reliability

Payment and registration systems must be designed to prevent:

- Duplicate registrations
- Duplicate payments
- Lost payment confirmations

Critical workflows should be idempotent.

---

# 27. SEO Requirements

Public MUN pages should be search-engine friendly.

Each MUN should have:

- SEO title
- Meta description
- Open Graph image
- Structured data where applicable
- Canonical URL
- Indexable public page

Example:

```text
https://munatlas.in/mun/oxford-mun-2027
```

or:

```text
https://oxford-mun-2027.munatlas.in
```

Student public profiles can optionally be indexed.

---

# 28. MVP Scope

## Student MVP

- Account creation
- Login
- Marketplace
- Search
- Filters
- MUN details
- Registration
- Payment
- Confirmation
- MUN Pass
- Registration history

## Organizer MVP

- Organizer account
- MUN application
- Application status
- Organizer onboarding
- Conference details
- Committees
- Portfolios
- Registration products
- Dynamic registration fields
- Images
- Registration dashboard
- Final verification

## Admin MVP

- Organizer review
- MUN review
- Approve/reject
- Change requests
- Slug/subdomain allocation
- Publish/unpublish
- Registration management
- Payment visibility
- Basic analytics

---

# 29. Phase 2

Add:

- MUN Passport
- Student public profiles
- Certificates
- Verified achievements
- Reviews and ratings
- Saved MUNs
- Recommendations
- QR check-in
- Advanced organizer analytics
- Automated certificate distribution
- Notifications

---

# 30. Phase 3

Add:

- Delegate reputation
- Verified achievement scoring
- PDF MUN portfolio
- Organizer reputation
- Personalized recommendations
- Sponsorship marketplace
- Accommodation partnerships
- Travel partnerships
- WhatsApp notifications
- Advanced finance and settlement tools

---

# 31. Phase 4

Expand beyond MUNs into:

- Debate competitions
- Youth parliaments
- Case competitions
- Public speaking competitions
- Student conferences
- Academic competitions
- Other inter-college/inter-school events

The architecture should therefore avoid hard-coding MUN-specific assumptions wherever practical.

---

# 32. Monetization

Potential revenue streams:

## Platform Fee

Charge a percentage of each successful registration.

Example:

Average registration fee = **₹2,500**

Registrations per MUN = **1,000**

GMV per MUN:

```text
₹2,500 × 1,000 = ₹25,00,000
```

At 3% platform fee:

```text
₹25,00,000 × 3% = ₹75,000
```

At 5% platform fee:

```text
₹25,00,000 × 5% = ₹1,25,000
```

## Other Revenue

- Featured MUN listings
- Sponsored placements
- Premium organizer tools
- Convenience fees
- Sponsorship marketplace
- Accommodation commissions
- Travel commissions
- Premium student profile features

The final pricing model should clearly define who bears payment-processing fees.

---

# 33. Example Business Scale

Assumption:

- ₹2,500 average registration
- 1,000 registrations per MUN

| MUNs / Month | Registrations | GMV | 3% Platform Revenue | 5% Platform Revenue |
|---:|---:|---:|---:|---:|
| 1 | 1,000 | ₹25 lakh | ₹75,000 | ₹1.25 lakh |
| 5 | 5,000 | ₹1.25 crore | ₹3.75 lakh | ₹6.25 lakh |
| 10 | 10,000 | ₹2.5 crore | ₹7.5 lakh | ₹12.5 lakh |
| 20 | 20,000 | ₹5 crore | ₹15 lakh | ₹25 lakh |
| 50 | 50,000 | ₹12.5 crore | ₹37.5 lakh | ₹62.5 lakh |
| 100 | 1,00,000 | ₹25 crore | ₹75 lakh | ₹1.25 crore |

These figures represent platform fee revenue before payment processing, refunds, taxes, salaries, marketing, support, and other operating costs.

---

# 34. Cost Philosophy

The initial infrastructure should remain lightweight.

At early scale, avoid:

- Kubernetes
- Large dedicated servers
- Complex microservices
- Self-managed databases
- Dedicated infrastructure for every MUN

Use managed services and serverless infrastructure.

The number of registrations alone is not the main infrastructure constraint. Traffic spikes, image storage, email volume, database queries, and operational workflows are more important.

At larger scale, introduce:

- Caching
- Queues
- Redis where needed
- Database optimization
- Read replicas
- Dedicated workers
- Specialized compute

---

# 35. Analytics & KPIs

## North Star Metric

**Completed MUN registrations through the platform.**

Long-term:

**Verified MUN participation records created.**

## Marketplace Metrics

- Visitors
- Search volume
- MUN page views
- Search-to-detail conversion
- Detail-to-registration conversion
- Registration conversion
- Saved MUNs
- Repeat users

## Organizer Metrics

- Applications submitted
- Approval rate
- Time to approval
- MUNs published
- Registrations per MUN
- Organizer retention

## Revenue Metrics

- GMV
- Platform revenue
- Average order value
- Revenue per MUN
- Refund rate
- Payment success rate

---

# 36. Notifications

The platform should support:

### Student

- Registration confirmation
- Payment confirmation
- Registration reminder
- Conference reminder
- Venue update
- Committee/portfolio update
- Certificate availability
- Achievement verification

### Organizer

- Application status
- Review feedback
- MUN approval
- Changes requested
- Registration alerts
- Capacity alerts
- Payment alerts
- Results submission reminders

---

# 37. Admin Verification Workflow

For each submission:

```text
Submitted
   ↓
Reviewer Assigned
   ↓
Content Review
   ↓
Organizer Verification
   ↓
Decision
   ├── Approved
   ├── Rejected
   └── Changes Requested
```

Every decision should create an audit log.

Reviewers should be able to add internal notes that are not visible to organizers.

---

# 38. Registration Integrity

The system should prevent overbooking.

When a registration is initiated:

1. Check capacity.
2. Create a temporary reservation if required.
3. Create payment order.
4. Complete payment.
5. Verify payment.
6. Confirm registration.
7. Release reservation if payment fails or expires.

Use database constraints/transactions to prevent race conditions.

---

# 39. Certificate & Achievement Verification

After a conference, the organizer submits results.

Example:

```text
Student
Committee
Portfolio
Award
Certificate
```

The platform links the result to the student's registration.

Once verified:

```text
MUN Passport
       ↓
Conference
       ↓
Committee
       ↓
Portfolio
       ↓
Award
       ↓
Certificate
```

This makes the profile significantly more trustworthy than a self-reported resume.

---

# 40. Future Recommendation Engine

The platform can eventually recommend MUNs based on:

- Previous committees
- Preferred locations
- Price range
- Experience level
- Previous participation
- Awards
- Saved MUNs
- Search behavior
- Organizer quality
- Conference popularity

Example:

> “Based on your previous MUNs, you may like these 5 conferences.”

---

# 41. Key Product Principles

### 1. Trust Before Growth

Only verified conferences should be publicly listed.

### 2. Standardize the Marketplace

Every MUN should present comparable information.

### 3. Organizers Own Their Conference Content

Organizers control conference-specific information and registration options within platform-defined structures.

### 4. Platform Owns the Publishing Gate

Organizers cannot bypass verification.

### 5. Payment Must Be Reliable

Registration should only be confirmed after server-side payment verification.

### 6. Build the Student Identity Layer

The MUN Passport should create long-term user retention.

### 7. Design for Multi-Tenant Scale

Every MUN should behave like an independent event while using shared infrastructure.

---

# 42. MVP Success Criteria

The MVP should be considered successful when:

- Students can discover MUNs.
- Students can register without leaving the platform.
- Payments are reliably processed.
- Organizers can configure their MUN.
- Platform operations can approve and publish MUNs.
- Each MUN can have its own subdomain.
- Organizers can view registrations.
- Students can access their MUN Pass.
- The system can reliably support registration spikes.
- The platform can process the first meaningful volume of registrations without manual spreadsheet workflows.

---

# 43. Future Product Positioning

The platform can eventually be positioned as:

> **The operating system for student conferences and competitions.**

MUN is the initial vertical.

The long-term platform can provide:

```text
Discovery
   +
Registration
   +
Payments
   +
Event Management
   +
Credentials
   +
Student Identity
   +
Reputation
```

This creates a network effect:

```text
More MUNs
   ↓
More Students
   ↓
More Registrations
   ↓
More Student History
   ↓
More Organizer Value
   ↓
More MUNs
```

---

# 44. Recommended MVP Build Order

## Sprint 1 — Foundation

- Project setup
- Authentication
- Database
- User roles
- Admin foundation
- Design system

## Sprint 2 — Marketplace

- Homepage
- Search
- Filters
- MUN listing
- MUN details

## Sprint 3 — Organizer System

- Organizer application
- Admin review
- Onboarding
- MUN configuration
- Committees
- Portfolios
- Registration products

## Sprint 4 — Registration

- Registration flow
- Dynamic forms
- Capacity handling
- Razorpay integration
- Webhooks
- Confirmation

## Sprint 5 — Dashboards

- Student dashboard
- Organizer dashboard
- Admin dashboard
- Registration management

## Sprint 6 — MUN Pass & Launch

- QR MUN Pass
- Email notifications
- Subdomain routing
- SEO
- Analytics
- Monitoring
- Security hardening
- Production launch

---

# 45. Final Product Summary

The product is a **curated MUN marketplace + registration platform + organizer management system + verified delegate identity layer**.

The initial product should focus on solving the most important problems:

```text
Discover MUNs
      ↓
Compare MUNs
      ↓
Register
      ↓
Pay
      ↓
Get MUN Pass
      ↓
Attend
      ↓
Receive Verified Results
      ↓
Build MUN Passport
```

For organizers:

```text
Apply
  ↓
Get Verified
  ↓
Build MUN Listing
  ↓
Open Registration
  ↓
Manage Delegates
  ↓
Run Conference
  ↓
Submit Results
```

The architecture should remain simple at the beginning while being capable of scaling to thousands of conferences and a large student network.
