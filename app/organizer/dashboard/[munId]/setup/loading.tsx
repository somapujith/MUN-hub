import { Skeleton } from "@/components/ui/skeleton";
import {
  DashboardFormSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx`: the final-confirmation panel, then the seven-tab strip
 * whose first panel (General) is a real form against `updateMunDetails`.
 *
 * Two sequential awaits run before this page can render — `getMunSetup` then
 * `getConfirmationSummary` — so the wait is real, not theoretical. Setup is
 * also the landing section: `[munId]/page.tsx` redirects here, which makes
 * this the first thing an organizer sees on entering a conference.
 *
 * Seven tab stubs because `setup-tabs.tsx` renders seven regardless of data
 * (two real panels, five honest placeholders) — a count that is safe to
 * hard-code precisely because it isn't data-driven.
 */
export default function SetupLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="12rem">
      {/* Final-confirmation panel — status banner with a primary action. */}
      <div className="flex flex-wrap items-center justify-between gap-md rounded-md border border-border bg-surface-soft p-md dark:bg-card">
        <div className="flex min-w-0 flex-col gap-xxs">
          <Skeleton className="h-5 w-[min(100%,18rem)]" />
          <Skeleton className="h-3.5 w-[min(100%,30rem)]" />
        </div>
        <Skeleton className="h-10 w-40 shrink-0 rounded-lg" />
      </div>

      <DashboardFormSkeleton tabs={7} fields={4} textarea />
    </WorkspacePageSkeleton>
  );
}
