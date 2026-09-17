# Lane: marketplace (public marketplace, MUN page, SEO)

Lead: mun-hub-62. Worktree branch `worktree-wf_a8625366-3be-6`, fast-forwarded to `main` at `73bcdf4` before starting. The original base `3a4cc9e` didn't have the lane plan or migration 0031.

## What changed

### 1. Public data safety (`lib/actions/marketplace.ts`, `server/routes/muns.ts`, `lib/types/mun.ts`)

- **`searchMuns` status clipping.** `searchMuns` always clips `status` to `PUBLICLY_VISIBLE_STATUSES`, so the clip also covers direct lib callers, not just the route.
  - `?status=DRAFT` returns `{ results: [], total: 0 }`. It never falls back to the default list.
  - A mixed list keeps only its public part.
  - Pure helpers: `clipToPublicStatuses` and `isPubliclyVisibleStatus`.
- **`PUBLICLY_VISIBLE_STATUSES`** is `PUBLISHED`, `REGISTRATION_OPEN`, `REGISTRATION_CLOSED`, `CONFERENCE_ACTIVE`, `RESULTS_PENDING`, `RESULTS_UNDER_REVIEW`, `COMPLETED` and `ARCHIVED`.
  - `RESULTS_PENDING` and `RESULTS_UNDER_REVIEW` are new. Before this, a live MUN page returned 404 between the conference and completion.
  - `UNPUBLISHED`, `SUSPENDED`, `CANCELLED` and every pre-publication state stay hidden.
  - The default listing is still the three registration statuses.
- **`getMunBySlug` returns `PublicMunDetail`**, built only from explicit column lists (`PUBLIC_MUN_COLUMNS` and `PUBLIC_PRODUCT_COLUMNS`, plus explicit committee and portfolio columns).
  - It never returns `organizerId`, `createdAt`, `updatedAt` or `publishedAt`. A column added to `muns` later stays private by default.
  - It adds `coverImage` and `logo` (the COVER and LOGO `mun_media` URLs).
  - It adds `contact` with only `officialEmail`, `phone` and `website`. The contact person's name, email and phone are never included.
  - It adds `mapUrl`, the address, the registration window, conference and participant type, and `accommodationProvided`.
  - It keeps `formFields`, `committees` and `registrationProducts`, which the registration funnel uses.
  - Committees and portfolios are now ordered by creation; products by `displayOrder`.
- **`assertMunPubliclyVisible(munId)`** throws `Mun not found` for hidden and missing MUNs alike. Public by-id reads such as the FAQs use it.

### 2. Search and filters

- **Text search.** Every whitespace-separated term (up to 8) must match at least one of:
  - the MUN's name, city, country or theme
  - the organizer's name or institution

  LIKE wildcards are escaped. There is no organization-name column, so the organizer user's `name` and `institution` stand in.
- **New params:**
  - `dateFrom` and `dateTo`: the conference `[startDate, coalesce(endDate, startDate)]` must overlap the window.
  - `sortBy=deadline`: registration deadlines still ahead come first, soonest first. MUNs with no deadline or a passed one come after, then everything by start date.
