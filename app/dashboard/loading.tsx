import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

/**
 * Mirrors app/dashboard/page.tsx geometry — same header band, same separator,
 * same card stack rhythm — so the skeleton-to-content hand-off produces no
 * layout shift.
 */
export default function DashboardLoading() {
  return (
    <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
      <div className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-xs">
          <Skeleton className="h-9 w-[min(100%,16rem)] rounded-sm" />
          <Skeleton className="h-3.5 w-[min(100%,24rem)] rounded-sm" />
        </div>
        <Skeleton className="h-12 w-[140px] rounded-lg" />
      </div>

      <Separator />

      <div className="flex flex-col gap-md">
        <Skeleton className="h-6 w-32 rounded-sm" />
        <div className="flex flex-col gap-sm">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[118px] w-full rounded-md" />
          ))}
        </div>
      </div>
    </main>
  );
}
