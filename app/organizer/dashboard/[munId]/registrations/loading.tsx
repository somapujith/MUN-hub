import { Skeleton } from "@/components/ui/skeleton";
import {
  DashboardTableSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx`: section header, the server-side filter rail, the
 * result-count heading, then the delegate roster.
 *
 * This skeleton earns its keep on *navigation*, not just first load. Every
 * filter chip in `registration-filter-bar.tsx` is a `<Link>` that rewrites
 * search params and re-runs `getDelegateList` on the server — so each filter
 * click re-suspends this segment. Without a `loading.tsx` the roster would sit
 * frozen on the previous result set with no feedback that anything happened.
 *
 * Row count is `PAGE_SIZE`-aware in spirit but capped at 8: a full 20-row
 * skeleton is a wall of grey, and the rows below the fold aren't doing any
 * communicative work.
 */
export default function RegistrationsLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="16rem">
      {/* Filter rail — two labelled chip rows plus the clear-filters footer. */}
      <div className="flex flex-col gap-sm rounded-md border border-border bg-surface-soft px-md py-sm dark:bg-card">
        {[0, 1].map((row) => (
          <div key={row} className="flex flex-wrap items-center gap-xs">
            <Skeleton className="h-3 w-[84px] shrink-0" />
            {Array.from({ length: row === 0 ? 4 : 5 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-sm" />
            ))}
          </div>
        ))}
      </div>

      <Skeleton className="h-5 w-48" />

      <DashboardTableSkeleton rows={8} columns={5} />
    </WorkspacePageSkeleton>
  );
}
