import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/organizer/apply/page.tsx geometry — the two-column
 * `1fr / 20rem` split, the headline block, <ApplyForm>'s three labelled
 * sections, and the sticky "What happens next" aside.
 *
 * The page awaits `getSession()` and then a uniqueness lookup on
 * `organizer_applications`, and may redirect on either. The skeleton still
 * renders during both — a redirect that hasn't resolved yet is indistinguishable
 * from a slow load from the browser's side, and a blank frame is the worse of
 * the two guesses.
 */

/** Label + 44px control. `hint` adds the third line under the input. */
function FieldSkeleton({ hint = false, rows = 1 }: { hint?: boolean; rows?: number }) {
  return (
    <div className="flex flex-col gap-xs">
      <Skeleton className="h-3.5 w-32 rounded-sm" />
      {/* rows>1 stands in for the <textarea>, which is rows={6}. */}
      <Skeleton className={rows > 1 ? "h-[152px] w-full rounded-sm" : "h-11 w-full rounded-sm"} />
      {hint && <Skeleton className="h-3 w-3/5 rounded-sm" />}
    </div>
  );
}

/**
 * One <Section> from the form: a left title/description rail at 14rem and the
 * fields stacked on the right, splitting only from `md`.
 */
function SectionSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-lg border-t border-border pt-xl md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-xl">
      <div className="flex flex-col gap-xxs">
        <Skeleton className="h-5 w-36 rounded-sm" />
        <Skeleton className="h-3.5 w-[min(100%,16rem)] rounded-sm" />
      </div>
      <div className="flex flex-col gap-lg">{children}</div>
    </div>
  );
}

export default function OrganizerApplyLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 pb-section">
        <div className="content-container">
          <div className="grid gap-xl py-xxl lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-section lg:py-section">
            <div className="flex max-w-2xl flex-col gap-xl">
              {/* Headline block */}
              <div className="flex flex-col gap-md">
                <Skeleton className="h-3.5 w-28 rounded-sm" />
                <Skeleton className="h-9 w-[min(100%,26rem)] rounded-sm lg:h-11" />
                <div className="flex flex-col gap-xs">
                  <Skeleton className="h-5 w-full rounded-sm" />
                  <Skeleton className="h-5 w-4/5 rounded-sm" />
                </div>
              </div>

              {/* <ApplyForm> — three sections, then the submit row. */}
              <div className="flex flex-col gap-xl">
                {/* "Your conference": name, then host city + start date. */}
                <SectionSkeleton>
                  <FieldSkeleton hint />
                  <div className="grid gap-lg sm:grid-cols-2">
                    <FieldSkeleton />
                    <FieldSkeleton />
                  </div>
                </SectionSkeleton>

                {/* "Scale": expected delegates. */}
                <SectionSkeleton>
                  <FieldSkeleton hint />
                </SectionSkeleton>

                {/* "Context": the textarea, then previous editions + website. */}
                <SectionSkeleton>
                  <FieldSkeleton hint rows={6} />
                  <div className="grid gap-lg sm:grid-cols-2">
                    <FieldSkeleton />
                    <FieldSkeleton />
                  </div>
                </SectionSkeleton>

                <div className="flex flex-col gap-sm border-t border-border pt-xl sm:flex-row sm:items-center sm:justify-between">
                  <Skeleton className="h-3.5 w-[min(100%,20rem)] rounded-sm" />
                  <Skeleton className="h-12 w-full rounded-lg sm:w-[180px]" />
                </div>
              </div>
            </div>

            {/* "What happens next" aside — four numbered steps, a reassurance
                line, and the outline CTA, matching STEPS.length exactly. */}
            <aside>
              <div className="flex flex-col gap-md rounded-md border border-border bg-surface-soft p-lg lg:sticky lg:top-24 dark:bg-card">
                <Skeleton className="h-4 w-36 rounded-sm" />

                <div className="flex flex-col gap-sm">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-sm">
                      <Skeleton className="size-5 shrink-0 rounded-full" />
                      <Skeleton className="h-3.5 w-full rounded-sm" />
                    </div>
                  ))}
                </div>

                <div className="flex items-start gap-xs border-t border-border pt-md">
                  <Skeleton className="mt-px size-3.5 shrink-0 rounded-sm" />
                  <div className="flex flex-1 flex-col gap-xxs">
                    <Skeleton className="h-3.5 w-full rounded-sm" />
                    <Skeleton className="h-3.5 w-2/3 rounded-sm" />
                  </div>
                </div>

                <Skeleton className="h-9 w-full rounded-lg" />
              </div>
            </aside>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
