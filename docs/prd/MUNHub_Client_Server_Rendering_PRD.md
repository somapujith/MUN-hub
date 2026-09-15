# MUNHub — Client-Side & Server-Side Rendering Strategy PRD

**Version:** 1.0  
**Product:** MUNHub  
**Objective:** Define exactly which parts of MUNHub should use Server Components/SSR, Client Components/CSR, static generation, caching, streaming and hybrid rendering to achieve strong SEO and an extremely fast user experience.

---

# 1. Executive Summary

MUNHub should NOT use only SSR or only CSR.

The recommended architecture is **hybrid rendering**:

```text
PUBLIC / SEO-CRITICAL
        ↓
Server Rendering / Static / Cached
        ↓
Fast HTML + SEO

INTERACTIVE APPLICATION
        ↓
Server-rendered shell
        +
Client Components
        ↓
Instant interactions
```

The principle is:

> **Render stable/read-heavy content on the server and keep highly interactive behavior on the client.**

This gives MUNHub:
- excellent SEO
- fast first load
- low client JavaScript
- instant interactions
- scalable dashboards
- good mobile performance
- lower database pressure

---

# 2. Rendering Types

## 2.1 Server-Side Rendering (SSR)

Server generates HTML for a request.

Use when data changes frequently but must be available on first render.

Examples:
- personalized dashboard shell
- frequently changing MUN information
- authenticated pages where fresh data is required

---

## 2.2 Static Generation / Pre-Rendering

HTML is generated ahead of time and served from cache/CDN.

Use for stable public content.

Examples:
- About
- Help
- Terms
- Privacy
- public informational pages

---

## 2.3 Incremental / Revalidated Rendering

Page is generated and cached, then regenerated when data changes or after a defined period.

Use for public MUN pages.

Example:

```text
MUN page
   ↓
Cached
   ↓
Organizer changes content
   ↓
Invalidate/revalidate
   ↓
New version generated
```

---

## 2.4 Client-Side Rendering (CSR)

Browser renders interactive UI after JavaScript loads.

Use only where interaction is the primary requirement.

Examples:
- filters
- tables
- modals
- drag/drop
- form builders
- live dashboard controls

---

## 2.5 Hybrid Rendering

Most MUNHub pages should use:

```text
Server-rendered page
        +
Client-side interactive components
```

This should be the default architecture.

---

# 3. Rendering Decision Framework

Before creating a component, ask:

### Question 1
Does this content need SEO?

**Yes → Server**

### Question 2
Does the content need to be available immediately on first load?

**Yes → Server**

### Question 3
Does the component require browser APIs?

Examples:
- localStorage
- camera
- QR scanner
- geolocation
- drag/drop

**Yes → Client**

### Question 4
Does it change frequently through user interaction?

**Yes → Client interaction layer**

### Question 5
Is it sensitive/private?

**Fetch authoritative data on server.**

### Question 6
Is it static or rarely changed?

**Static/cache/revalidation.**

---

# 4. MUNHub Rendering Architecture

Recommended:

```text
                         MUNHub
                           │
              ┌────────────┴────────────┐
              │                         │
          Public Web                Application
              │                         │
              ▼                         ▼
      Server / Cached              Server Shell
              │                         │
              ▼                         ▼
        SEO HTML                  Client Components
              │                         │
              └───────────┬─────────────┘
                          ▼
                     API / Actions
                          │
                          ▼
                     PostgreSQL
```

---

# 5. Public Marketplace

## Rendering: Server + Cached

Public marketplace is the most important SEO surface.

Pages:

- `/`
- `/muns`
- `/muns/[slug]`
- `/organizers/[slug]`
- `/cities/[city]`
- `/committees/[committee]`
- `/about`
- `/help`

These should primarily be server-rendered.

---

# 6. Homepage

## Rendering

**Server-rendered + CDN cached**

Server renders:
- hero
- featured MUNs
- upcoming MUNs
- locations
- categories
- SEO content

Client renders:
- search interaction
- filters
- carousel controls
- favorite/save button
- login state
- small interactive widgets

