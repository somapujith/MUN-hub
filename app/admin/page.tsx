import type { Metadata } from "next";
import { ClipboardListIcon, LayersIcon, LifeBuoyIcon, AlertTriangleIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getModuleReviewQueue, getReviewQueue } from "@/lib/actions/admin-review";
import { listPaymentExceptions } from "@/lib/actions/admin-search";
import { listTickets } from "@/lib/actions/support";

export const metadata: Metadata = {
  title: "Admin overview",
  description: "At-a-glance counts across every operations queue.",
};

// Each of the four calls below (getReviewQueue, getModuleReviewQueue,
// listTickets, listPaymentExceptions) independently calls getSession()
// (-> next/headers cookies()) and requireRole() as its OWN authorization
// boundary — not a redundant echo of the role-check already done in
// app/admin/layout.tsx. That's true even though the values rendered here
// are harmless aggregate counts, not per-record data (see
// MUNHub_Client_Server_Rendering_PRD.md §21/§46, which requires
// authorization to be server-side and authoritative, not that harmless
// aggregates be recomputed with zero caching).
//
// Wrapping these calls in `unstable_cache` isn't viable without moving the
// getSession()/requireRole() calls out of those four functions first (out
// of scope here — see CLAUDE.md ground rules): unstable_cache's cached
// callback cannot itself call cookies(), and calling getSession() in this
// page ahead of a cache boundary just to read the role would still force
// this route dynamic, so there is no way to shed force-dynamic without
// changing those functions' signatures. Given this is a low-traffic
// admin-only dashboard, that refactor isn't worth the added complexity for
// counts that are cheap to compute.
export const dynamic = "force-dynamic";

/**
 * Landing page for `/admin` — four at-a-glance counts, one per queue that
 * currently exists. Deliberately four cards, not five: the refund workflow
 * (originally planned as a fifth "Pending Refunds" card) was built then
 * fully reverted for an unresolved double-refund concurrency bug, so no
 * refund count exists to show here.
 *
 * `getReviewQueue`/`getModuleReviewQueue` return `{ results, total }`
 * (paginated) — `.total` is the real queue depth, not `results.length`,
 * which would be capped at whatever `limit` we pass.
 *
 * Role-gating happens in `app/admin/layout.tsx` (and again inside each
 * action via `requireRole`) — this page does no gating of its own.
 */
export default async function AdminOverviewPage() {
  const [applications, modules, tickets, exceptions] = await Promise.all([
    getReviewQueue({ limit: 1 }),
    getModuleReviewQueue({ limit: 1 }),
    listTickets({ status: "NEW" }),
    listPaymentExceptions(),
  ]);

  const cards = [
    { label: "Pending Applications", value: applications.total, icon: ClipboardListIcon, href: "/admin/review" },
    { label: "Pending Module Reviews", value: modules.total, icon: LayersIcon, href: "/admin/verification" },
    { label: "Open Support Tickets", value: tickets.length, icon: LifeBuoyIcon, href: "/admin/support" },
    { label: "Payment Exceptions", value: exceptions.length, icon: AlertTriangleIcon, href: "/admin/payments" },
  ] as const;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">Overview</h1>
            <p className="text-body-md text-muted-foreground">
              Current depth of every operations queue.
            </p>
          </header>

          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <a
                key={card.label}
                href={card.href}
                className="flex flex-col gap-sm rounded-md border border-border bg-card p-lg transition-colors duration-150 hover:border-ink/20"
              >
                <card.icon className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                <p className="font-display text-title-lg text-ink">{card.value}</p>
                <p className="text-body-md text-muted-foreground">{card.label}</p>
              </a>
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
