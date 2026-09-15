import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxIcon, UsersIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { listOrganizers } from "@/lib/actions/organizer-admin";
import { getSession } from "@/app/lib/session";
import { OrganizerRow } from "./organizer-row";

export const metadata: Metadata = {
  title: "Organizers",
  description: "Admin console for organizer account management.",
};

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

export default async function OrganizersPage() {
  // Same pattern as /admin/review: the page redirects for UX, the underlying
  // action (listOrganizers -> requireRole) is the real boundary.
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/organizers")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const { results, total } = await listOrganizers({ limit: 50 }, session);
  const suspendedCount = results.filter((organizer) => organizer.suspended).length;

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
              <h1 className="font-display text-display-md text-ink">Organizers</h1>
              <p className="text-body-md text-muted-foreground">
                Suspending an organizer only blocks their login — it does not touch their MUNs.
                Review a specific MUN&apos;s content separately.
              </p>
              <Button variant="link" size="sm" className="h-auto p-0 self-start" render={<Link href="/admin/review" />}>
                <InboxIcon aria-hidden />
                Application review queue
              </Button>
            </div>

            {total > 0 && (
              <dl className="flex items-center gap-lg">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                    Total
                  </dt>
                  <dd className="font-display text-title-lg tabular-nums text-ink">{total}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                    Suspended
                  </dt>
                  <dd className="font-display text-title-lg tabular-nums text-ink">
                    {suspendedCount}
                  </dd>
                </div>
              </dl>
            )}
          </header>

          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <UsersIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No organizer accounts yet.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Organizer accounts are created when an organizer application is submitted.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {results.map((organizer) => (
                <OrganizerRow key={organizer.id} organizer={organizer} />
              ))}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
