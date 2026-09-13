import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";

/**
 * Mirrors app/mun/[slug]/page.tsx band structure — hero, about + committees,
 * cream organizer callout, then the tinted pricing band — so a click from a
 * card into a listing lands on the right shape immediately.
 *
 * The page awaits `getMunBySlug(slug)` and then fans out one
 * `getProductAvailability` per registration product, so a cold listing load
 * is a genuinely multi-round-trip request, not a single fast read.
 *
 * Counts are chosen as honest medians of what a listing actually carries:
 * committees render 2-up from `md` (4 tiles = two full rows), and three passes
 * matches the `lg:grid-cols-3` track the pricing grid opens up at.
 */

const COMMITTEE_COUNT = 4;
const PASS_COUNT = 3;

function CommitteeCardSkeleton() {
  return (
    <li className="flex flex-col items-start rounded-md border border-border bg-card p-lg">
      <div className="flex w-full items-start justify-between gap-sm">
        <Skeleton className="h-5 w-3/5 rounded-sm" />
        <Skeleton className="h-5 w-10 shrink-0 rounded-sm" />
      </div>
      {/* Agenda + level lines */}
      <Skeleton className="mt-sm h-3.5 w-full rounded-sm" />
      <Skeleton className="mt-xxs h-3.5 w-4/5 rounded-sm" />
      {/* Portfolio strip below the rule */}
      <div className="mt-md w-full border-t border-border pt-md">
        <Skeleton className="h-3 w-28 rounded-sm" />
        <div className="mt-xs flex flex-wrap gap-xxs">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-5 w-20 rounded-pill" />
          ))}
        </div>
      </div>
    </li>
  );
}

/** `pricing-tier-card` shell: name, price block, feature list, CTA at bottom. */
function PassCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-card p-xl">
      <Skeleton className="h-6 w-32 rounded-sm" />

      <div className="mt-md flex items-baseline gap-xs">
        <Skeleton className="h-11 w-36 rounded-sm" />
        <Skeleton className="h-3.5 w-20 rounded-sm" />
      </div>

      <div className="mt-lg flex flex-col gap-xs">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-xs">
            <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3.5 flex-1 rounded-sm" />
          </div>
        ))}
      </div>

      {/* Seats-remaining meter */}
      <div className="mt-lg">
        <Skeleton className="h-1 w-full rounded-pill" />
        <Skeleton className="mt-xs h-3 w-28 rounded-sm" />
      </div>

      <div className="mt-auto pt-xl">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function MunDetailLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        {/* ---- Band 1 — hero ---------------------------------------------- */}
        <section className="border-b border-border bg-background">
          <div className="content-container pt-xxl pb-xl md:pt-section md:pb-xxl">
            <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-xxl">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-sm">
                  <Skeleton className="h-5 w-32 rounded-pill" />
                  <Skeleton className="h-3.5 w-20 rounded-sm" />
                </div>

                <Skeleton className="mt-md h-9 w-[min(100%,32rem)] rounded-sm md:h-12" />
                <Skeleton className="mt-sm h-5 w-[min(100%,24rem)] rounded-sm" />

                {/* Meta line: dates, location, committee count. */}
                <div className="mt-lg flex flex-wrap items-center gap-x-lg gap-y-xs">
                  {["w-40", "w-52", "w-28"].map((width, i) => (
                    <div key={i} className="flex items-center gap-xs">
                      <Skeleton className="size-4 shrink-0 rounded-sm" />
                      <Skeleton className={cn("h-3.5 rounded-sm", width)} />
                    </div>
                  ))}
                </div>

                <Skeleton className="mt-xs h-3.5 w-52 rounded-sm" />
              </div>

              {/* Action cluster: "from" price above the CTA pair. */}
              <div className="flex flex-col gap-sm lg:items-end">
                <Skeleton className="h-3.5 w-44 rounded-sm" />
                <div className="flex flex-wrap items-center gap-sm">
                  <Skeleton className="h-12 w-[148px] rounded-lg" />
                  <Skeleton className="h-12 w-[136px] rounded-lg" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Band 2 — about + committees -------------------------------- */}
        <section className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
          <div className="max-w-3xl">
            <Skeleton className="h-8 w-64 rounded-sm md:h-9" />
            <div className="mt-md flex flex-col gap-xs">
              <Skeleton className="h-5 w-full rounded-sm" />
              <Skeleton className="h-5 w-full rounded-sm" />
              <Skeleton className="h-5 w-3/4 rounded-sm" />
            </div>
          </div>

          <div className="mt-xxl">
            <div className="flex flex-wrap items-baseline justify-between gap-sm">
              <Skeleton className="h-8 w-44 rounded-sm md:h-9" />
              <Skeleton className="h-3.5 w-56 rounded-sm" />
            </div>

            <ul className="mt-lg grid list-none grid-cols-1 gap-lg p-0 md:grid-cols-2">
              {Array.from({ length: COMMITTEE_COUNT }, (_, i) => (
                <CommitteeCardSkeleton key={i} />
              ))}
            </ul>
          </div>
        </section>

        {/* ---- Band 3 — cream organizer callout --------------------------- */}
        <section className="content-container pb-xxl md:pb-section">
          <Skeleton className="h-[264px] w-full rounded-md lg:h-[224px]" />
        </section>

        {/* ---- Band 4 — pricing sub-system band --------------------------- */}
        <section className="bg-surface-soft">
          <div className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
            <div className="max-w-3xl">
              <Skeleton className="h-8 w-56 rounded-sm" />
              <Skeleton className="mt-sm h-3.5 w-[min(100%,34rem)] rounded-sm" />
            </div>

            <div className="mt-xl grid grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: PASS_COUNT }, (_, i) => (
                <PassCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
