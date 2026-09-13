import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxIcon, LayersIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModuleReviewQueue } from "@/lib/actions/admin-review";
import { getSession } from "@/lib/auth/session";
import type { MunModule } from "@/lib/db/schema-enums";
import { ModuleReviewDialog } from "./module-review-dialog";

export const metadata: Metadata = {
  title: "Verification console",
  description: "Module-level content verification queue for organizer submissions.",
};

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

/** Human labels for the four tracked modules — matches organizer-facing copy. */
const MODULE_LABELS: Record<MunModule, string> = {
  mun_details: "MUN details",
  committees: "Committees",
  portfolios: "Portfolios",
  registration_products: "Registration products",
};

export default async function VerificationConsolePage() {
  // Same pattern as /admin/review: the page redirects for UX, the underlying
  // action (getModuleReviewQueue -> requireRole) is the real boundary.
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/verification")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const queue = await getModuleReviewQueue();

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
              <h1 className="font-display text-display-md text-ink">Verification console</h1>
              <p className="text-body-md text-muted-foreground">
                Individual modules an organizer has confirmed and submitted for content review.
                A conference advances to VERIFIED once all four tracked modules pass.
              </p>
              <Button variant="link" size="sm" className="h-auto p-0 self-start" render={<Link href="/admin/review" />}>
                <InboxIcon aria-hidden />
                Application review queue
              </Button>
            </div>

            {queue.length > 0 && (
              <dl className="flex items-center gap-lg">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                    Pending
                  </dt>
                  <dd className="font-display text-title-lg tabular-nums text-ink">
                    {queue.length}
                  </dd>
                </div>
              </dl>
            )}
          </header>

          {queue.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <LayersIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No modules pending review.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Modules land here once an organizer confirms them for content verification.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-sm">
              {queue.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-md rounded-md border border-border bg-card p-md"
                >
                  <div className="flex min-w-0 flex-col gap-xxs">
                    <div className="flex items-center gap-sm">
                      <span className="font-display text-title-sm text-ink">{row.munName}</span>
                      <Badge variant="secondary">
                        {MODULE_LABELS[row.moduleName as MunModule] ?? row.moduleName}
                      </Badge>
                    </div>
                    <p className="text-body-md text-muted-foreground">
                      Confirmed{" "}
                      {row.organizerConfirmedAt
                        ? new Date(row.organizerConfirmedAt).toLocaleDateString()
                        : "recently"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-sm">
                    <ModuleReviewDialog
                      munId={row.munId}
                      munName={row.munName}
                      moduleName={row.moduleName as MunModule}
                      moduleLabel={MODULE_LABELS[row.moduleName as MunModule] ?? row.moduleName}
                      decision="VERIFIED"
                    />
                    <ModuleReviewDialog
                      munId={row.munId}
                      munName={row.munName}
                      moduleName={row.moduleName as MunModule}
                      moduleLabel={MODULE_LABELS[row.moduleName as MunModule] ?? row.moduleName}
                      decision="CHANGES_REQUESTED"
                    />
                    <ModuleReviewDialog
                      munId={row.munId}
                      munName={row.munName}
                      moduleName={row.moduleName as MunModule}
                      moduleLabel={MODULE_LABELS[row.moduleName as MunModule] ?? row.moduleName}
                      decision="REJECTED"
                    />
                  </div>
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
