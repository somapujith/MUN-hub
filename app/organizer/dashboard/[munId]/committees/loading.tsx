import { Skeleton } from "@/components/ui/skeleton";
import {
  StatStripSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx` + `./committee-board.tsx`: the two-line section header,
 * the hairline stat strip, then a stack of committee cards.
 *
 * This route is the slowest per-MUN section on a cold load and the most worth
 * a skeleton: `page.tsx` fans out one `listPortfolios` per committee
 * (`Promise.all` over `listCommittees`), so time-to-first-byte scales with
 * conference size rather than being constant.
 *
 * Three cards, not six — a conference typically has a handful of committees,
 * and an over-long skeleton that collapses to two rows is its own layout
 * shift. Under-promising is the safer direction.
 */
export default function CommitteesLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="20rem">
      <div className="flex flex-col gap-lg">
        <StatStripSkeleton />

        <div className="flex flex-wrap items-center justify-between gap-sm">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-8 w-40 rounded-lg" />
        </div>

        <div className="flex flex-col gap-sm">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-md border border-border bg-card"
            >
              {/* Committee row: chevron, name + badges, action cluster. */}
              <div className="flex flex-wrap items-start gap-sm p-md sm:flex-nowrap sm:items-center">
                <Skeleton className="mt-0.5 size-5 shrink-0 sm:mt-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-xxs">
                  <div className="flex flex-wrap items-center gap-xs">
                    <Skeleton className="h-5 w-[min(100%,14rem)]" />
                    <Skeleton className="h-5 w-16 rounded-pill" />
                  </div>
                  <Skeleton className="h-3.5 w-[min(100%,24rem)]" />
                </div>
                <div className="flex shrink-0 items-center gap-xxs">
                  <Skeleton className="h-8 w-20 rounded-lg" />
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              </div>

              {/* Seat-fill bar under the first card only — matches the board,
                  where later cards are collapsed until opened. */}
              {i === 0 && (
                <div className="flex flex-col gap-xxs border-t border-border px-md py-md">
                  <div className="flex items-baseline justify-between gap-xs">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-pill" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </WorkspacePageSkeleton>
  );
}