Architecture:

```text
Homepage
 ├── Server
 │    ├── Hero
 │    ├── Featured MUNs
 │    ├── Upcoming MUNs
 │    └── SEO content
 │
 └── Client
      ├── Search
      ├── Filters
      └── Save button
```

---

# 7. MUN Listing Page

Example:

`/muns`

## Server

Render:
- initial MUN list
- SEO metadata
- location/category information
- initial filters

## Client

Handle:
- filter interactions
- sorting
- view toggle
- saved MUNs
- pagination controls

For large datasets, filtering should move to the server/API rather than loading thousands of MUNs into the browser.

---

# 8. Individual MUN Page

Example:

`/muns/oxford-mun-2027`

This is one of the most important pages.

## Rendering

**Server-rendered + cached/revalidated**

Server renders:
- MUN name
- dates
- venue
- description
- committees
- pricing
- organizer
- EB
- schedule
- rules
- FAQs
- images
- SEO metadata

Client renders:
- image gallery interaction
- tabs
- save MUN
- registration CTA state
- interactive map
- FAQ expansion if desired

Goal:

> A student should be able to open a MUN page and see useful information before client JavaScript finishes loading.

---

# 9. MUN Page Cache Strategy

Public information can be cached.

Example:

```text
User
 ↓
Cloudflare CDN
 ↓
Cached MUN page
```

Organizer updates content:

```text
Organizer
 ↓
Database
 ↓
Invalidate/revalidate MUN
 ↓
CDN receives new version
```

Critical registration/payment data must NOT rely on stale cache.

---

# 10. Registration Flow

The registration flow should use **hybrid rendering**.

Pages:

```text
MUN
 ↓
Registration Product
 ↓
Registration Form
 ↓
Payment
 ↓
Confirmation
```

## Server

Handle:
- authenticated user validation
- MUN validity
- registration eligibility
- capacity
- pricing
- portfolio availability
- order creation
- payment verification

## Client

Handle:
- form interaction
- validation feedback
- conditional fields
- progress indicator
- UI transitions
- optimistic non-critical changes

---

# 11. Registration Form

The form should be primarily a Client Component for interaction.

```text
Registration Page
      │
      ├── Server
      │    ├── MUN data
      │    ├── Product
      │    └── Rules
      │
      └── Client
           ├── Form state
           ├── Conditional fields
           ├── Validation
           └── Progress
```

Do not send every keystroke to the server.

---

# 12. Payment Page

Payment must remain server-authoritative.

Client:
- opens payment UI
- displays processing state
- handles provider interaction

Server:
- creates order
- validates amount
- verifies payment signature
- verifies webhook
- confirms registration

Flow:

```text
Client
 ↓
Server creates order
 ↓
Payment provider
 ↓
Webhook
 ↓
Server verification
 ↓
Registration CONFIRMED
```

Never confirm registration purely on the client.

---

# 13. Student Dashboard

Example:

`/dashboard`

## Rendering

**Server-rendered shell + Client interactive modules**

Server:
- user identity
- upcoming registrations
- core registration state
- MUN Passport summary

Client:
- tabs
- filters
- modals
- save actions
- notifications
- certificate interactions

Architecture:

```text
Dashboard
 ├── Server
 │    ├── User
 │    ├── Upcoming MUNs
 │    └── Passport summary
 │
 └── Client
      ├── Tabs
      ├── Filters
      ├── Modals
      └── Actions
```

---

# 14. MUN Passport

Public profile:

`/@username`

## Rendering

**Server-rendered + cached**

Because it should be:
- shareable
- indexable
- fast
- publicly accessible

Server renders:
- verified MUN history
- verified awards
- certificates
- organizing experience
- profile information

Client:
- filters
- expand/collapse
- share interaction
- download controls

Important:

Only verified achievements should be publicly represented as verified.

---

# 15. Organizer Dashboard

Organizer dashboard is authenticated and highly interactive.

## Recommended

**Server-rendered shell + Client Components**

Server:
- authorization
- organizer/MUN identity
- initial KPIs
- initial page data

