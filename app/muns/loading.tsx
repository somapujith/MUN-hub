import { MunCardGridSkeleton } from "@/components/mun/mun-card-grid";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/muns/page.tsx geometry exactly — same page head band, same
 * 240px rail column, same results header rule — so the hand-off from skeleton
 * to rendered page produces no layout shift.
 */
export default function MunsLoading() {
  return (
    <div className="flex-1">
      <div className="border-b border-border">
        <div className="content-container flex flex-col gap-lg pt-xxl pb-xl">
          <div className="flex flex-col gap-sm">
            <Skeleton className="h-3.5 w-24 rounded-sm" />
            <Skeleton className="h-10 w-[min(100%,22rem)] rounded-sm" />
            <Skeleton className="h-3.5 w-[min(100%,32rem)] rounded-sm" />
          </div>
          <div className="flex max-w-2xl items-center gap-xs">
            <Skeleton className="h-11 flex-1 rounded-sm" />
            <Skeleton className="h-11 w-[92px] rounded-sm" />
          </div>
        </div>
      </div>

      <div className="content-container flex flex-col gap-lg pt-xl pb-section lg:flex-row lg:gap-xxl">
        {/* Rail */}
        <div className="hidden w-[240px] shrink-0 flex-col gap-lg border-r border-border pr-xl lg:flex">
          {[0, 1, 2].map((group) => (
            <div key={group} className="flex flex-col gap-xs">
              <Skeleton className="h-3 w-20 rounded-sm" />
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-7 w-full rounded-sm" />
              ))}
            </div>
          ))}
        </div>

        {/* Mobile filter trigger */}
        <Skeleton className="h-9 w-28 rounded-lg lg:hidden" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between border-b border-border pb-sm">
            <Skeleton className="h-5 w-44 rounded-sm" />
          </div>
          <div className="pt-lg">
            <MunCardGridSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
