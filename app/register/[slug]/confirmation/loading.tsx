import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/register/[slug]/confirmation/page.tsx geometry — the centered
 * max-w-2xl column holding one <RegistrationNotice>: leading icon, title,
 * message, the receipt `<dl>`, then the action row.
 *
 * The page fans out five awaits before it can decide anything — `getSession()`,
 * `getMunBySlug`, `getRegistrationById`, the product lookup, and conditional
 * committee/portfolio lookups — and every terminal status (CONFIRMED,
 * CANCELLED, PENDING, REFUNDED, ATTENDED, NO_SHOW) renders through the same
 * notice shell with the same receipt. So the skeleton can mirror the shell
 * exactly without committing to an outcome, which matters here: this page's
 * whole job is to be the first honest answer about whether payment landed, and
 * a skeleton that hinted at success or failure would pre-empt that answer.
 *
 * Six receipt rows is the floor (reference, conference, dates, pass, amount,
 * status); committee and portfolio rows are conditional and omitted rather
 * than guessed at.
 */

const RECEIPT_ROWS = 6;

export default function ConfirmationLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        {/* <RegistrationNotice> shell — tone-neutral by design. */}
        <div className="flex flex-col gap-md rounded-md border border-border p-lg sm:p-xl">
          <div className="flex items-start gap-sm">
            <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-xs">
              <Skeleton className="h-7 w-[min(100%,16rem)] rounded-sm" />
              <div className="flex flex-col gap-xxs">
                <Skeleton className="h-3.5 w-full rounded-sm" />
                <Skeleton className="h-3.5 w-full rounded-sm" />
                <Skeleton className="h-3.5 w-3/5 rounded-sm" />
              </div>
            </div>
          </div>

          {/* Receipt table — matches the real `divide-y` dl exactly. */}
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {Array.from({ length: RECEIPT_ROWS }, (_, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-md px-md py-sm"
              >
                <Skeleton className="h-3.5 w-24 rounded-sm" />
                <Skeleton className="h-3.5 w-40 rounded-sm" />
              </div>
            ))}
          </div>

          {/* Action row — every status branch renders one or two buttons. */}
          <div className="flex flex-wrap items-center gap-sm">
            <Skeleton className="h-12 w-[188px] rounded-lg" />
            <Skeleton className="h-12 w-[180px] rounded-lg" />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