Client:
- tabs
- tables
- filters
- forms
- modals
- drag/drop
- status changes
- autosave
- search

Do NOT turn the entire dashboard into one giant Client Component.

---

# 16. Organizer Overview

Server renders initial:
- registration count
- revenue
- capacity
- MUN status
- action items

Client handles:
- date filters
- chart interaction
- refresh
- dismissing notifications
- quick actions

Heavy analytics should load separately.

---

# 17. Registration Management

This is highly interactive.

## Initial page

Server:
- initial 25–50 registrations
- counts
- authorization

## Client:
- search UI
- filters
- sorting
- selection
- modals
- bulk selection

## Server/API:
- database filtering
- pagination
- mutations

Use virtualization for large tables.

---

# 18. Committee Management

Hybrid.

Server:
- initial committee data
- permissions

Client:
- add/edit/delete UI
- drag/drop ordering
- modal
- local validation

Server:
- final validation
- database mutation
- audit log

---

# 19. Portfolio Assignment

Highly interactive.

Client:
- drag/drop
- selection
- search
- local UI state

Server:
- authoritative assignment
- conflict detection
- transaction
- audit

Example:

```text
Client: "Assign India"
       ↓
Server checks:
- portfolio available?
- delegate valid?
- committee correct?
       ↓
Commit transaction
```

---

# 20. Registration Form Builder

**Client-heavy module.**

Client handles:
- field creation
- drag/drop
- reordering
- conditional logic
- preview
- local draft state

Server handles:
- persistence
- validation
- versioning
- publication
- authorization

Autosave should be debounced.

---

# 21. Admin Dashboard

Hybrid.

Server:
- authorization
- critical KPIs
- task queue
- critical alerts

Client:
- filters
- task interactions
- verification panels
- modals
- bulk operations
- review interface

Sensitive operations always go through server-side authorization.

---

# 22. Admin Verification Console

Use:

```text
Server-rendered initial submission
        +
Client-side verification UI
        +
Server-side approval action
```

Client can immediately show:

`Approving...`

but only the server can produce:

`VERIFIED`

---

# 23. Conference-Day Check-In

This requires Client Components.

Why:
- camera access
- QR scanning
- rapid interactions
- mobile device
- offline/poor-network handling

Architecture:

```text
Server
 ↓
Conference + authorization
 ↓
Client QR scanner
 ↓
Registration lookup
 ↓
Server validation
 ↓
Checked In
```

The client should not independently decide whether a delegate is valid.

---

# 24. Results & Awards

Hybrid.

Client:
- select delegate
- select committee
- select award
- edit result

Server:
- validate registration
- validate attendance
- validate committee/portfolio
- save result
- create audit event

Admin verification remains server-authoritative.

---

# 25. Certificates

Certificate generation should never block page rendering.

```text
Admin/Organizer
 ↓
Create certificate job
 ↓
Immediate UI response
 ↓
Queue
 ↓
Worker
 ↓
Generate PDF
 ↓
Store in R2
 ↓
Email via SES
```

The dashboard can display:

`Generating 342 / 500`

---

# 26. Communications

Client:
- campaign composer
- audience selector
- preview

Server:
- authorization
- recipient resolution
- campaign creation

Background:
- email sending
- retries
- delivery tracking

Never send thousands of emails inside the page request.

---

# 27. Documents & Media

Client:
- upload UI
- progress
- preview
- reorder gallery

Server:
- authorization
- metadata
- signed upload URLs
- database records

Storage:
- Cloudflare R2

Large files should upload directly to storage rather than passing through the Next.js server whenever practical.

---

# 28. Analytics

Analytics should be separated from critical rendering.

Initial page:

```text
Dashboard shell
 ↓
Core KPIs
```

Then:

```text
Analytics charts
 ↓
Async fetch
 ↓
Render
```

Do not block dashboard rendering on expensive analytics queries.

---

# 29. Authentication Pages

Pages:
- Login
- Signup
- OTP
- Password reset

Server:
- authentication
- session creation
- security checks

Client:
- form state
- validation
- UX
- OTP countdown

---

