import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/login/page.tsx geometry — same 400px centered column, same
 * headline/form/demo-accounts rhythm — so the sign-in card doesn't jump when
 * `searchParams` resolves.
 *
 * The three demo-account rows are a fixed list in the page (DEMO_ACCOUNTS),
 * not a query result, so three is the exact count, not an estimate.
 */
export default function LoginLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          {/* Headline block */}
          <div className="flex flex-col gap-xs">
            <Skeleton className="h-8 w-48 rounded-sm md:h-10" />
            <Skeleton className="h-3.5 w-full rounded-sm" />
          </div>

          {/* Form: label + 44px input + full-width primary button. No error
              slot is reserved — the error only exists on a redirect back, and
              holding 44px of empty space for it on every load is worse than
              the one-time shift when it does appear. */}
          <div className="mt-xl flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <Skeleton className="h-3.5 w-28 rounded-sm" />
              <Skeleton className="h-11 w-full rounded-sm" />
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>

          {/* Demo-accounts disclosure block */}
          <div className="mt-xl border-t border-border pt-lg">
            <Skeleton className="h-3.5 w-52 rounded-sm" />
            <div className="mt-xxs flex flex-col gap-xxs">
              <Skeleton className="h-3.5 w-full rounded-sm" />
              <Skeleton className="h-3.5 w-4/5 rounded-sm" />
            </div>

            <ul className="mt-md flex flex-col gap-xxs">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-md rounded-sm bg-surface-soft px-sm py-xs"
                >
                  <Skeleton className="h-3.5 w-40 rounded-sm" />
                  <Skeleton className="h-3.5 w-16 rounded-sm" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
