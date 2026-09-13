import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LifeBuoyIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSession } from "@/lib/auth/session";
import { listTickets } from "@/lib/actions/support";
import { TicketRow } from "./ticket-row";

export const metadata: Metadata = {
  title: "Support Tickets",
  description: "Admin queue for triaging and resolving support tickets.",
};

// Session-scoped reads — never cache or statically prerender this page.
export const dynamic = "force-dynamic";

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Admin support queue — lists all support_tickets rows (newest first) for
 * triage: assign to self, mark in progress, or resolve with notes. Same
 * role-gate + standalone-shell pattern as /admin/refunds and
 * /admin/organizers (no shared admin nav shell yet — that lands separately
 * in Task 8).
 */
export default async function SupportPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/support")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const tickets = await listTickets();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">Support Tickets</h1>
            <p className="text-body-md text-muted-foreground">
              Newest first. Assign a ticket to yourself, move it to in progress, or resolve it with
              notes for the requester.
            </p>
          </header>

          {tickets.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No support tickets.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Nothing has been filed yet.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {tickets.map((t) => (
                <TicketRow key={t.id} ticket={t} currentUserId={session.userId} />
              ))}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
