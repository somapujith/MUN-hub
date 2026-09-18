import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CircleAlertIcon, SearchIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getToneClassName, type StatusTone } from "@/components/dashboard/registration-status";
import { adminSelectClassName } from "@/lib/admin/styles";
import { usePageClamp } from "@/lib/admin/use-page-clamp";
import type { PaymentExceptionRow } from "@/types/admin-payments";
import type { RegistrationStatus } from "@/types/enums";

const PAGE_SIZE = 20;

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
    hint: "A second payment was captured on an order that was already paid.",
  },
  AMOUNT_MISMATCH: {
    label: "Amount mismatch",
    tone: "destructive",
    hint: "The provider reported a different amount or currency than the order, so that charge did not confirm the registration.",
  },
};

function reasonMeta(reason: string) {
  return REASON_META[reason] ?? { label: reason, tone: "muted" as const, hint: "Check this payment with the provider." };
}

const STANDING_REGISTRATION_STATUSES = new Set<RegistrationStatus>(["CONFIRMED", "ATTENDED", "NO_SHOW"]);

// Only one payment ID is stored per order: the latest capture, or the one that
// confirmed the seat. The charge that raised the exception may not be the one
// on file, so say which charges to return and look them up by order ID.
function returnGuidance(row: PaymentExceptionRow): string {
  return STANDING_REGISTRATION_STATUSES.has(row.registrationStatus)
    ? "Keep the payment on file: it confirmed the seat. Return every other charge on this order; look the order up in the provider dashboard to find them."
    : "No seat was confirmed, so every charge on this order is owed back; look the order up in the provider dashboard to find them.";
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
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = { status, q: search || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const exceptionsQuery = useQuery({
    queryKey: queryKeys.adminPaymentExceptions(params),
    queryFn: () => listPaymentExceptions(params),
    placeholderData: (previous) => previous,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ paymentId, note }: { paymentId: string; note: string }) =>
      resolvePaymentException(paymentId, note),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.adminPaymentExceptionsAll() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() }),
      ]);
      setTarget(null);
      setNote("");
      toast.success("Payment exception resolved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to resolve this exception"),
  });

  const results = exceptionsQuery.data?.results ?? [];
  const total = exceptionsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const trimmedNote = note.trim();

  usePageClamp(Boolean(exceptionsQuery.data), page, setPage, totalPages);

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
        <div className="flex flex-wrap items-end gap-md">
          <div className="flex w-full max-w-md flex-col gap-xs">
            <label htmlFor="payments-search" className="text-body-md font-medium text-ink">
              Search
            </label>
            <div className="relative w-full">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="payments-search"
                type="search"
                placeholder="Delegate email or MUN name"
                className="pl-xxl"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="payments-status">Status</Label>
            <select
              id="payments-status"
              className={adminSelectClassName}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as "open" | "resolved");
                setPage(0);
              }}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          <p className="text-body-md text-muted-foreground">
            {total === 0 ? "No exceptions" : `${total} exception${total === 1 ? "" : "s"}`}
          </p>
        </div>

        {exceptionsQuery.isLoading ? (
          <div className="flex flex-col gap-sm">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : exceptionsQuery.isError ? (
          <p className="text-body-md text-destructive">
            {exceptionsQuery.error instanceof Error
              ? exceptionsQuery.error.message
              : "Unable to load payment exceptions right now."}
          </p>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
            <CircleAlertIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
            <p className="font-display text-title-md text-ink">
              {status === "open" ? "No open payment exceptions" : "No resolved payment exceptions"}
            </p>
            <p className="max-w-sm text-body-md text-muted-foreground">
              {search
                ? "Try a different name or email."
                : status === "open"
                  ? "Every captured payment has a registration behind it. Nothing needs manual review."
                  : "Nothing has been resolved yet."}
            </p>
          </div>
        ) : (
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
                    {status === "open" ? <span className="sr-only">Actions</span> : "Resolution"}
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
                          Order {row.providerOrderId}
                        </span>
                        {row.providerPaymentId && (
                          <span className="block font-mono text-caption text-muted-foreground">
                            Payment {row.providerPaymentId}
                          </span>
                        )}
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
                      <td className="max-w-56 px-md py-sm text-right">
                        {status === "open" ? (
                          <Button variant="outline" size="sm" onClick={() => openResolve(row)}>
                            Resolve
                            <span className="sr-only"> exception for {row.studentName}</span>
                          </Button>
                        ) : (
                          <div className="text-left">
                            {row.resolvedAt && (
                              <time dateTime={row.resolvedAt} className="block whitespace-nowrap text-caption text-muted-foreground">
                                {formatRaisedAt(row.resolvedAt)}
                              </time>
                            )}
                            {row.resolutionNote && <p className="break-words text-body">{row.resolutionNote}</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-md border-t border-border px-md py-sm">
                <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <p className="text-body-md tabular-nums text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
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
              <DialogDescription>
                {target ? `${reasonMeta(target.reason).hint} ${returnGuidance(target)}` : ""}
              </DialogDescription>
            </DialogHeader>
            {target && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xxs text-body-md">
                <dt className="text-muted-foreground">Delegate</dt>
                <dd className="text-ink">{target.studentName}</dd>
                <dt className="text-muted-foreground">MUN</dt>
                <dd className="text-ink">{target.munName}</dd>
                <dt className="text-muted-foreground">Order amount</dt>
                <dd className="tabular-nums text-ink">{formatAmount(target.amount, target.currency)}</dd>
                <dt className="text-muted-foreground">Order</dt>
                <dd className="font-mono text-caption break-all text-ink">{target.providerOrderId}</dd>
                <dt className="text-muted-foreground">Payment on file</dt>
                <dd className="font-mono text-caption break-all text-ink">{target.providerPaymentId ?? "None"}</dd>
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
