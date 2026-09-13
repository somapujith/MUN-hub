import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/page.tsx geometry — carousel band, page head rule, then the
 * shelves-plus-rail split — so the swap from skeleton to shelves produces no
 * layout shift.
 *
 * The homepage awaits `getMarketplaceFacets()` and then a Promise.all of up to
 * three `searchMuns` calls plus `getSession()`, so this is a real cold-load
 * state rather than a theoretical one.
 *
 * Row count is deliberate: the unfiltered homepage renders four <MunRow>s
 * ("Registration open now", "Closing soon", "Opening soon", "Registration
 * closed"), but the last two are frequently empty and <MunRow> renders null
 * when its list is empty. Three shelves is the honest median — promising four
 * and delivering two reads worse than the reverse.
 */

/** Fixed card width from <MunRow>'s scroller: w-[280px] sm:w-[320px]. */
const ROW_CARD_CLASSNAME = "w-[280px] shrink-0 sm:w-[320px]";

/** Enough cards to overflow the row, matching the real shelf's scroll feel. */
const CARDS_PER_ROW = 4;

function RowSkeleton() {
  return (
    <div className="flex flex-col gap-md">
      {/* Title block + "See all" / arrow cluster, stacked below `sm`. */}
      <div className="flex flex-col gap-xs sm:flex-row sm:items-end sm:justify-between sm:gap-md">
        <div className="flex min-w-0 flex-col gap-xxs">
          <Skeleton className="h-7 w-[min(100%,15rem)] rounded-sm" />
          <Skeleton className="h-3.5 w-[min(100%,26rem)] rounded-sm" />
        </div>
        <div className="flex shrink-0 items-center gap-sm">
          <Skeleton className="h-4 w-14 rounded-sm" />
          <div className="hidden items-center gap-xxs md:flex">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Scroller. `overflow-hidden` rather than `overflow-x-auto`: a skeleton
          must never hand the user a scrollbar for content that isn't there. */}
      <div className="flex gap-lg overflow-hidden pb-xs">
        {Array.from({ length: CARDS_PER_ROW }, (_, i) => (
          <div key={i} className={ROW_CARD_CLASSNAME}>
            <MunCardShell />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Local copy of <MunCardSkeleton>'s geometry rather than an import: the shared
 * one is `h-full` for grid use, and inside a fixed-width row track that
 * collapses to nothing without a grid parent to stretch against.
 */
function MunCardShell() {
  return (
    <div
      aria-hidden
      className="flex flex-col gap-sm rounded-md border border-border bg-card p-md"
    >
      <Skeleton className="h-5 w-3/5 rounded-sm" />
      <div className="flex flex-col gap-xxs pt-xxs">
        <Skeleton className="h-3.5 w-2/5 rounded-sm" />
        <Skeleton className="h-3.5 w-1/2 rounded-sm" />
      </div>
      <div className="pt-xs">
        <Skeleton className="h-5 w-28 rounded-pill" />
      </div>
      <div className="-mx-md mt-sm flex items-center justify-between gap-sm border-t border-border px-md pt-sm">
        <Skeleton className="h-3.5 w-24 rounded-sm" />
        <Skeleton className="h-4 w-14 rounded-sm" />
      </div>
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* No `cities` prop — the facets that feed the nav picker are exactly
          what this page is still waiting on, so the picker stays absent
          rather than rendering an empty select. */}
      <SiteHeader />

      <main className="flex-1">
        {/* ---- 1. carousel ------------------------------------------------
            Matches <MunAdCarousel>'s slide height (min-h-320/360) plus its
            dot row, so the promo band doesn't jump when slides arrive. */}
        <section className="pt-xl pb-xxl">
          <div className="content-container">
            <Skeleton className="h-[320px] w-full rounded-lg sm:h-[360px]" />
            <div className="mt-md flex items-center justify-between gap-md">
              <div className="flex items-center gap-xs">
                <Skeleton className="h-2 w-6 rounded-pill" />
                <Skeleton className="h-2 w-2 rounded-pill" />
                <Skeleton className="h-2 w-2 rounded-pill" />
              </div>
              <div className="flex items-center gap-xs">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="size-8 rounded-lg" />
              </div>
            </div>
          </div>
        </section>

        {/* ---- 2. shelves + filter rail ----------------------------------- */}
        <section className="pb-section">
          <div className="content-container">
            <div className="flex flex-col gap-sm border-b border-border pb-lg">
              <Skeleton className="h-9 w-[min(100%,24rem)] rounded-sm" />
              <Skeleton className="h-3.5 w-[min(100%,34rem)] rounded-sm" />
            </div>

            <div className="flex flex-col gap-lg pt-lg lg:flex-row lg:gap-xxl lg:pt-xl">
              <div className="order-1 flex min-w-0 flex-1 flex-col gap-xxl lg:order-none">
                {[0, 1, 2].map((i) => (
                  <RowSkeleton key={i} />
                ))}
              </div>

              {/* Rail: a sheet trigger below `lg`, a 240px column from `lg`,
                  matching <HomeFilterSidebar>'s two forms exactly. */}
              <div className="order-none lg:order-1">
                <Skeleton className="h-9 w-28 rounded-lg lg:hidden" />
                <div className="hidden w-[240px] shrink-0 flex-col gap-lg border-l border-border pl-xl lg:flex">
                  {[0, 1].map((group) => (
                    <div key={group} className="flex flex-col gap-xs">
                      <Skeleton className="mx-xs h-3 w-20 rounded-sm" />
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="h-7 w-full rounded-sm" />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- 3. cream callout ------------------------------------------- */}
        <section className="pb-section">
          <div className="content-container">
            <Skeleton className="h-[248px] w-full rounded-md lg:h-[208px]" />
          </div>
        </section>

        {/* ---- 4. dark closing CTA ---------------------------------------- */}
        <section>
          <div className="content-container">
            <Skeleton className="h-[320px] w-full rounded-lg" />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
