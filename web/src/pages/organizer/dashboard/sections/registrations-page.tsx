import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { ChevronLeft, ChevronRight, UsersRound } from "lucide-react";
import { useParams } from "react-router";
import {
  getDelegateList,
  listCommitteesForDelegates,
  type DelegateFilters,
} from "@/api/organizer-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import type { PaymentStatus } from "@/types/enums";
import type { DelegateRow } from "@/types/organizer-dashboard";

const PAGE_SIZE = 25;

const PAYMENT_STATUS_OPTIONS: Array<{ value: PaymentStatus; label: string }> = [
  { value: "CREATED", label: "Order created" },
  { value: "PENDING", label: "Payment processing" },
  { value: "PAID", label: "Paid" },
  { value: "FAILED", label: "Payment failed" },
  { value: "REFUNDED", label: "Refunded" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

/** Latest payment on the registration — payments.registrationId is unique in practice, so there's at most one. */
function latestPayment(row: DelegateRow) {
  return row.payment.length > 0 ? row.payment[row.payment.length - 1] : null;
}

export function OrganizerRegistrationsPage() {
  const { munId = "" } = useParams();
  const [committeeId, setCommitteeId] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const filters: DelegateFilters = useMemo(
    () => ({
      committeeId: committeeId || undefined,
      paymentStatus: paymentStatus || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [committeeId, paymentStatus, offset],
  );

  const committeesQuery = useQuery({
    queryKey: ["organizer", "committees", munId],
    queryFn: () => listCommitteesForDelegates(munId),
    enabled: Boolean(munId),
  });

  const delegatesQuery = useQuery({
    queryKey: ["organizer", "delegates", munId, filters],
    queryFn: () => getDelegateList(munId, filters),
    enabled: Boolean(munId),
    placeholderData: (previous) => previous,
  });

  const resetToFirstPage = () => setOffset(0);

  const results = delegatesQuery.data?.results ?? [];
  const total = delegatesQuery.data?.total ?? 0;
  const query = search.trim().toLowerCase();
  const visibleResults = query
    ? results.filter(
        (row) =>
          row.user.name.toLowerCase().includes(query) || row.user.email.toLowerCase().includes(query),
      )
    : results;

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + results.length, total);

  return (
    <>
      <Helmet title="Registrations" />
      <WorkspacePage
        title="Registrations"
        description="Delegate roster, payment status, and check-in readiness."
      >
        <div className="flex flex-wrap items-end gap-md">
          <div className="flex flex-col gap-xs">
            <Label htmlFor="reg-committee">Committee</Label>
            <select
              id="reg-committee"
              className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
              value={committeeId}
              onChange={(event) => {
                setCommitteeId(event.target.value);
                resetToFirstPage();
              }}
            >
              <option value="">All committees</option>
              {(committeesQuery.data ?? []).map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="reg-payment-status">Payment status</Label>
            <select
              id="reg-payment-status"
              className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
              value={paymentStatus}
              onChange={(event) => {
                setPaymentStatus(event.target.value as PaymentStatus | "");
                resetToFirstPage();
              }}
            >
              <option value="">Any payment status</option>
              {PAYMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="reg-search">Search this page</Label>
            <Input
              id="reg-search"
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-56"
            />
          </div>
          <p className="ml-auto text-body-md text-muted-foreground">
            {total === 0 ? "No delegates yet" : `${rangeStart}–${rangeEnd} of ${total}`}
          </p>
        </div>

        {delegatesQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading delegates...</p>}
        {delegatesQuery.isError && (
          <p className="text-body-md text-destructive">{delegatesQuery.error.message}</p>
        )}

        {!delegatesQuery.isLoading && total === 0 && (
          <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
            <UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h2 className="mt-md font-display text-title-sm text-ink">No delegates yet</h2>
            <p className="mt-xs text-body-md text-muted-foreground">
              Once delegates register for this conference, they will show up here.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[56rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Delegate</th>
                  <th className="px-md py-sm font-medium">Committee</th>
                  <th className="px-md py-sm font-medium">Status</th>
                  <th className="px-md py-sm font-medium">Payment</th>
                  <th className="px-md py-sm font-medium">Registered</th>
                </tr>
              </thead>
              <tbody>
                {visibleResults.map((row) => {
                  const payment = latestPayment(row);
                  const paymentMeta = payment ? getPaymentStatusMeta(payment.status) : null;
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-md py-sm">
                        <div className="flex flex-col">
                          <span className="font-medium text-ink">{row.user.name}</span>
                          <span className="text-caption text-muted-foreground">{row.user.email}</span>
                          {row.user.institution && (
                            <span className="text-caption text-muted-foreground">{row.user.institution}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-md py-sm text-body">{row.committee?.name ?? "Unassigned"}</td>
                      <td className="px-md py-sm">
                        <RegistrationStatusChip status={row.status} />
                      </td>
                      <td className="px-md py-sm">
                        {payment && paymentMeta ? (
                          <div className="flex flex-col gap-xxs">
                            <Badge variant="outline" className={getToneClassName(paymentMeta.tone)}>
                              {paymentMeta.label}
                            </Badge>
                            <span className="text-caption text-muted-foreground">
                              {new Intl.NumberFormat("en-IN", {
                                style: "currency",
                                currency: "INR",
                                maximumFractionDigits: 0,
                              }).format(payment.amount)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-caption text-muted-foreground">No payment recorded</span>
                        )}
                      </td>
                      <td className="px-md py-sm text-body">{formatDate(row.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between gap-sm">
            <p className="text-body-md text-muted-foreground">
              Page {page} of {pageCount}
            </p>
            <div className="flex items-center gap-xs">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || delegatesQuery.isFetching}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft aria-hidden /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || delegatesQuery.isFetching}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </WorkspacePage>
    </>
  );
}
