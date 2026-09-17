import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CircleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { listPaymentExceptions, resolvePaymentException } from "@/api/admin-payments";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { getToneClassName, type StatusTone } from "@/components/dashboard/registration-status";
import type { PaymentExceptionRow } from "@/types/admin-payments";

const NOTE_MAX_LENGTH = 2000;

const REASON_META: Record<string, { label: string; tone: StatusTone; hint: string }> = {
  PAYMENT_AFTER_HOLD_EXPIRED: {
    label: "Paid after hold expired",
    tone: "warning",
    hint: "The payment completed after the seat hold lapsed, so no registration was confirmed. Return the full amount.",
  },
  DUPLICATE_PAYMENT: {
    label: "Charged twice",
    tone: "destructive",
    hint: "A second payment was captured for a registration that was already paid. Return the extra charge.",
  },
  AMOUNT_MISMATCH: {
    label: "Amount mismatch",
    tone: "destructive",
    hint: "The provider reported a different amount or currency than the order, so the registration was not confirmed. Check the charge with the provider.",
  },
};

function reasonMeta(reason: string) {
  return REASON_META[reason] ?? { label: reason, tone: "muted" as const, hint: "Check this payment with the provider." };
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatRaisedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function AdminPaymentsPage() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<PaymentExceptionRow | null>(null);
  const [note, setNote] = useState("");

  const exceptionsQuery = useQuery({
    queryKey: queryKeys.adminPaymentExceptions(),
    queryFn: listPaymentExceptions,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ paymentId, note }: { paymentId: string; note: string }) =>
      resolvePaymentException(paymentId, note),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.adminPaymentExceptions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() }),
      ]);
      setTarget(null);
      setNote("");
      toast.success("Payment exception resolved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to resolve this exception"),
  });

  const results = exceptionsQuery.data ?? [];
  const trimmedNote = note.trim();

  const openResolve = (row: PaymentExceptionRow) => {
    setTarget(row);
    setNote("");
  };

  const handleResolve = (event: FormEvent) => {
    event.preventDefault();
    if (!target || !trimmedNote) return;
    resolveMutation.mutate({ paymentId: target.paymentId, note: trimmedNote });
  };

  return (
    <>
      <Helmet title="Payments" />
      <AdminPageFrame
        title="Payments"
        description="Payment exceptions requiring manual review: money taken with no valid registration behind it. There are no refunds — return the money off-platform, then resolve the exception with a note."
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
              Every captured payment has a registration behind it. Nothing needs manual review.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[56rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Registration</th>
                  <th className="px-md py-sm font-medium">Delegate</th>
                  <th className="px-md py-sm font-medium">MUN</th>
                  <th className="px-md py-sm font-medium">Amount</th>
                  <th className="px-md py-sm font-medium">Exception</th>
                  <th className="px-md py-sm font-medium">Raised</th>
                  <th className="px-md py-sm font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const meta = reasonMeta(row.reason);
                  return (
                    <tr key={row.paymentId} className="border-b border-border align-top last:border-0">
                      {/* IDs and emails are long unbroken strings: let them wrap
                          inside a bounded column instead of widening the table. */}
                      <td className="max-w-52 px-md py-sm break-all">
                        <span className="block font-mono text-caption text-muted-foreground">{row.registrationId}</span>
                        <span className="block font-mono text-caption text-muted-foreground">
                          {row.providerPaymentId ?? row.providerOrderId}
                        </span>
                      </td>
                      <td className="max-w-60 px-md py-sm break-all">
                        <span className="block text-ink">{row.studentName}</span>
                        <span className="block text-caption text-muted-foreground">{row.studentEmail}</span>
                      </td>
                      <td className="max-w-48 px-md py-sm break-words text-body">{row.munName}</td>
                      <td className="px-md py-sm tabular-nums text-body">{formatAmount(row.amount, row.currency)}</td>
                      <td className="px-md py-sm">
                        <Badge variant="outline" className={getToneClassName(meta.tone)}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="px-md py-sm whitespace-nowrap text-body">
                        <time dateTime={row.raisedAt}>{formatRaisedAt(row.raisedAt)}</time>
                      </td>
                      <td className="px-md py-sm text-right">
                        <Button variant="outline" size="sm" onClick={() => openResolve(row)}>
                          Resolve
                          <span className="sr-only"> exception for {row.studentName}</span>
                        </Button>
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

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleResolve} className="flex flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>Resolve payment exception</DialogTitle>
              <DialogDescription>{target ? reasonMeta(target.reason).hint : ""}</DialogDescription>
            </DialogHeader>
            {target && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xxs text-body-md">
                <dt className="text-muted-foreground">Delegate</dt>
                <dd className="text-ink">{target.studentName}</dd>
                <dt className="text-muted-foreground">MUN</dt>
                <dd className="text-ink">{target.munName}</dd>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="tabular-nums text-ink">{formatAmount(target.amount, target.currency)}</dd>
                <dt className="text-muted-foreground">Payment</dt>
                <dd className="font-mono text-caption break-all text-ink">
                  {target.providerPaymentId ?? target.providerOrderId}
                </dd>
              </dl>
            )}
            <div className="flex flex-col gap-xs">
              <Label htmlFor="resolution-note">Resolution note</Label>
              <textarea
                id="resolution-note"
                className="min-h-24 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                value={note}
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What was done, e.g. amount returned to the original payment method, with the transfer reference."
                required
                autoFocus
              />
              <p className="text-caption text-muted-foreground">Recorded in the audit log with your name.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={resolveMutation.isPending || !trimmedNote}>
                {resolveMutation.isPending ? "Resolving..." : "Mark resolved"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
