import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { CitySelector } from "@/components/marketplace/city-selector";
import { MunAdCarousel } from "@/components/mun/mun-ad-carousel";
import { MunRow } from "@/components/mun/mun-row";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardActions,
  SignatureCardDescription,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import { getMarketplaceFacets, searchMuns } from "@/lib/actions/marketplace";
import { getSession } from "@/lib/auth/session";
import type { MunSummary } from "@/lib/types";

/**
 * Homepage — a browse-first "shelf" surface (carousel -> city pills -> status
 * rows), rendered in the DESIGN-airtable.md editorial system.
 *
 * Band order:
 *   1. carousel       rotating `signature-card` promos (coral/forest/dark)
 *   2. white canvas   city pill row + status-grouped horizontal shelves
 *   3. cream          `cream-callout-card`  organizer conversion
 *   4. dark navy      `hero-card-dark`      closing CTA
 *   5. light          `footer`
 *
 * Data is live: `searchMuns` and `getMarketplaceFacets` from
 * `lib/actions/marketplace.ts` (frozen backend contract — this page reads it,
 * never edits it).
 *
 * ---------------------------------------------------------------------------
 * ROW SELECTION LOGIC — and why it is what it is
 * ---------------------------------------------------------------------------
 * The brief asked for "Opening soon" and "Closing soon" rows. Neither concept
 * is expressible against the current backend contract, so both are mapped onto
 * the nearest signal that the data actually carries:
 *
 *   - There is NO "registration opens at" field anywhere. `muns` has
 *     startDate/endDate/publishedAt only (lib/db/schema.ts), and `MunSummary`
 *     exposes startDate/endDate/status/minPrice. "PUBLISHED with a future
 *     registration-open date" therefore cannot be computed — the closest true
 *     statement is "PUBLISHED but not yet REGISTRATION_OPEN", i.e. listed and
 *     awaiting its registration window. That's what "Opening soon" selects,
 *     and the row copy says exactly that rather than implying a known date.
 *
 *   - `registrationProducts.deadline` DOES exist on the schema, but
 *     `searchMuns` never selects it and `MunSummary` has no deadline field, so
 *     a deadline-window filter is not reachable from this page. Nor is it
 *     sortable — `sortBy` accepts only 'date' | 'price' | 'newest'. So
 *     "Closing soon" is instead keyed on the conference start date: among
 *     REGISTRATION_OPEN muns, the ones starting within CLOSING_SOON_DAYS. A
 *     conference that starts in under ~6 weeks is genuinely about to stop
 *     taking delegates, and unlike a deadline guess it's derived from a real,
 *     non-null column.
 *
 * If a true deadline-driven row is wanted later, the backend needs `deadline`
 * (min over active products) added to `MunSummary`/`searchMuns` plus a
 * 'deadline' sort option. That is a lib/ change and deliberately not made here.
 */

/** Start-date horizon that counts a registration-open MUN as "closing soon". */
const CLOSING_SOON_DAYS = 42;

/** How many promo slides the carousel gets. */
const FEATURED_LIMIT = 5;

/** Cards per shelf — enough to overflow the row and prove it scrolls. */
const ROW_LIMIT = 12;

interface HomeProps {
  searchParams: Promise<{ city?: string }>;
}

/**
 * Builds a /muns href for a row's "See all", carrying the active city.
 *
 * Deliberately city-only, with no `?status=`: `app/muns/page.tsx` parses
 * q/city/country/sortBy/page and nothing else, so a status param would be
 * silently dropped and the link would claim a filter it doesn't apply. Adding
 * status support to the marketplace page is out of scope here.
 */
function seeAllHref(city: string): string {
  return city ? `/muns?city=${encodeURIComponent(city)}` : "/muns";
}