# 30. Error Pages

Use server-rendered error boundaries/pages where possible.

Client-side errors should be recoverable.

Example:

```text
Unable to load registrations.
[Retry]
```

Do not destroy the entire dashboard because one widget failed.

---

# 31. Loading Architecture

Use Next.js loading boundaries.

Instead of:

```text
Whole page
 ↓
Wait for everything
 ↓
Show page
```

Use:

```text
Page shell
 ↓
Critical content
 ↓
Secondary sections
 ↓
Analytics
```

This is particularly important for dashboards.

---

# 32. Suspense Strategy

Use Suspense around independent sections.

Example:

```text
Dashboard
 ├── User Header
 ├── KPI Cards
 ├── <Suspense>Registrations</Suspense>
 ├── <Suspense>Analytics</Suspense>
 └── <Suspense>Activity</Suspense>
```

A slow analytics query should not block the registration list.

---

# 33. Client Component Rules

Use `"use client"` only when necessary.

Good reasons:
- state
- event handlers
- browser APIs
- effects
- interactive UI
- drag/drop
- camera/QR

Avoid:

```text
"use client"
```

at the root of an entire dashboard unless genuinely necessary.

Prefer:

```text
Server Page
 ├── Server Header
 ├── Server Data
 └── Client InteractiveWidget
```

---

# 34. Server Component Rules

Server Components should own:

- database reads where appropriate
- authorization boundaries
- secrets
- sensitive business logic
- initial page data
- SEO content
- public content rendering

Never expose:
- database credentials
- payment secrets
- private API keys
- sensitive server logic

to Client Components.

---

# 35. Client State Strategy

Use client state for transient UI:

- open modal
- selected tab
- search text
- filters
- form values
- drag/drop state
- temporary optimistic state

Do not duplicate the entire database in global client state.

---

# 36. Server State Strategy

Server should remain authoritative for:

- payment status
- registration status
- capacity
- portfolio assignment
- verification status
- organizer permissions
- certificates
- results

Client may display a temporary state, but server wins.

---

# 37. Rendering Decision Table

| Module | Rendering |
|---|---|
| Homepage | Server + Cache |
| MUN Listing | Server + Client filters |
| MUN Detail | Server + Cache/Revalidation |
| Public Organizer | Server + Cache |
| MUN Passport | Server + Cache |
| Login | Server + Client form |
| Registration | Server + Client form |
| Payment | Server authority + Client UI |
| Student Dashboard | Server shell + Client |
| Organizer Dashboard | Server shell + Client |
| Registration Table | Server initial + Client |
| Form Builder | Client-heavy + Server persistence |
| Committee Editor | Hybrid |
| Portfolio Assignment | Client + Server validation |
| Admin Dashboard | Server shell + Client |
| Verification Console | Server data + Client workflow |
| QR Check-in | Client + Server validation |
| Results | Hybrid |
| Certificates | Background processing |
| Analytics | Async/streamed |
| Documents | Client upload + Server metadata |
| Static pages | Static |

---

# 38. Route Architecture

Recommended:

```text
app/
├── (public)/
│   ├── page.tsx
│   ├── muns/
│   │   ├── page.tsx
│   │   └── [slug]/
│   │       └── page.tsx
│   └── @username/
│       └── page.tsx
│
├── (auth)/
│   ├── login/
│   └── signup/
│
├── dashboard/
│   ├── page.tsx
│   ├── registrations/
│   ├── passport/
│   └── settings/
│
├── organizer/
│   └── [munId]/
│       ├── page.tsx
│       ├── committees/
│       ├── portfolios/
│       ├── registrations/
│       ├── payments/
│       ├── analytics/
│       └── certificates/
│
└── admin/
    ├── page.tsx
    ├── applications/
    ├── verification/
    ├── muns/
    ├── payments/
    ├── results/
    └── audit/
```

Keep route-level Server Components as the default.

---

# 39. Subdomain Rendering

For:

```text
oxford.munhub.in
vit-mun-2027.munhub.in
```

resolve:

