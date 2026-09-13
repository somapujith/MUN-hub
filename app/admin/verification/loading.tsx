import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/admin/verification/page.tsx geometry — the same
 * `bg-surface-soft/60` console band, header rule, and dense module rows as its
 * sibling app/admin/review/loading.tsx, with two deliberate differences that
 * match the real page:
 *
 *   - one counter ("Pending"), not three — this console tracks a single total
 *   - a "Application review queue" link button under the description
 *
 * Rows are single-line (name + module badge + confirmed date, with three
 * decision buttons at the trailing edge), which is a shorter shell than the
 * review queue's multi-line application cards.
 *
 * The page awaits `getSession()`, redirects on a non-operations role, then
 * awaits `getModuleReviewQueue()` — both gates run before any markup, so this
 * is the only thing on screen during a cold load.
 */

/** PAGE_SIZE is 20, but a fuller queue is rare; 6 fills the fold honestly. */
const ROW_COUNT = 6;

export default function AdminVerificationLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <div className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <div className="flex flex-wrap items-end justify-between gap-md border-b border-border pb-lg">
            <div className="flex flex-col gap-xxs">
              <Skeleton className="h-3 w-24 rounded-sm" />
              <Skeleton className="h-8 w-64 rounded-sm" />
              <Skeleton className="h-3.5 w-[min(100%,36rem)] rounded-sm" />
              <Skeleton className="mt-xxs h-4 w-48 rounded-sm" />
            </div>

            {/* Single "Pending" counter. */}
            <div className="flex flex-col gap-0.5">
              <Skeleton className="h-3 w-14 rounded-sm" />
              <Skeleton className="h-7 w-8 rounded-sm" />
            </div>
          </div>

          <div className="flex flex-col gap-sm">
            {Array.from({ length: ROW_COUNT }, (_, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-md rounded-md border border-border bg-card p-md"
              >
                <div className="flex min-w-0 flex-col gap-xxs">
                  <div className="flex items-center gap-sm">
                    <Skeleton className="h-5 w-52 rounded-sm" />
                    <Skeleton className="h-5 w-28 rounded-sm" />
                  </div>
                  <Skeleton className="h-3.5 w-40 rounded-sm" />
                </div>

                {/* The three <ModuleReviewDialog> triggers: verify, request
                    changes, reject. */}
                <div className="flex shrink-0 flex-wrap items-center gap-sm">
                  <Skeleton className="h-9 w-20 rounded-sm" />
                  <Skeleton className="h-9 w-36 rounded-sm" />
                  <Skeleton className="h-9 w-20 rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
