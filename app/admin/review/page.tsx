import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getMunForReview, getReviewQueue } from "@/lib/actions/admin-review";
import { getSession } from "@/lib/auth/session";
import type { MunWithApplication } from "@/lib/types";
import { ReviewQueueRow } from "./review-queue-row";

export const metadata: Metadata = {
  title: "Review queue",
  description: "Internal operations queue for MUN organizer applications.",
};

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

export default async function AdminReviewPage() {
  // Gate in the page as well as in the actions. The actions are the real
  // security boundary (they call requireRole against their own getSession),
  // but without this the page would render a shell and then blow up on the
  // first data call — a redirect is the correct UX for an unauthenticated hit.
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/review")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const queue = await getReviewQueue();

  // getReviewQueue returns bare `Mun` rows; the organizer application and the
  // verification-log history (with internalNotes) only come from
  // getMunForReview. Fetched in parallel — the alternative is an N+1 waterfall.
  const details: MunWithApplication[] = await Promise.all(
    queue.map((mun) => getMunForReview(mun.id))
  );

  const submittedCount = details.filter((mun) => mun.status === "SUBMITTED").length;
  const underReviewCount = details.filter((mun) => mun.status === "UNDER_REVIEW").length;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-wrap items-end justify-between gap-md border-b border-border pb-lg">
            <div className="flex flex-col gap-xxs">
              <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                Operations
              </span>
              <h1 className="font-display text-display-md text-ink">Review queue</h1>
              <p className="text-body-md text-muted-foreground">
                Organizer applications awaiting an ops decision. Every decision is written to the
                MUN&apos;s verification log.
              </p>
            </div>

            {details.length > 0 && (
              <dl className="flex items-center gap-lg">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                    New
                  </dt>
                  <dd className="font-display text-title-lg tabular-nums text-ink">
                    {submittedCount}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                    In review
                  </dt>
                  <dd className="font-display text-title-lg tabular-nums text-ink">
                    {underReviewCount}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                    Total
                  </dt>
                  <dd className="font-display text-title-lg tabular-nums text-ink">
                    {details.length}
                  </dd>
                </div>
              </dl>
            )}
          </header>

          {details.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <InboxIcon
                className="size-8 text-muted-foreground"
                strokeWidth={1.25}
                aria-hidden
              />
              <p className="font-display text-title-md text-ink">
                No applications pending review.
              </p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                New organizer applications land here the moment they are submitted.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-sm">
              {details.map((mun) => (
                <li key={mun.id}>
                  <ReviewQueueRow mun={mun} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