- **Sort changes.** `newest` sorts by `coalesce(publishedAt, createdAt)`. Every sort ends on `id`, so paging is stable.
- **Card fields.** Summary cards now carry `coverImage` (the first COVER media URL) and `registrationOpensAt`/`registrationDeadline`.
- **`/muns` URL parameters** (defined in `web/src/lib/marketplace-filters.ts`):

  | Param | Meaning |
  |---|---|
  | `q` | Search text |
  | `city` | City (the nav bar's city picker writes this) |
  | `country` | Country |
  | `status` | Registration status (same three options as the home page) |
  | `price` | Fee band (same bands as the home page) |
  | `from` / `to` | Local `YYYY-MM-DD` days; the client sends local start and end of day as ISO |
  | `sortBy` | Sort order |
  | `page` | Page number |

- **Filter rail.** It has groups for Registration, Conference dates (presets for 30, 90 and 180 days, plus custom From/To), Delegate fee, Country and Sort. Mobile shows removable chips for each filter. Every change resets `page`.
- **Fixed: rapid clicks dropped filters.** A second quick click used to drop the first filter, because `useSearchParams` returns stale params while the previous navigation's transition is pending. Both rails now build the next URL from `window.location.search`. The home rail had the same bug.
- **Search bar.** It still works as a plain GET form, but with JS it navigates in-app and keeps every active filter.
- **Home page.**
  - "Closing soon" uses real registration deadlines (within 21 days, soonest first). A MUN with no deadline uses its start date instead.
  - Each shelf's "See all" link opens the matching `/muns` view (status, sort, city and fee band).
  - Cards show the cover image, plus "Closes <date>" for an open MUN whose deadline is still ahead.

### 3. MUN page (`web/src/pages/mun-detail-page.tsx`, `web/src/components/mun/*`)

- **Page structure.** Sections in order:
  1. Hero: cover image, logo and status
  2. Sticky in-page section nav (plain `#anchors`; active link tracks scroll; smooth scroll respects reduced motion; focus moves to the section heading)
  3. Key facts rail: dates, venue and address with an "Open in maps" link, registration window, organizer, format. It sits first on mobile and in a sticky right rail from `lg`.
  4. About
  5. Committees, with agenda label, committee type and portfolios
  6. Executive board, grouped as Secretariat and then per committee, with photo or initials
  7. Schedule, grouped by day in the visitor's timezone (like every other date on the site)
  8. Accommodation options, or a "not arranged" note when `NOT_PROVIDED`
  9. Documents, with download links
  10. Gallery and sponsors
  11. FAQs, as native `<details>`
  12. Organizer card with the official email, phone and website
  13. Passes (unchanged; `RegistrationProductCard` still belongs to the payments lane)
- **Data loading.** Every section is its own query against the existing public by-id endpoints:
  - `/muns/:id/schedule`
  - `/muns/:id/executive-board`
  - `/muns/:id/documents`
  - `/muns/:id/accommodation`
  - `/muns/:id/media`
  - `/muns/:id/faqs`

  Each section has loading, empty and error states.
- **Section visibility.**
  - Core sections always show, with an empty state: About, Committees, Schedule, Documents.
  - Optional sections are left out of the page and the nav when empty: Executive board, Accommodation, Gallery, FAQs.
  - Accommodation shows whenever the organizer answered the "do you offer accommodation" question.
- **Contact data.** The page does **not** call `GET /muns/:id/contact`, which also returns the contact person. The official channels come from `getMunBySlug` instead.
- **Safety:**
  - Organizer-supplied URLs are only rendered as links when they are http(s) or a same-origin path (`safeLinkUrl` and `safeWebsiteUrl`). A `javascript:` document URL shows "Unavailable".
  - A bare website domain is treated as https.
  - The `mailto:` link is shape-checked, and phone numbers are normalized before building `tel:`.
- **Broken images.** An image that fails to load (for example a mock-storage URL nothing serves) removes itself instead of showing a broken image. The shared `RemoteImage` handles this, and gallery tiles remove themselves the same way.
- **Page-level states.** Loading shows a skeleton. On error there is a "Try again" button. An unknown slug renders the new 404.

### 4. FAQs (`lib/actions/mun-faq.ts`, new `server/routes/mun-faq.ts`)

- **Public read.** `GET /muns/:munId/faqs` serves publicly visible MUNs only and returns 404 otherwise, even to the owner. It returns only `id`, `question`, `answer` and `displayOrder`.
- **Owner or admin endpoints:**

  | Endpoint | Behaviour |
  |---|---|
  | `GET /muns/:munId/faqs/manage` | Lists FAQs in any lifecycle state |
  | `POST /muns/:munId/faqs` | Creates an FAQ; appended at the end unless `displayOrder` is given |
  | `PATCH /faqs/:faqId` | Updates an FAQ |
  | `DELETE /faqs/:faqId` | Deletes an FAQ |

- **Validation.** Text is trimmed; the question must be 1–300 characters and the answer 1–4000. The route checks this with zod (400), and the lib checks it again. An unknown FAQ id returns 404 (`FAQ not found`).
- **No module lock.** FAQs aren't one of the 15 tracked modules, so they have no LOCKED gate and no completion row.
- **Mounting.** The routes are mounted in `server/routes/protected.ts` (two added lines).
- **Signature change.** `createMunFaq` changed from `(munId, question, answer, session)` to `(munId, input, session)`; the old signature had no callers.
- **Web client.** `web/src/api/mun-faq.ts` is ready for the organizer UI.

### 5. Marketplace cards show the cover image

The MUN card shows the cover image across the full card width when a COVER media item exists. It is decorative (`alt=""`), and a URL that fails to load removes itself.

### 6. SEO

- **`PageMeta`** (`web/src/components/seo/page-meta.tsx`) sets:
  - title and description
  - canonical link, always `https://www.munhub.in/...` (including on `<slug>.munhub.in` and dev hosts)
  - Open Graph and Twitter tags
  - optional `robots` and JSON-LD

  It is used on the home page, `/muns`, MUN pages and the 404 page.
- **MUN page tags.**
  - Open Graph image: the cover if it is an absolute http(s) URL, otherwise `/og-default.png`.
  - JSON-LD `Event` (`web/src/lib/seo.ts`): name, description, dates, offline attendance, `Place` with `PostalAddress`, image, organizer as an `Organization` with its website, and offers (INR price, `InStock`/`SoldOut` from live seat availability, `PreOrder` before registration opens, `validFrom` = registration open date).
  - JSON-LD is skipped when the MUN has no start date.
  - The JSON is escaped (`<`, `>`, `&`), so organizer text can't close the script tag.
- **`web/index.html`** has static default og/twitter tags for crawlers that don't run JS, marked `data-default-seo`. `PageMeta` removes them on mount: with React 19, react-helmet-async renders real elements and doesn't dedupe them against static tags.
  - There is deliberately no static `<meta name="description">`, because other pages set their own through Helmet and it would be duplicated.
- **`web/public/og-default.png`** is a new 1200×630 image, rendered with Playwright from an HTML card in the design system: white canvas, coral dot wordmark, and coral/forest/cream blocks.
- **404 page.** It now has the site header and footer, `robots: noindex, follow`, no canonical, and helpful links to Browse, My registrations, Organizer workspace and Contact.
- **Title order.** Verified in the browser: the page's `<title>` comes first in `<head>`, so `document.title` is correct even though the root layout's default title and the static one are also present.

## Decisions (made without the user)

- **Visible statuses.** The public status set includes the results states (see §1). `CANCELLED` stays hidden.
- **Contact data.** The official contact is served inside `GET /muns/:slug` rather than read from the contact endpoint.
- **Organization name.** Search uses the organizer's user name and institution, because no organization-name column exists.
- **City filter.** City stays in the nav bar's picker only; the rail doesn't duplicate it. This keeps the existing design decision.
- **Timezones.** Schedule times and dates render in the visitor's timezone, the existing convention on the site. `muns` has no timezone column.
- **Fee policy label.** The `REFUND_POLICY` document kind is labelled "Fee policy", because there are no refunds in the product.
- **Card images.** A card without a cover image keeps the existing text-only card; there is no placeholder band.
- **No web unit tests.** `web/` has no test runner, and adding vitest imports under `web/src` would break `tsc -b`. The lib and route logic has tests at the root.

## Env vars and bindings

None. No new env vars, secrets, bindings or migrations.

## Follow-ups

- **sec-edge: contact endpoint.** `GET /muns/:munId/contact` still returns the contact person's name, email and phone to anyone. The public page no longer needs it, so it can become owner/admin-only (or have those fields stripped).
- **sec-edge: shared visibility rule.** When adding published-or-owner guards to the by-id public reads, reuse `PUBLICLY_VISIBLE_STATUSES` or `assertMunPubliclyVisible` from `lib/actions/marketplace.ts`. With a narrower set, pages of MUNs in `CONFERENCE_ACTIVE`/`RESULTS_*`/`COMPLETED`/`ARCHIVED` would render but show "couldn't load" in every section.
- **Organizer FAQ editor** (mun-hub-f1 or later). The API and a web client (`web/src/api/mun-faq.ts`) exist; the workspace UI doesn't.
- **Social previews for MUN links.** WhatsApp, Slack, X and LinkedIn previews only ever see the static default card, because the SPA has no SSR. Per-MUN previews need a pre-render or an edge `HTMLRewriter` on the web Worker (and the equivalent for Vercel on www). SSR is out of scope for this run.
- **Sitemap.** `listPublicMunSlugs` still lists only the three listing statuses. Adding completed and archived MUN pages is an SEO choice for later. `server/routes/sitemap.ts` belongs to sec-edge.
- **Home "Closing soon" coverage.** The shelf is derived from the first 12 open MUNs (the home query's limit). With many open MUNs it could miss some; a dedicated `sortBy=deadline` query would fix that.
- **`registration-product-card.tsx`** (payments lane) still triggers the oxlint `react(purity)` warning for `Date.now()` in render.
- **Header search label.** The screen-reader label in `site-header-search.tsx` (layout, not this lane) still says "Search MUNs by name or city"; search now also matches country, theme and organizer.

## Verification

Run inside the worktree.

- **Tests.** `npx vitest run lib/actions/marketplace.test.ts lib/actions/mun-faq.test.ts server/integration/marketplace.integration.test.ts server/integration/mun-config.integration.test.ts server/integration/registration-eligibility.integration.test.ts server/integration/error-taxonomy.test.ts --no-file-parallelism`: 62/62 passed.
- **Server typecheck.** `cd server && npx tsc --noEmit -p tsconfig.json`: clean.
- **Web typecheck.** `cd web && npx tsc -b --noEmit`: clean.
- **Web lint.** `npx oxlint` on the changed web paths: no new findings. The one warning is the pre-existing one in `registration-product-card.tsx`.
- **Web build.** `npx vite build` into a scratch directory: builds. The chunk-size warning was already there.
- **Browser check.** Playwright against a local API on :3106 and web on :5206, with a seeded demo MUN (removed afterwards):
  - Detail page, desktop and 390px mobile: no horizontal scroll; section nav scrolls, highlights and moves focus.
  - The hidden executive-board member and the contact person are not rendered.
  - The `javascript:` document link is not rendered.
  - A broken gallery image is dropped.
  - Head tags are correct: title, canonical, og, JSON-LD, and 404 noindex.
  - `/muns`: status, sort, date preset and custom date combine correctly, and a search keeps the filters.
  - Home shelves and "See all" links work, and dark mode renders correctly.