export default async function Home({ searchParams }: HomeProps) {
  const { city: rawCity } = await searchParams;

  const facets = await getMarketplaceFacets();

  // Only honour a city the marketplace actually knows about. An arbitrary
  // `?city=<anything>` would otherwise render three empty rows and a page with
  // no content at all, and it lets a crawler mint unlimited junk URLs.
  const city = rawCity && facets.cities.includes(rawCity) ? rawCity : "";
  const cityFilter = city || undefined;

  const [openNow, publishedOnly, session] = await Promise.all([
    // Actionable right now: registration is open. Soonest conference first.
    searchMuns({
      status: ["REGISTRATION_OPEN"],
      city: cityFilter,
      sortBy: "date",
      limit: ROW_LIMIT,
    }),
    // Listed and reviewed, but the registration window hasn't opened yet.
    searchMuns({
      status: ["PUBLISHED"],
      city: cityFilter,
      sortBy: "date",
      limit: ROW_LIMIT,
    }),
    getSession(),
  ]);

  const now = Date.now();
  const closingSoonCutoff = now + CLOSING_SOON_DAYS * 24 * 60 * 60 * 1000;

  const closingSoon = openNow.results.filter(
    (mun) =>
      mun.startDate !== null &&
      mun.startDate.getTime() >= now &&
      mun.startDate.getTime() <= closingSoonCutoff,
  );

  // Featured = registration-open first (a slide you can act on beats one you
  // can't), then the rest by soonest start date. Past-dated conferences are
  // never promoted — a banner for a conference that already happened is worse
  // than one fewer slide.
  const featured: MunSummary[] = [...openNow.results, ...publishedOnly.results]
    .filter((mun) => mun.startDate === null || mun.startDate.getTime() >= now)
    .slice(0, FEATURED_LIMIT);

  const hasAnyRow =
    openNow.results.length > 0 || publishedOnly.results.length > 0;

  const cityLabel = city ? ` in ${city}` : "";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ---- 1. rotating promo carousel --------------------------------- */}
        {featured.length > 0 && (
          <section className="pt-xl pb-xxl">
            <div className="content-container">
              <MunAdCarousel slides={featured} />
            </div>
          </section>
        )}

        {/* ---- 2. city pills + status shelves ----------------------------- */}
        <section className="pb-section">
          <div className="content-container">
            <div className="flex flex-col gap-sm border-b border-border pb-lg">
              <h1 className="font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink">
                Model UN conferences{cityLabel}
              </h1>
              <p className="max-w-[60ch] text-body-md text-body dark:text-muted-foreground">
                Every listing is reviewed before it goes live. Pick a city to
                narrow everything below.
              </p>
              <div className="pt-xs">
                <CitySelector cities={facets.cities} selected={city} />
              </div>
            </div>

            {hasAnyRow ? (
              <div className="flex flex-col gap-xxl pt-xl">
                <MunRow
                  title="Registration open now"
                  description="Accepting delegates today — soonest conference first."
                  muns={openNow.results}
                  seeAllHref={seeAllHref(city)}
                />

                <MunRow
                  title="Closing soon"
                  description={`Registration is open, but the conference starts within ${CLOSING_SOON_DAYS} days.`}
                  muns={closingSoon}
                  seeAllHref={seeAllHref(city)}
                />

                <MunRow
                  title="Opening soon"
                  description="Listed and reviewed — registration hasn't opened yet."
                  muns={publishedOnly.results}
                  seeAllHref={seeAllHref(city)}
                />
              </div>
            ) : (
              <div className="pt-xl">
                <SignatureCard variant="cream" padding="lg" className="items-start">
                  <SignatureCardTitle className="text-title-lg sm:text-title-lg">
                    {city
                      ? `No conferences in ${city} yet`
                      : "No conferences are published yet"}
                  </SignatureCardTitle>
                  <SignatureCardDescription className="text-[#333840]">
                    {city
                      ? "Nothing is listed in this city right now. Browse every city instead — or check back once a local organizer clears review."
                      : "Once organizers clear review, their conferences appear here first."}
                  </SignatureCardDescription>
                  <SignatureCardActions>
                    <Button variant="on-dark" size="sm" render={<Link href="/" />}>
                      {city ? "Show all cities" : "Browse the marketplace"}
                    </Button>
                  </SignatureCardActions>
                </SignatureCard>
              </div>
            )}
          </div>
        </section>

        {/* ---- 3. cream-callout-card — organizer conversion ---------------- */}
        <section className="pb-section">
          <div className="content-container">
            <SignatureCard
              variant="cream"
              padding="xl"
              className="gap-xl lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="max-w-xl">
                <SignatureCardEyebrow className="opacity-60">
                  For secretariats
                </SignatureCardEyebrow>
                <SignatureCardTitle>
                  List your conference where delegates are already looking.
                </SignatureCardTitle>
                <SignatureCardDescription className="text-title-md text-[#333840] opacity-100">
                  Apply once, get reviewed, then run registrations, committee
                  allotments and delegate lists from a single dashboard — no
                  spreadsheets, no manual payment reconciliation.
                </SignatureCardDescription>
              </div>
              <SignatureCardActions className="mt-0 shrink-0">
                <Button render={<Link href="/organizer/apply" />}>
                  List your MUN
                </Button>
              </SignatureCardActions>
            </SignatureCard>
          </div>
        </section>

        {/* ---- 4. hero-card-dark — closing CTA ----------------------------
            One action only. The doc reserves the primary button for a single
            action per viewport, and `button-secondary-on-dark` is explicitly
            "a white block over dark surfaces — the system never inverts to a
            translucent on-dark style". So the secondary sits as a text link
            rather than a ghost-outlined button.

            No trailing `pb-section` here: the footer opens with its own 96px,
            and stacking both reads as a dead 192px gap above the footer.

            Dark mode contrast against the page canvas is handled inside
            `SignatureCard`'s `dark` variant itself (it swaps to
            `surface-strong` in dark mode, since `surface-dark` collides with
            a canvas that's already that color) — no per-page workaround
            needed here. */}
        <section>
          <div className="content-container">
            <SignatureCard variant="dark" className="items-center">
              <div className="max-w-2xl text-center">
                <SignatureCardTitle className="text-balance">
                  Your next placard is one search away.
                </SignatureCardTitle>
                <SignatureCardDescription className="mx-auto text-title-md opacity-85">
                  Every listing on MUN Hub is reviewed before it goes live, so
                  the conference you register for is the conference you show up
                  to.
                </SignatureCardDescription>
                <SignatureCardActions className="justify-center">
                  <Button variant="on-dark" render={<Link href="/muns" />}>
                    Browse MUNs
                  </Button>
                </SignatureCardActions>
                {/* Don't invite a signed-in visitor to sign in again. */}
                <p className="mt-lg text-body-md text-on-dark/70 dark:text-foreground/70">
                  {session ? "Organizing a conference? " : "Already registered? "}
                  <Link
                    href={session ? "/organizer/apply" : "/login"}
                    className="rounded-sm text-on-dark underline underline-offset-4 transition-opacity duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-on-dark focus-visible:ring-offset-4 focus-visible:ring-offset-surface-dark focus-visible:outline-none dark:text-foreground dark:focus-visible:ring-foreground dark:focus-visible:ring-offset-surface-strong"
                  >
                    {session ? "List your MUN" : "Sign in"}
                  </Link>
                </p>
              </div>
            </SignatureCard>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
