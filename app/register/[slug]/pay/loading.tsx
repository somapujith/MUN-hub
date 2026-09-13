import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/register/[slug]/pay/page.tsx geometry — the centered max-w-2xl
 * checkout column: header, hold countdown, then the bordered payment panel.
 *
 * This is the highest-stakes loading state in the funnel. The page awaits
 * `getSession()`, `getMunBySlug`, `getRegistrationById`, and a
 * `registrationProducts` lookup before anything renders, and the user arrives
 * here straight off a seat reservation with a 15-minute hold already ticking.
 * A blank frame at that moment reads as "did my reservation fail?", so the
 * skeleton shows the panel shape — including the countdown slot — from the
 * first paint.
 *
 * Deliberately no skeleton for the expired-hold or webhook-error notices: both
 * are alternate branches, not part of the default panel, and reserving space
 * for a warning the user probably won't get is its own small lie.
 */
export default function PayLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        {/* "Secure checkout" eyebrow, headline, mun · pass meta line. */}
        <div className="flex flex-col gap-xs">
          <Skeleton className="h-3.5 w-32 rounded-sm" />
          <Skeleton className="h-9 w-[min(100%,22rem)] rounded-sm" />
          <Skeleton className="h-3.5 w-[min(100%,26rem)] rounded-sm" />
        </div>

        {/* <ReservationCountdown> band. */}
        <Skeleton className="h-14 w-full rounded-md" />

        {/* Payment panel. */}
        <section className="flex flex-col gap-lg rounded-md border border-border p-lg sm:p-xl">
          <div className="flex items-baseline justify-between gap-md border-b border-border pb-md">
            <Skeleton className="h-4 w-28 rounded-sm" />
            <Skeleton className="h-7 w-24 rounded-sm" />
          </div>

          {/* Mock-provider disclosure strip. */}
          <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm">
            <Skeleton className="mt-px size-4 shrink-0 rounded-sm" />
            <div className="flex flex-1 flex-col gap-xxs">
              <Skeleton className="h-3.5 w-full rounded-sm" />
              <Skeleton className="h-3.5 w-full rounded-sm" />
              <Skeleton className="h-3.5 w-2/3 rounded-sm" />
            </div>
          </div>

          {/* Pay + simulate-failure pair. The primary is `sm:flex-1`, so it
              stretches while the outline button keeps its intrinsic width. */}
          <div className="flex flex-col gap-sm sm:flex-row sm:items-center">
            <Skeleton className="h-12 w-full rounded-lg sm:flex-1" />
            <Skeleton className="h-12 w-full rounded-lg sm:w-[176px]" />
          </div>

          <Skeleton className="h-3.5 w-[min(100%,22rem)] rounded-sm" />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
