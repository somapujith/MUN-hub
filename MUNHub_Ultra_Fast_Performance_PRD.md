# MUNHub — Ultra-Fast & Smooth Performance PRD
## Sub-100ms Interaction Experience

**Version:** 1.0  
**Product:** MUNHub  
**Objective:** Make MUNHub feel instant, responsive and smooth, targeting **<100ms perceived response for common interactions**.

> Important: not every server/database/payment operation can physically complete in 100ms. The product requirement is that the UI acknowledges normal interactions within 100ms and expensive work continues intelligently in the background.

## 1. Performance Goals

| Metric | Target |
|---|---:|
| Button/tap visual response | <50ms |
| Normal UI interaction acknowledgement | <100ms |
| Tabs/modals/dropdowns | <100ms |
| Client-side filtering | <100ms |
| Optimistic mutation feedback | <100ms |
| Initial meaningful content | <1s |
| LCP | <2.0s |
| CLS | <0.1 |
| INP target | <200ms |
| API p50 | <100ms |
| API p95 | <300ms |
| API p99 | <500ms |
| DB p50 | <50ms |
| DB p95 | <150ms |

## 2. Core Architecture

```text
USER
  ↓
Cloudflare Edge / CDN
  ↓
Next.js
  ├── Browser/Client state
  ├── Server Components
  ├── Server Actions / APIs
  ↓
Cache
  ↓
Neon PostgreSQL / R2
  ↓
Background Queue
  ├── Emails
  ├── Certificates
  ├── Exports
  └── Heavy processing
```

Core principle:

```text
User Action → <100ms UI feedback → Server operation → State reconciliation
```

## 3. Next.js Rules

### Server Components
Use for initial data, SEO pages, public MUN pages and initial dashboard state.

### Client Components
Use for highly interactive areas:
- filters
- search
- tabs
- modals
- tables
- form builders
- drag/drop
- portfolio assignment
- registration management
- admin queues

Do not turn every small interaction into a server round trip.

## 4. Navigation

Use:
- Next.js `<Link>`
- route prefetching
- Suspense
- streaming
- loading skeletons
- partial rendering
- cached data

Target:

```text
Hover/viewport → Prefetch → Click → Instant transition
```

## 5. Database Performance

Deploy Next.js and Neon in the same/nearby region.

Use connection pooling. Avoid opening unnecessary connections per request.

Index common access paths:

```text
users.email
muns.slug
muns.status
muns.organizer_id
muns.start_date
registrations.id
registrations.mun_id
registrations.user_id
registrations.status
registrations.payment_status
payments.order_id
payments.payment_id
committees.mun_id
portfolios.committee_id
certificates.certificate_id
```

Query budgets:
- Simple: <20ms
- Normal: <50ms
- Complex: <100ms
- Heavy analytics: background job

Never use `SELECT *` for large operational queries.

## 6. Avoid N+1 Queries

Bad:

```text
Get 100 registrations
→ query committee 100 times
```

Good:

```text
Get registrations + related data in batched queries/JOINs
```

Parallelize independent work with `Promise.all()` where appropriate.

## 7. Caching

Use four layers:

1. Browser cache — static assets, fonts, icons.
2. Cloudflare CDN — public MUN pages, images and safe public assets.
3. Application cache — MUN details, committees, FAQs, schedules and safe summaries.
4. Database — authoritative mutable state.

Never cache authoritative payment, capacity or portfolio-assignment state in a way that can create incorrect confirmations.

When verified public content changes:

```text
Database update → invalidate relevant cache → revalidate public page
```

## 8. Optimistic UI

Use optimistic updates for safe actions:
- save FAQ
- mark notification read
- toggle visibility
- save non-critical settings
- local filters

Example:

```text
Click Save
→ immediately show Saved/ Saving
→ server request
→ success: keep state
→ failure: rollback + clear error
```

Do not use fake optimistic confirmation for payment/refund/security actions.

## 9. Immediate Feedback

Every async interaction needs a visible state:

```text
Approve → Approving... → Approved ✓
Delete → Deleting... → Deleted
Save → Saving... → Saved ✓
Payment → Processing... → Confirmed
```

Never leave the interface visually frozen after a click.

## 10. Loading UX

Avoid full-screen spinners. Use skeletons and progressive rendering.

```text
Page shell
 ↓
Critical content
 ↓
Secondary content
 ↓
Analytics/history
```

The page structure should appear immediately even when secondary data is loading.

## 11. Search & Tables

For already-loaded data, filter locally.

For large datasets:
- debounce search ~150ms
- indexed server search
- server-side filtering/sorting
- pagination or cursor pagination
- virtualization for large tables

Never load 50,000 registrations into the browser.

## 12. Forms

Organizer and registration forms must not rerender unnecessarily.

Use field-level subscriptions/state and debounced validation.

Autosave:

```text
Edit → local state → debounce 500–1000ms → server save
```

Typing must never wait for the database.

## 13. Background Jobs

Move heavy work out of request/response paths:
- certificate generation
- bulk email
- CSV/XLSX/PDF exports
- large analytics
- image processing
- bulk notifications

Pattern:

```text
Request → create job → respond immediately → worker processes → update status → notify
```

Example:

```text
Generate 2,000 certificates
→ "Generation started"
→ background worker
→ progress 347/2000
→ completed
```

## 14. Payments

Payment-provider latency cannot be guaranteed under 100ms.

Correct UX:

