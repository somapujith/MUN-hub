import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunAdCarousel } from "@/components/mun/mun-ad-carousel";
import { HomeFilterSidebar } from "@/components/mun/home-filter-sidebar";
import { MunRow } from "@/components/mun/mun-row";
import { PageMeta } from "@/components/seo/page-meta";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardActions,
  SignatureCardDescription,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import { useListYourMunHref } from "@/hooks/use-list-your-mun-href";
import { resolvePriceBand, resolveStatusFilter } from "@/lib/home-filters";
import { ALL_CITIES_PARAM, DEFAULT_CITY, resolveCityParam } from "@/lib/marketplace-filters";
import { getMarketplaceFacets, searchMuns, type MunSearchParams } from "@/api/marketplace";
import { queryKeys } from "@/api/query-keys";
import { DEFAULT_DESCRIPTION } from "@/lib/seo";
import type { MunSearchResult, MunSummary } from "@/types";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

/**
 * "Closing soon": the registration deadline falls within this many days. A MUN
 * with no deadline set closes when the conference starts, so its start date
 * stands in.
 */
const CLOSING_SOON_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;
const FEATURED_LIMIT = 5;
const ROW_LIMIT = 12;
const EMPTY_RESULT: MunSearchResult = { results: [], total: 0 };

/** The /muns view that continues a shelf — same city and fee band, plus the shelf's own status/sort. */
function seeAllHref(filters: { city: string; price: string | null }, shelf: { status?: string; sortBy?: string }): string {
  const params = new URLSearchParams();
  if (filters.city) params.set("city", filters.city);
  if (filters.price) params.set("price", filters.price);
  if (shelf.status) params.set("status", shelf.status);
  if (shelf.sortBy) params.set("sortBy", shelf.sortBy);
  const qs = params.toString();
  return qs ? `/muns?${qs}` : "/muns";
}

function closesAt(mun: MunSummary): Date | null {
  return mun.registrationDeadline ?? mun.startDate;
}

function isClosingSoon(mun: MunSummary, now: number): boolean {
  const close = closesAt(mun)?.getTime();
  return close !== undefined && close >= now && close <= now + CLOSING_SOON_DAYS * DAY_MS;
}

