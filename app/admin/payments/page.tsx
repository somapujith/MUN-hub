import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/app/lib/session";
import { listPaymentExceptions } from "@/lib/actions/admin-search";
import { formatPrice } from "@/components/shared/currency";

export const metadata: Metadata = {
  title: "Payment Exceptions",
  description: "Admin monitoring for failed or mismatched payments.",
};

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

const REASON_LABEL: Record<string, string> = {
  PAYMENT_FAILED: "Payment failed",
  CONFIRMATION_MISMATCH: "Paid but not confirmed",
};

/**
 * Read-only payment exception monitor — surfaces the two cases the
 * registration webhook itself already treats as anomalies (see CLAUDE.md
 * "Registration integrity"): a FAILED payment, and a PAID payment whose
 * registration didn't end up CONFIRMED (expired/cancelled after the webhook
 * fired, or a refund is owed). Same role-gate pattern as /admin/registrations.
 */
export default async function PaymentsPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/payments")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const exceptions = await listPaymentExceptions(session);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">Payment Exceptions</h1>
            <p className="text-body-md text-muted-foreground">
              Failed payments and payment/registration mismatches that need manual follow-up.
            </p>
          </header>

          {exceptions.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <AlertTriangleIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No exceptions.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Every payment on record is either healthy or already resolved.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {exceptions.map((e) => (
                <div key={e.paymentId} className="flex flex-wrap items-center justify-between gap-sm p-md">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate font-display text-title-sm font-medium text-ink">
                      {e.studentName} — {e.munName}
                    </p>
                    <span className="text-body-md text-muted-foreground">{formatPrice(e.amount)}</span>
                  </div>
                  <Badge variant="destructive">{REASON_LABEL[e.reason] ?? e.reason}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
