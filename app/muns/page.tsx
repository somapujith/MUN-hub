import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunCardGrid } from "@/components/mun/mun-card-grid";
import { SearchBar } from "@/components/marketplace/search-bar";
import { FilterSidebar } from "@/components/marketplace/filter-sidebar";
import { Button } from "@/components/ui/button";
import {
  searchMuns,
  getMarketplaceFacets,
  type MunSearchParams,
} from "@/lib/actions/marketplace";

/**
 * Marketplace search surface — the Airtable editorial system applied to a
 * product page rather than a marketing page.
 *
 * White canvas throughout, ink type, `topic-filter-rail` on the left at 240px,
 * `text-input` search on top, `demo-grid-card` results. The alternating
 * signature-card rhythm from DESIGN-airtable.md is a long-scroll editorial
 * device and is deliberately NOT applied here; the one brand-voltage moment is
 * the cream empty state inside <MunCardGrid>.
 */

export const metadata: Metadata = {
  title: "Browse MUNs",
  description:
    "Search and filter Model United Nations conferences by city, country, date, and registration fee.",
};

const PAGE_SIZE = 24;

interface MunsPageProps {
  searchParams: Promise<{
    q?: string;
    city?: string;
    country?: string;
    sortBy?: string;
    page?: string;
  }>;
}

/** Builds a /muns href preserving current filters, overriding `page`. */
function pageHref(
  params: Record<string, string | undefined>,
  page: number,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") next.set(key, value);
  }
  if (page > 1) next.set("page", String(page));
  const qs = next.toString();
  return qs ? `/muns?${qs}` : "/muns";
}

export default async function MunsPage({ searchParams }: MunsPageProps) {
  const params = await searchParams;

  const parsedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const searchArgs: MunSearchParams = {
    query: params.q || undefined,
    city: params.city || undefined,
    country: params.country || undefined,
    sortBy:
      params.sortBy === "price" || params.sortBy === "newest" || params.sortBy === "date"
        ? params.sortBy
        : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [{ results, total }, facets] = await Promise.all([
    searchMuns(searchArgs),
    getMarketplaceFacets(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const locationLabel = [params.city, params.country].filter(Boolean).join(", ");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        {/* Editorial page head — calm whitespace, no gradient, no hero card. */}
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
              <SearchBar
                defaultValue={params.q}
                preserve={{
                  city: params.city,
                  country: params.country,
                  sortBy: params.sortBy,
                }}
              />
            </div>
          </div>
        </div>

        {/* Rail + results */}
        <div className="content-container flex flex-col gap-lg pt-xl pb-section lg:flex-row lg:gap-xxl">
          <FilterSidebar
            cities={facets.cities}
            countries={facets.countries}
            resultCount={total}
          />

          <section aria-label="Search results" className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-xs border-b border-border pb-sm">
              <h2 className="font-display text-title-sm font-medium tracking-[-0.006em] text-ink">
                {total === 0
                  ? "No conferences"
                  : `${total} ${total === 1 ? "conference" : "conferences"}`}
                {locationLabel && (
                  <span className="font-normal text-muted-foreground"> in {locationLabel}</span>
                )}
                {params.q && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    matching &ldquo;{params.q}&rdquo;
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
              <MunCardGrid
                muns={results}
                emptyMessage={
                  params.q
                    ? `Nothing matched “${params.q}”. Try a shorter phrase, or clear your location filters.`
                    : undefined
                }
              />
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
                  render={page > 1 ? <Link href={pageHref(params, page - 1)} /> : undefined}
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
                    page < totalPages ? <Link href={pageHref(params, page + 1)} /> : undefined
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