export function HomePage() {
  useScrollToTop();
  const [searchParams] = useSearchParams();
  const listYourMunHref = useListYourMunHref();
  const facetsQuery = useQuery({
    queryKey: queryKeys.marketplaceFacets(),
    queryFn: getMarketplaceFacets,
    // Matches GET /muns/facets's `max-age=300` (server/routes/muns.ts,
    // MARKETPLACE_FACETS_CACHE) — facets churn far less than the listing.
    staleTime: 300_000,
  });
  const facets = facetsQuery.data ?? { cities: [], countries: [] };
  const city = resolveCityParam(searchParams.get("city"), facets.cities, DEFAULT_CITY);
  const statusFilter = resolveStatusFilter(
    searchParams.get("status") ?? undefined,
  );
  const priceBand = resolvePriceBand(searchParams.get("price") ?? undefined);

  const sharedFilters = {
    city: city || undefined,
    minPrice: priceBand?.min,
    maxPrice: priceBand?.max,
    sortBy: "date" as const,
  };

  const wantsOpen = !statusFilter || statusFilter === "REGISTRATION_OPEN";
  const wantsPublished = !statusFilter || statusFilter === "PUBLISHED";
  const wantsClosed = statusFilter === "REGISTRATION_CLOSED";

  const openParams: MunSearchParams = {
    ...sharedFilters,
    status: ["REGISTRATION_OPEN"],
    limit: ROW_LIMIT,
  };
  const publishedParams: MunSearchParams = {
    ...sharedFilters,
    status: ["PUBLISHED"],
    limit: ROW_LIMIT,
  };
  const closedParams: MunSearchParams = {
    ...sharedFilters,
    status: ["REGISTRATION_CLOSED"],
    limit: ROW_LIMIT,
  };

  // All three shelves hit the same public GET /muns endpoint as the
  // marketplace page — matches its `max-age=60` (server/routes/muns.ts,
  // MARKETPLACE_LIST_CACHE).
  const openQuery = useQuery({
    queryKey: queryKeys.muns(openParams),
    queryFn: () => searchMuns(openParams),
    enabled: wantsOpen,
    staleTime: 60_000,
  });
  const publishedQuery = useQuery({
    queryKey: queryKeys.muns(publishedParams),
    queryFn: () => searchMuns(publishedParams),
    enabled: wantsPublished,
    staleTime: 60_000,
  });
  const closedQuery = useQuery({
    queryKey: queryKeys.muns(closedParams),
    queryFn: () => searchMuns(closedParams),
    enabled: wantsClosed,
    staleTime: 60_000,
  });

  const openNow = openQuery.data ?? EMPTY_RESULT;
  const publishedOnly = publishedQuery.data ?? EMPTY_RESULT;
  const closed = closedQuery.data ?? EMPTY_RESULT;
  const isLoadingRows =
    (wantsOpen && openQuery.isLoading) ||
    (wantsPublished && publishedQuery.isLoading) ||
    (wantsClosed && closedQuery.isLoading);

  const [now] = useState(() => Date.now());
  // isClosingSoon guarantees a close date, so the sort never sees null.
  const closingSoon = openNow.results
    .filter((mun) => isClosingSoon(mun, now))
    .sort((a, b) => (closesAt(a)?.getTime() ?? 0) - (closesAt(b)?.getTime() ?? 0));
  const priceParam = priceBand ? searchParams.get("price") : null;
  const shelfFilters = { city, price: priceParam };

  const featured: MunSummary[] = [...openNow.results, ...publishedOnly.results]
    .filter((mun) => mun.startDate === null || mun.startDate.getTime() >= now)
    .slice(0, FEATURED_LIMIT);

  const hasAnyRow =
    openNow.results.length > 0 ||
    publishedOnly.results.length > 0 ||
    closed.results.length > 0;
  const resultCount =
    openNow.results.length +
    publishedOnly.results.length +
    closed.results.length;
  const cityLabel = city ? ` in ${city}` : "";
  const hasRailFilter = Boolean(statusFilter || priceBand);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PageMeta
        title="MUN Hub — Discover and Register for Model United Nations Conferences"
        description={DEFAULT_DESCRIPTION}
        path="/"
      />

      <SiteHeader cities={facets.cities} selectedCity={city} />

      <main className="flex-1">
        {featured.length > 0 && (
          <section className="pt-xl pb-lg sm:pt-xxl sm:pb-xl">
            <div className="content-container">
              <MunAdCarousel slides={featured} />
            </div>
          </section>
        )}

        <section className={featured.length > 0 ? "pb-section" : "pt-xxl pb-section"}>
          <div className="content-container">
            <div className="flex flex-col gap-sm border-b border-border pb-lg sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-xs text-caption tracking-[0.14em] text-muted-foreground uppercase">Curated marketplace</p>
                <h1 className="font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink sm:text-display-lg">
                  Model UN conferences{cityLabel}
                </h1>
                <p className="mt-xs max-w-[60ch] text-body-md leading-5 text-body dark:text-muted-foreground">
                  Compare dates, fees and registration status without chasing scattered posts.
                </p>
              </div>
              <Button variant="outline" size="sm" render={<Link to="/muns" />} className="self-start sm:self-auto">
                Explore all conferences
              </Button>
            </div>

            <div className="flex flex-col gap-lg pt-lg lg:flex-row lg:gap-xxl lg:pt-xl">
              <div className="order-1 min-w-0 flex-1 lg:order-none">
                {isLoadingRows ? (
                  <p className="py-xxl text-center text-body-md text-muted-foreground">
                    Loading conferences…
                  </p>
                ) : hasAnyRow ? (
                  <div className="flex flex-col gap-xxl">
                    <MunRow
                      title="Registration open now"
                      description="Accepting delegates today — soonest conference first."
                      muns={openNow.results}
                      seeAllHref={seeAllHref(shelfFilters, { status: "REGISTRATION_OPEN" })}
                    />
                    <MunRow
                      title="Closing soon"
                      description={`Registration closes within ${CLOSING_SOON_DAYS} days — soonest deadline first.`}
                      muns={closingSoon}
                      seeAllHref={seeAllHref(shelfFilters, { status: "REGISTRATION_OPEN", sortBy: "deadline" })}
                    />
                    <MunRow
                      title="Opening soon"
                      description="Listed and reviewed — registration hasn't opened yet."
                      muns={publishedOnly.results}
                      seeAllHref={seeAllHref(shelfFilters, { status: "PUBLISHED" })}
                    />
                    <MunRow
                      title="Registration closed"
                      description="No longer accepting delegates — listed for reference."
                      muns={closed.results}
                      seeAllHref={seeAllHref(shelfFilters, { status: "REGISTRATION_CLOSED" })}
                    />
                  </div>
                ) : (
                  <SignatureCard
                    variant="cream"
                    padding="lg"
                    className="items-start"
                  >
                    <SignatureCardTitle className="text-title-lg sm:text-title-lg">
                      {hasRailFilter
                        ? "No conferences match these filters"
                        : city
                          ? `No conferences in ${city} yet`
                          : "No conferences are published yet"}
                    </SignatureCardTitle>
                    <SignatureCardDescription className="text-[#333840]">
                      {hasRailFilter
                        ? "Nothing matched this combination of status, fee and city. Clearing the filters brings every reviewed conference back."
                        : city
                          ? "Nothing is listed in this city right now. Browse every city instead — or check back once a local organizer clears review."
                          : "Once organizers clear review, their conferences appear here first."}
                    </SignatureCardDescription>
                    <SignatureCardActions>
                      <Button
                        variant="on-dark"
                        size="sm"
                        render={
                          <Link to={hasRailFilter || city ? `/?city=${ALL_CITIES_PARAM}` : "/muns"} />
                        }
                      >
                        {hasRailFilter || city
                          ? "Clear all filters"
                          : "Browse the marketplace"}
                      </Button>
                    </SignatureCardActions>
                  </SignatureCard>
                )}
              </div>

              <div className="order-none lg:order-1">
                <HomeFilterSidebar resultCount={resultCount} />
              </div>
            </div>
          </div>
        </section>

        {/* Organizer pitch — hidden from signed-in delegates (see useListYourMunHref). */}
        {listYourMunHref ? (
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
                  <Button render={<Link to={listYourMunHref} />}>
                    List your MUN
                  </Button>
                </SignatureCardActions>
              </SignatureCard>
            </div>
          </section>
        ) : null}

        <section className="pb-section">
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
                  <Button variant="on-dark" render={<Link to="/muns" />}>
                    Browse MUNs
                  </Button>
                </SignatureCardActions>
                <p className="mt-lg text-body-md text-on-dark/70 dark:text-foreground/70">
                  Already registered?{" "}
                  <Link
                    to="/login"
                    className="rounded-sm text-on-dark underline underline-offset-4 transition-opacity duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-on-dark focus-visible:ring-offset-4 focus-visible:ring-offset-surface-dark focus-visible:outline-none dark:text-foreground dark:focus-visible:ring-foreground dark:focus-visible:ring-offset-surface-strong"
                  >
                    Sign in
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
