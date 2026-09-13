import { Skeleton } from "@/components/ui/skeleton";
import {
  StatStripSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx` + `./accommodation-table.tsx`.
 *
 * Accommodation is a card list, not a `<table>`, at every breakpoint — each
 * option owns a nested per-option question list that cannot live inside a
 * table row without colspan gymnastics (see the note atop
 * `accommodation-table.tsx`). So this uses standalone bordered cards rather
 * than `DashboardTableSkeleton`, which would promise a row grid that never
 * arrives.
 */
export default function AccommodationLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="16rem" actions={1}>
      <div className="flex flex-col gap-lg">
        <StatStripSkeleton />

        <div className="flex flex-col gap-sm">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex flex-wrap items-start gap-sm rounded-md border border-border bg-card p-md sm:flex-nowrap"
            >
              <Skeleton className="size-5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-xs">
                <div className="flex flex-wrap items-center gap-xs">
                  <Skeleton className="h-5 w-[min(100%,13rem)]" />
                  <Skeleton className="h-5 w-16 rounded-pill" />
                </div>
                <Skeleton className="h-3.5 w-[min(100%,28rem)]" />
                <div className="flex flex-wrap items-center gap-x-lg gap-y-xs">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-xs">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspacePageSkeleton>
  );
}
