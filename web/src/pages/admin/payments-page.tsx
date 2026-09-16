import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CircleAlertIcon } from "lucide-react";
import { listPaymentExceptions } from "@/api/admin-payments";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Badge } from "@/components/ui/badge";
import { getToneClassName, type StatusTone } from "@/components/dashboard/registration-status";
import type { PaymentExceptionRow } from "@/types/admin-payments";

const REASON_META: Record<PaymentExceptionRow["reason"], { label: string; tone: StatusTone }> = {
  PAYMENT_FAILED: { label: "Payment failed", tone: "destructive" },
  CONFIRMATION_MISMATCH: { label: "Paid, not confirmed", tone: "warning" },
};

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function AdminPaymentsPage() {
  const exceptionsQuery = useQuery({
    queryKey: ["admin", "payment-exceptions"],
    queryFn: listPaymentExceptions,
  });

  const results = exceptionsQuery.data ?? [];

  return (
    <>
      <Helmet title="Payments" />
      <AdminPageFrame
        title="Payments"
        description="Payment exceptions requiring manual review: failed charges, and payments that succeeded after their registration expired or was cancelled."
      >
        {exceptionsQuery.isLoading && (
          <p className="text-body-md text-muted-foreground">Loading payment exceptions...</p>
        )}
        {exceptionsQuery.isError && (
          <p className="text-body-md text-destructive">
            {exceptionsQuery.error instanceof Error
              ? exceptionsQuery.error.message
              : "Unable to load payment exceptions right now."}
          </p>
        )}

        {!exceptionsQuery.isLoading && !exceptionsQuery.isError && results.length === 0 && (
          <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
            <CircleAlertIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
            <p className="font-display text-title-md text-ink">No payment exceptions</p>
            <p className="max-w-sm text-body-md text-muted-foreground">
              Every payment currently matches its registration&apos;s status. Nothing needs manual review.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[44rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Registration</th>
                  <th className="px-md py-sm font-medium">Delegate</th>
                  <th className="px-md py-sm font-medium">MUN</th>
                  <th className="px-md py-sm font-medium">Amount</th>
                  <th className="px-md py-sm font-medium">Exception</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const meta = REASON_META[row.reason];
                  return (
                    <tr key={row.paymentId} className="border-b border-border last:border-0">
                      <td className="px-md py-sm font-mono text-caption text-muted-foreground">
                        {row.registrationId}
                      </td>
                      <td className="px-md py-sm text-ink">{row.studentName}</td>
                      <td className="px-md py-sm text-body">{row.munName}</td>
                      <td className="px-md py-sm tabular-nums text-body">{formatAmount(row.amount)}</td>
                      <td className="px-md py-sm">
                        <Badge variant="outline" className={getToneClassName(meta.tone)}>
                          {meta.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-border px-md py-sm text-body-md text-muted-foreground">
              {results.length} exception{results.length === 1 ? "" : "s"} — newest first, capped at 100.
            </p>
          </div>
        )}
      </AdminPageFrame>
    </>
  );
}
