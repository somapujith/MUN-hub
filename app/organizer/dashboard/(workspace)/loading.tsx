import { Skeleton } from "@/components/ui/skeleton";
import {
  StatCardsSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Overview (`/organizer/dashboard`) — mirrors `./page.tsx`'s populated branch:
 * four headline stats, the capacity bar, then the two-column
 * Recent registrations / Upcoming conferences split.
 *
 * The page has three possible bodies (no-conferences, application-under-review,
 * and the dashboard proper) and a skeleton can only bet on one. It bets on the
 * populated case: that branch is the only one that awaits
 * `getWorkspaceAlerts` over every mun, and the two zero-state branches return
 * almost immediately, so they barely render this at all.
 *
 * The capacity bar is included even though it is conditional on
 * `utilisationLabel !== null` — it sits between two blocks that are always
 * present, so omitting it would shift the lower half of the page on hand-off
 * for every organizer who has configured a registration product.
 */
export default function OrganizerOverviewLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="10rem" actions={1}>
      <StatCardsSkeleton />

      {/* Capacity utilisation bar. */}
      <div className="flex flex-col gap-xs rounded-md border border-border bg-card p-md">
        <div className="flex items-baseline justify-between gap-sm">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-2 w-full rounded-pill" />
        <div className="flex flex-wrap items-center gap-md">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>

      {/* Recent registrations | Upcoming conferences. */}
      <div className="grid gap-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {[3, 3].map((rows, panel) => (
          <section
            key={panel}
            className="flex flex-col gap-xs rounded-md border border-border bg-card p-md"
          >
            <div className="flex items-center gap-xs">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex flex-col">
              {Array.from({ length: rows }, (_, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-sm border-b border-border py-xs last:border-b-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col gap-xxs">
                    <Skeleton className="h-4 w-[min(100%,12rem)]" />
                    {panel === 1 && <Skeleton className="h-3.5 w-[min(100%,16rem)]" />}
                  </div>
                  <Skeleton className="h-5 w-12 shrink-0" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </WorkspacePageSkeleton>
  );
}
