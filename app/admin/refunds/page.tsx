import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BanknoteIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSession } from "@/lib/auth/session";
import { listRefundRequests } from "@/lib/lifecycle/refund";
import { RefundRow } from "./refund-row";

export const metadata: Metadata = {
  title: "Refund Requests",
  description: "Admin queue for reviewing and executing refund requests.",
};

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Admin refund queue — lists REQUESTED refund_requests rows for approval or
 * rejection. Approving executes the mock-provider refund atomically (no
 * separate confirmation step); same role-gate pattern as
 * /admin/organizers and /admin/payments.
 */
export default async function RefundsPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/refunds")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const requests = await listRefundRequests();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">Refund Requests</h1>
            <p className="text-body-md text-muted-foreground">
              Approve executes the refund immediately via the payments provider. Reject leaves the
              registration and payment untouched.
            </p>
          </header>

          {requests.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <BanknoteIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No pending refund requests.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Every filed refund request has already been decided.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {requests.map((r) => (
                <RefundRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
