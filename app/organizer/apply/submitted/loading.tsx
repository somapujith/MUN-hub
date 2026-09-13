import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/organizer/apply/submitted/page.tsx geometry — the vertically
 * centered max-w-xl confirmation column: success disc, headline pair, then the
 * two-button row.
 *
 * The page's only await is `getSession()`, which may redirect to /login. The
 * skeleton renders through that check rather than leaving a blank frame on the
 * way out of a form submission — the worst possible moment to show nothing.
 */
export default function ApplicationSubmittedLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center">
        <div className="content-container">
          <div className="mx-auto flex max-w-xl flex-col items-start gap-lg py-xxl lg:py-section">
            {/* size-12 success disc */}
            <Skeleton className="size-12 rounded-full" />

            <div className="flex w-full flex-col gap-sm">
              <Skeleton className="h-9 w-[min(100%,20rem)] rounded-sm" />
              <div className="flex flex-col gap-xs">
                <Skeleton className="h-5 w-full rounded-sm" />
                <Skeleton className="h-5 w-full rounded-sm" />
                <Skeleton className="h-5 w-3/5 rounded-sm" />
              </div>
            </div>

            {/* Primary + outline pair, stacking below `sm` exactly as the
                real button row does. */}
            <div className="flex w-full flex-col gap-sm sm:w-auto sm:flex-row">
              <Skeleton className="h-12 w-full rounded-lg sm:w-[180px]" />
              <Skeleton className="h-12 w-full rounded-lg sm:w-[188px]" />
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
