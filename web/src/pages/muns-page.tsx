import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunCardGrid, MunCardGridSkeleton } from "@/components/mun/mun-card-grid";
import { SearchBar } from "@/components/marketplace/search-bar";
import { FilterSidebar } from "@/components/marketplace/filter-sidebar";
import { PageMeta } from "@/components/seo/page-meta";
import { Button } from "@/components/ui/button";
import { getMarketplaceFacets, searchMuns } from "@/api/marketplace";
import { queryKeys } from "@/api/query-keys";
import { FILTER_PARAM_KEYS, resolveMarketplaceSearch } from "@/lib/marketplace-filters";

const PAGE_SIZE = 24;

function pageHref(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams);
  next.delete("page");
  if (page > 1) next.set("page", String(page));
  const qs = next.toString();
  return qs ? `/muns?${qs}` : "/muns";
}

export function MunsPage() {
  const [searchParams] = useSearchParams();

  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const searchQueryParams = resolveMarketplaceSearch(searchParams, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const munsQuery = useQuery({
    queryKey: queryKeys.muns(searchQueryParams),
    queryFn: () => searchMuns(searchQueryParams),
    placeholderData: (previous) => previous,
  });
  const facetsQuery = useQuery({
    queryKey: queryKeys.marketplaceFacets(),
    queryFn: getMarketplaceFacets,
  });

  const results = munsQuery.data?.results ?? [];
  const total = munsQuery.data?.total ?? 0;
  const facets = facetsQuery.data ?? { cities: [], countries: [] };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const city = searchParams.get("city") ?? "";
  const country = searchParams.get("country") ?? "";
  const query = searchQueryParams.query;
  const locationLabel = [city, country].filter(Boolean).join(", ");
  const hasFilters = FILTER_PARAM_KEYS.some((key) => key !== "sortBy" && searchParams.get(key));

  const preserved = Object.fromEntries(FILTER_PARAM_KEYS.map((key) => [key, searchParams.get(key) ?? undefined]));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <PageMeta
        title={
          locationLabel ? `Model UN conferences in ${locationLabel} | MUN Hub` : "Browse MUNs | MUN Hub"
        }
        description="Search and filter reviewed Model United Nations conferences by city, country, dates, registration status and delegate fee."
        path="/muns"
      />

      <SiteHeader cities={facets.cities} selectedCity={city} />

      <main className="flex-1">
        <div className="border-b border-border">
          <div className="content-container flex flex-col gap-lg pt-xxl pb-xl">
            <div className="flex flex-col gap-sm">
              <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
                Marketplace
              </p>
              <h1 className="max-w-[20ch] font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink sm:text-display-lg">
                Find your next Model UN
              </h1>
              <p className="max-w-[60ch] text-body-md text-body dark:text-muted-foreground">
                Every conference below is reviewed before it goes live. Compare
                committees, dates, and registration fees in one place.
              </p>
            </div>

            <div className="max-w-2xl">
              <SearchBar defaultValue={query} preserve={preserved} />
            </div>
          </div>
        </div>

        <div className="content-container flex flex-col gap-lg pt-xl pb-section lg:flex-row lg:gap-xxl">
          <FilterSidebar countries={facets.countries} resultCount={total} />

          <section aria-label="Search results" aria-busy={munsQuery.isFetching} className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-xs border-b border-border pb-sm">
              <h2
                aria-live="polite"
                className="font-display text-title-sm font-medium tracking-[-0.006em] text-ink"
              >
                {munsQuery.isLoading
                  ? "Searching…"
                  : total === 0
                    ? "No conferences"
                    : `${total} ${total === 1 ? "conference" : "conferences"}`}
                {locationLabel && (
                  <span className="font-normal text-muted-foreground"> in {locationLabel}</span>
                )}
                {query && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    matching &ldquo;{query}&rdquo;
                  </span>
                )}
              </h2>
              {total > PAGE_SIZE && (
                <p className="text-body-md tabular-nums text-muted-foreground">
                  Showing {rangeStart}–{rangeEnd}
                </p>
              )}
            </div>

            <div className="pt-lg">
              {munsQuery.isLoading ? (
                <MunCardGridSkeleton />
              ) : munsQuery.isError ? (
                <div className="flex flex-col items-start gap-sm">
                  <p className="text-body-md text-destructive-text">
                    {munsQuery.error instanceof Error
                      ? munsQuery.error.message
                      : "Unable to load conferences right now."}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void munsQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : (
                <MunCardGrid
                  muns={results}
                  className={munsQuery.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}
                  emptyMessage={
                    query
                      ? `Nothing matched "${query}". Try a shorter phrase, or clear some filters.`
                      : hasFilters
                        ? "Nothing matches this combination of filters. Widen the dates or fee band, or clear a filter."
                        : undefined
                  }
                />
              )}
            </div>

            {totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-xxl flex items-center justify-between gap-md border-t border-border pt-lg"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  render={page > 1 ? <Link to={pageHref(searchParams, page - 1)} /> : undefined}
                >
                  <ChevronLeftIcon aria-hidden />
                  Previous
                </Button>

                <p className="text-body-md tabular-nums text-muted-foreground">
                  Page {page} of {totalPages}
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  render={
                    page < totalPages ? <Link to={pageHref(searchParams, page + 1)} /> : undefined
                  }
                >
                  Next
                  <ChevronRightIcon aria-hidden />
                </Button>
              </nav>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
