import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePageSkeleton } from "@/components/organizer/workspace-skeletons";

/**
 * My MUNs — mirrors `./page.tsx` + `components/organizer/organizer-mun-card.tsx`:
 * header with the "Apply to host a MUN" action, the conference count line, then
 * the responsive card grid (1 / 2 / 3 up).
 *
 * Cards are `flex` inside `<li className="flex">` so they stretch to a common
 * row height; the skeleton fixes them at `h-[15.5rem]` instead, which is the
 * card's natural height with a date range, a two-stat `<dl>` and the action
 * row. Six cards fills two rows at `xl` without over-promising for an
 * organizer who runs one conference — the grid simply renders fewer.
 */
export default function MyMunsLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="10rem" actions={1}>
      <Skeleton className="h-4 w-32" />

      <div className="grid gap-sm md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-md rounded-md border border-border bg-card p-md"
          >
            <div className="flex flex-col gap-xs">
              <div className="flex flex-wrap items-start justify-between gap-xs">
                <Skeleton className="h-5 w-[min(100%,11rem)]" />
                <Skeleton className="h-5 w-16 shrink-0 rounded-pill" />
              </div>
              <Skeleton className="h-3.5 w-[min(100%,13rem)]" />
              <Skeleton className="h-3.5 w-[min(100%,9rem)]" />
            </div>

            <div className="flex flex-wrap gap-x-lg gap-y-xs">
              {[0, 1].map((stat) => (
                <div key={stat} className="flex min-w-0 flex-col gap-xxs">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-xs">
              <Skeleton className="h-8 w-28 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </WorkspacePageSkeleton>
  );
}