```text
hostname
 ↓
MUN slug
 ↓
MUN ID
 ↓
Cached tenant config
 ↓
Server-rendered public page
```

Public MUN pages should be heavily cached.

Organizer/admin routes remain authenticated and dynamic.

---

# 40. SEO Strategy

All important public content must be server-rendered or pre-rendered.

Required:
- metadata
- title
- description
- canonical URLs
- Open Graph
- structured data where appropriate
- sitemap
- robots configuration

Important SEO pages:

```text
MUN pages
Organizer pages
City pages
Committee/category pages
Public MUN Passport pages
```

Do not depend on client JavaScript to render SEO-critical text.

---

# 41. Performance Strategy

Rendering architecture must support the <100ms perceived interaction goal.

Use:

- Server rendering for first meaningful content
- CDN caching
- Client-side interaction
- optimistic updates
- route prefetching
- Suspense
- streaming
- request deduplication
- parallel data fetching
- background jobs
- minimal client JS

---

# 42. Security Strategy

Client rendering must never replace server authorization.

Bad:

```text
if (user.role === "admin") {
  allowRefund()
}
```

Good:

```text
Client
 ↓
Request
 ↓
Server
 ↓
Authenticate
 ↓
Authorize
 ↓
Validate
 ↓
Execute
```

The UI can hide unavailable actions, but the server must enforce permissions.

---

# 43. Data Freshness Strategy

## Very fresh

Use server/database:
- payment
- registration status
- capacity
- portfolio assignment
- refunds

## Moderately fresh

Use cache + revalidation:
- MUN description
- committees
- EB
- schedule
- FAQs

## Stable

Use static/cache:
- About
- Help
- Terms
- Privacy

---

# 44. Rendering Anti-Patterns

Avoid:

### Anti-pattern 1
Entire application marked `"use client"`.

### Anti-pattern 2
Every button triggers a page reload.

### Anti-pattern 3
Every component independently queries the database.

### Anti-pattern 4
Fetching all registrations into the browser.

### Anti-pattern 5
Blocking dashboard on analytics.

### Anti-pattern 6
Using client state as the source of truth for payments.

### Anti-pattern 7
Doing expensive work in middleware.

### Anti-pattern 8
Sending large images through the application server.

### Anti-pattern 9
Generating certificates synchronously.

### Anti-pattern 10
Fetching the same MUN data multiple times.

---

# 45. Performance Acceptance Criteria

### Public pages
- Server-rendered useful content
- CDN/cache where appropriate
- SEO content available without client JS
- Fast first render

### Interactive pages
- UI acknowledges actions within 100ms where technically possible
- No unnecessary server round trip for local interactions
- Optimistic feedback where safe
- Skeleton/streaming for async data

### Database
- Critical queries measured
- No N+1
- Proper indexes
- Parallel independent queries

### Client
- Minimal JavaScript
- No unnecessary global Client Components
- Large tables virtualized/paginated

### Security
- Server remains authoritative for sensitive actions

---

# 46. Final MUNHub Rendering Rule

Use this simple rule across the entire codebase:

```text
PUBLIC + SEO + READ-HEAVY
        ↓
SERVER / STATIC / CACHE

INTERACTIVE + BROWSER-DEPENDENT
        ↓
CLIENT COMPONENT

SENSITIVE + AUTHORITATIVE
        ↓
SERVER

HEAVY + LONG-RUNNING
        ↓
BACKGROUND JOB
```

Therefore, the ideal MUNHub architecture is:

```text
                    MUNHub
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      PUBLIC        STUDENT        ORGANIZER
        │              │              │
 Server/Cache     Server Shell     Server Shell
        │              │              │
 Client widgets    Client UI       Client UI
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                  Server Actions
                    / APIs
                       │
                       ▼
                 Neon PostgreSQL
                       │
                 Background Jobs
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
            R2        SES      Queues
```

**Final principle:**

> **Server-render what should be fast, discoverable and trusted. Client-render what should feel interactive. Keep sensitive decisions on the server and move expensive work to background jobs.**

This gives MUNHub the best combination of **SEO + performance + smooth UX + security + scalability**.
