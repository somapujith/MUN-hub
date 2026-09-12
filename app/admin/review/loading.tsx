import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/admin/review/page.tsx geometry — same chrome, same header rule,
 * same 3-up counter cluster, same dense card rows — so there is no layout
 * shift when the queue resolves. The page fans out one getMunForReview per
 * queued mun, so this is visible on a cold load, not theoretical.
 */
export default function AdminReviewLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <div className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <div className="flex flex-wrap items-end justify-between gap-md border-b border-border pb-lg">
            <div className="flex flex-col gap-xxs">
              <Skeleton className="h-3 w-20 rounded-sm" />
              <Skeleton className="h-8 w-64 rounded-sm" />
              <Skeleton className="h-3.5 w-[min(100%,30rem)] rounded-sm" />
            </div>
            <div className="flex items-center gap-lg">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-1">
                  <Skeleton className="h-3 w-14 rounded-sm" />
                  <Skeleton className="h-6 w-8 rounded-sm" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-sm">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="flex flex-col gap-sm rounded-md border border-border bg-card p-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-sm">
                  <div className="flex flex-col gap-xs">
                    <div className="flex items-center gap-xs">
                      <Skeleton className="h-5 w-52 rounded-sm" />
                      <Skeleton className="h-5 w-24 rounded-sm" />
                    </div>
                    <Skeleton className="h-3 w-32 rounded-sm" />
                  </div>
                  <div className="flex items-center gap-xs">
                    <Skeleton className="h-9 w-24 rounded-sm" />
                    <Skeleton className="h-9 w-32 rounded-sm" />
                    <Skeleton className="h-9 w-20 rounded-sm" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-lg">
                  <Skeleton className="h-3.5 w-40 rounded-sm" />
                  <Skeleton className="h-3.5 w-36 rounded-sm" />
                  <Skeleton className="h-3.5 w-28 rounded-sm" />
                  <Skeleton className="h-3.5 w-32 rounded-sm" />
                </div>
                <Skeleton className="h-5 w-40 rounded-sm" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
