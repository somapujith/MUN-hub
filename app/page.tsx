import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunCardGrid } from "@/components/mun/mun-card-grid";
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

/**
 * Homepage — the long-scroll editorial pacing from DESIGN-airtable.md.
 *
 * Surface rhythm, in order, never repeating a mode in consecutive bands
 * (doc Don't #5 — "two whites in a row read as a typography blog"):
 *
 *   1. white canvas   `hero-band`               headline + button pair, 96px
 *   2. coral          `signature-coral-card`    the marketplace pitch
 *   3. white canvas   featured MUN grid         `article-card` 3-up
 *   4. cream          `cream-callout-card`      organizer conversion
 *   5. dark navy      `hero-card-dark`          closing CTA
 *   6. light          `footer`
 *
 * Every band carries {spacing.section} (96px) vertical padding via
 * `section-rhythm`. The hero is deliberately calm: no gradient, no mesh, no
 * atmospheric backdrop — whitespace alone does the framing (doc Do #4).
 *
 * Data is live: `searchMuns` and `getMarketplaceFacets` from
 * `lib/actions/marketplace.ts` (frozen backend contract).
 */

export default async function Home() {
  const [upcoming, facets, session] = await Promise.all([
    // Default status filter already limits this to PUBLISHED /
    // REGISTRATION_OPEN / REGISTRATION_CLOSED — no internal states leak here.
    searchMuns({ sortBy: "date", limit: 6 }),
    getMarketplaceFacets(),
    getSession(),
  ]);

  const cityCount = facets.cities.length;
  const countryCount = facets.countries.length;

  // Only claim a number the query actually proves. `total` is the full count of
  // publicly-visible MUNs, not the 6 returned rows.
  const liveCount = upcoming.total;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ---- 1. hero-band — white canvas, 96px, no decoration ------------ */}
        <section className="section-rhythm">
          <div className="content-container">
            <div className="max-w-3xl">
              <p className="text-caption uppercase text-muted-foreground">
                Curated Model UN marketplace
              </p>
              <h1 className="mt-md font-display text-display-md tracking-[-0.011em] text-balance text-ink sm:text-display-lg">
                Every Model UN worth your weekend, in one place.
              </h1>
              <p className="mt-lg max-w-xl text-title-md text-body">
                Browse conferences from reviewed organizers, compare committees
                and delegate fees side by side, and register without chasing a
                Google Form.
              </p>
              <div className="mt-xl flex flex-col gap-sm sm:flex-row sm:items-center">
                <Button render={<Link href="/muns" />}>Browse MUNs</Button>
                <Button variant="outline" render={<Link href="/organizer/apply" />}>
                  For organizers
                </Button>
              </div>

              {(liveCount > 0 || cityCount > 0) && (
                <dl className="mt-xxl flex flex-wrap gap-x-xxl gap-y-lg border-t border-border pt-lg">
                  <div>
                    <dt className="text-body-md text-muted-foreground">
                      Conferences listed
                    </dt>
                    <dd className="mt-xxs font-display text-title-lg tabular-nums text-ink">
                      {liveCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-body-md text-muted-foreground">
                      Host cities
                    </dt>
                    <dd className="mt-xxs font-display text-title-lg tabular-nums text-ink">
                      {cityCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-body-md text-muted-foreground">
                      Countries
                    </dt>
                    <dd className="mt-xxs font-display text-title-lg tabular-nums text-ink">
                      {countryCount}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </div>
        </section>

        {/* ---- 2. signature-coral-card — the brand's voltage moment -------- */}
        <section className="pb-section">
          <div className="content-container">
            <SignatureCard variant="coral">
              <div className="max-w-2xl">
                <SignatureCardEyebrow>Find your next conference</SignatureCardEyebrow>
                <SignatureCardTitle>
                  Stop piecing a circuit together from group chats.
                </SignatureCardTitle>
                <SignatureCardDescription className="text-title-md opacity-90">
                  Filter by city, dates and delegate fee. Open the agenda, read
                  the committee list, see exactly what the fee covers — then
                  register in one pass.
                </SignatureCardDescription>
                <SignatureCardActions>
                  <Button variant="on-dark" render={<Link href="/muns" />}>
                    Browse the marketplace
                  </Button>
                </SignatureCardActions>
              </div>
            </SignatureCard>
          </div>
        </section>

        {/* ---- 3. white canvas — featured / upcoming MUNs ------------------ */}
        <section className="pb-section">
          <div className="content-container">
            <div className="flex flex-wrap items-end justify-between gap-md">
              <div className="max-w-xl">
                <h2 className="font-display text-title-lg tracking-[-0.011em] text-ink sm:text-display-md">
                  Happening next
                </h2>
                <p className="mt-sm text-body-md text-body">
                  The soonest conferences currently accepting delegates, sorted
                  by start date.
                </p>
              </div>
              <Link
                href="/muns"
                className="group/all inline-flex items-center gap-xxs rounded-sm text-body-md text-link transition-colors duration-150 hover:text-link-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                View all conferences
                <ArrowRightIcon
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-3.5 transition-transform duration-150 ease-out group-hover/all:translate-x-px"
                />
              </Link>
            </div>

            <div className="mt-xl">
              <MunCardGrid
                muns={upcoming.results}
                emptyMessage="No conferences are published yet. Once organizers clear review, they'll appear here first."
              />
            </div>
          </div>
        </section>

        {/* ---- 4. cream-callout-card — organizer conversion ---------------- */}
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

        {/* ---- 5. hero-card-dark — closing CTA ---------------------------- */}
        <section className="pb-section">
          <div className="content-container">
            <SignatureCard variant="dark" className="items-start text-center sm:items-center">
              <div className="max-w-2xl sm:text-center">
                <SignatureCardTitle className="text-balance">
                  Your next placard is one search away.
                </SignatureCardTitle>
                <SignatureCardDescription className="text-title-md opacity-85 sm:mx-auto">
                  Every listing on MUN Hub is reviewed before it goes live, so
                  the conference you register for is the conference you show up
                  to.
                </SignatureCardDescription>
                <SignatureCardActions className="sm:justify-center">
                  <Button variant="on-dark" render={<Link href="/muns" />}>
                    Browse MUNs
                  </Button>
                  {/* Don't invite a signed-in visitor to sign in again — send
                      organizers to the listing flow instead. */}
                  <Button
                    variant="on-dark"
                    className="border-white/35 bg-transparent text-white hover:bg-white/10 active:bg-white/15"
                    render={
                      <Link href={session ? "/organizer/apply" : "/login"} />
                    }
                  >
                    {session ? "List your MUN" : "Sign in"}
                  </Button>
                </SignatureCardActions>
              </div>
            </SignatureCard>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