```text
Pay click
→ <100ms UI acknowledgement
→ Razorpay
→ webhook
→ server verification
→ registration confirmation
```

Never confirm registration from a frontend success screen alone.

## 15. Authentication & Middleware

Avoid repeatedly fetching session/user/organizer/permissions independently in every component.

Middleware should remain lightweight. Avoid database queries and external API calls on every request.

Security is more important than the 100ms target for authorization and financial actions.

## 16. Multi-Tenant Performance

MUNHub uses wildcard subdomains:

```text
oxford.munhub.in
vit-mun-2027.munhub.in
```

Resolve:

```text
hostname → MUN slug → MUN ID → cached tenant configuration
```

Do not perform an unnecessary database lookup just to resolve a frequently requested hostname.

All tenant queries still require correct server-side isolation.

## 17. Image & Asset Optimization

Use:
- Next.js Image
- WebP/AVIF where appropriate
- responsive sizes
- lazy loading
- thumbnails
- CDN delivery

Never send original multi-megabyte images to small cards.

Keep fonts minimal: ideally one primary family and only required weights.

## 18. JavaScript Bundle

Minimize client JavaScript using:
- Server Components
- code splitting
- dynamic imports
- lazy loading
- tree shaking

Do not globally ship a large library needed by only one page.

## 19. Animation

Animations should make the product feel faster.

Prefer short 100–200ms transitions and GPU-friendly `transform`/`opacity`.

Avoid long page fades, excessive blur and heavy layout animations.

## 20. API Design

Return only what the screen needs.

Prefer:

```text
GET /api/muns/:id
GET /api/muns/:id/committees
GET /api/muns/:id/registrations
GET /api/muns/:id/analytics
```

rather than one endpoint returning every related entity.

Deduplicate identical requests across components.

## 21. Critical vs Non-Critical Data

### Critical
- page identity
- user identity
- primary MUN information
- primary registration state

### Important
- registration counts
- notifications
- secondary content

### Non-critical
- analytics
- historical charts
- activity logs

Render in that order.

## 22. Offline / Poor Network

For safe operations:
- preserve unsaved form state
- retry transient failures
- show connection state
- sync safe changes after reconnect

Do not blindly queue financial operations.

## 23. Idempotency

Critical mutations require idempotency:
- payments
- registration confirmation
- refunds
- certificate issuance
- result submission

Example:

```text
Request ID abc123
First request → execute
Duplicate request → return existing result
```

This prevents duplicate transactions.

## 24. Monitoring

Measure in production:
- API latency
- DB latency
- cache hit ratio
- error rate
- page performance
- interaction latency
- bundle size
- slow queries
- external API latency

Recommended tools:
- Sentry
- PostHog
- Cloudflare analytics
- Neon/database monitoring

Track p50, p75, p95 and p99 rather than only averages.

## 25. Performance Testing

Always test the production build:

```bash
npm run build
npm run start
```

Do not judge production performance only from `npm run dev`.

Load-test:
- 100 users
- 500 users
- 1,000 users
- 5,000 concurrent users

Test especially:
- marketplace
- MUN pages
- login
- registration
- organizer dashboard
- admin dashboard
- payment webhooks

## 26. Registration Launch Scenario

MUNHub must remain responsive when hundreds/thousands of students open a popular MUN simultaneously.

Use:

```text
Public MUN page
→ CDN/cache
→ origin only for required dynamic data
→ indexed database queries
→ rate limiting
```

Capacity and payment state remain authoritative server-side.

## 27. Performance Acceptance Criteria

A feature is production-ready only if:

- UI acknowledges normal interactions in <100ms where technically possible.
- No unnecessary blocking network request exists.
- Critical queries meet their latency budgets.
- Heavy work is asynchronous.
- Loading states exist.
- Errors can recover without data loss.
- API p95 meets target or has a documented reason.
- No unexplained N+1 queries exist.
- Large tables use pagination/virtualization.
- Images are optimized.
- Client bundle is reviewed.
- Production build has been tested.
- Monitoring is enabled.

## 28. What Should NOT Be Forced Under 100ms

These depend on external providers or workload:
- Razorpay payment confirmation
- email delivery
- bulk certificate generation
- large exports
- large analytics
- external APIs
- massive writes

The correct experience is:

```text
<100ms → "Processing..." → background/external operation → "Completed ✓"
```

## 29. Golden Rules

1. UI response <100ms.
2. Never block interaction on unnecessary network requests.
3. Keep safe interactions local.
4. Cache read-heavy public data.
5. Keep authoritative financial/security state server-side.
6. Keep Next.js and Neon geographically close.
7. Index important query paths.
8. Avoid N+1 queries.
9. Parallelize independent requests.
10. Use optimistic UI for safe mutations.
11. Use background jobs for heavy work.
12. Stream and progressively render pages.
13. Virtualize large tables.
14. Optimize images.
15. Keep client JavaScript small.
16. Prefetch likely next routes.
17. Deduplicate requests.
18. Use idempotency for critical mutations.
19. Monitor p50/p95/p99.
20. Test realistic production workloads.

## 30. Final Experience

MUNHub should feel like:

```text
CLICK
 ↓
INSTANT RESPONSE
 ↓
SMOOTH TRANSITION
 ↓
CONTENT APPEARS
 ↓
BACKGROUND SYNC
```

The key principle is:

> **Make the product respond in under 100ms; do not make the user wait for operations that do not need to block the interface.**

For MUNHub, this gives the right balance between speed, security, consistency and scalability.
