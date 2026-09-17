import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { ChevronLeft, ChevronRight, Download, UserCheck, UserX, UsersRound } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  delegateDetailKey,
  downloadDelegateRoster,
  getDelegateList,
  listCommitteesForDelegates,
  ROSTER_SEARCH_MAX_LENGTH,
  setDelegateAttendance,
  type DelegateFilters,
} from "@/api/organizer-dashboard";
import { listRegistrationProducts } from "@/api/registration-products";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { DelegateDetailSheet } from "@/components/organizer/delegate-detail-sheet";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import { formatPrice } from "@/components/shared/currency";
import { useOrganizerWorkspaceMuns } from "@/layouts/workspace-layout";
import type { PaymentStatus, RegistrationStatus } from "@/types/enums";
import type { AttendanceStatus, DelegateRow } from "@/types/organizer-dashboard";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const SELECT_CLASS = "h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink";

// There are no refunds in MUN Hub, so "Refunded" isn't offered as a filter.
const PAYMENT_STATUS_OPTIONS: Array<{ value: PaymentStatus; label: string }> = [
  { value: "CREATED", label: "Order created" },
  { value: "PENDING", label: "Payment processing" },
  { value: "PAID", label: "Paid" },
  { value: "FAILED", label: "Payment failed" },
];

const STATUS_OPTIONS: Array<{ value: string; label: string; statuses: RegistrationStatus[] }> = [
  { value: "seated", label: "Confirmed seats (all)", statuses: ["CONFIRMED", "ATTENDED", "NO_SHOW"] },
  { value: "CONFIRMED", label: "Confirmed, not checked in", statuses: ["CONFIRMED"] },
  { value: "ATTENDED", label: "Checked in", statuses: ["ATTENDED"] },
  { value: "NO_SHOW", label: "No-show", statuses: ["NO_SHOW"] },
  { value: "holding", label: "Awaiting payment", statuses: ["PENDING", "PAYMENT_PENDING"] },
  { value: "CANCELLED", label: "Cancelled", statuses: ["CANCELLED"] },
];

const ATTENDANCE_ELIGIBLE: RegistrationStatus[] = ["CONFIRMED", "ATTENDED", "NO_SHOW"];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

/** Latest payment on the registration — payments.registrationId is unique in practice, so there's at most one. */
function latestPayment(row: DelegateRow) {
  return row.payment.length > 0 ? row.payment[row.payment.length - 1] : null;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function OrganizerRegistrationsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const workspace = useOrganizerWorkspaceMuns();
  const currentMun = workspace.data?.muns.find((mun) => mun.id === munId);

  const [committeeId, setCommitteeId] = useState("");
  const [passId, setPassId] = useState("");
  const [statusOption, setStatusOption] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const [openRegistrationId, setOpenRegistrationId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const baseFilters: DelegateFilters = useMemo(
    () => ({
      committeeId: committeeId || undefined,
      registrationProductId: passId || undefined,
      statuses: STATUS_OPTIONS.find((option) => option.value === statusOption)?.statuses,
      paymentStatus: paymentStatus || undefined,
      search: search || undefined,
    }),
    [committeeId, passId, statusOption, paymentStatus, search],
  );
  // The page offset belongs to one filter combination: any filter or search
  // change starts again from the first page, without a render at the stale
  // offset first.
  const filterKey = JSON.stringify(baseFilters);
  const [paging, setPaging] = useState({ filterKey, offset: 0 });
  const offset = paging.filterKey === filterKey ? paging.offset : 0;
  const setOffset = (next: number) => setPaging({ filterKey, offset: next });
  const filters: DelegateFilters = useMemo(
    () => ({ ...baseFilters, limit: PAGE_SIZE, offset }),
    [baseFilters, offset],
  );

  const committeesQuery = useQuery({
    queryKey: queryKeys.committees(munId),
    queryFn: () => listCommitteesForDelegates(munId),
    enabled: Boolean(munId),
  });
  const passesQuery = useQuery({
    queryKey: queryKeys.registrationProducts(munId),
    queryFn: () => listRegistrationProducts(munId),
    enabled: Boolean(munId),
  });
  const delegatesQuery = useQuery({
    queryKey: queryKeys.delegates(munId, { ...filters }),
    queryFn: () => getDelegateList(munId, filters),
    enabled: Boolean(munId),
    placeholderData: (previous) => previous,
  });

  const attendanceMutation = useMutation({
    mutationFn: ({ registrationId, status }: { registrationId: string; status: AttendanceStatus }) =>
      setDelegateAttendance(munId, registrationId, status),
    onSuccess: async (result) => {
      toast.success(result.status === "ATTENDED" ? "Marked as attended" : "Marked as no-show");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organizer", "delegates", munId] }),
        queryClient.invalidateQueries({ queryKey: delegateDetailKey(munId, result.registrationId) }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to update attendance"),
  });

  const exportRoster = async () => {
    setIsExporting(true);
    try {
      await downloadDelegateRoster(munId, currentMun?.slug ?? "mun", baseFilters);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export the roster");
    } finally {
      setIsExporting(false);
    }
  };

  const results = delegatesQuery.data?.results ?? [];
  const total = delegatesQuery.data?.total ?? 0;
  const attendanceOpen = delegatesQuery.data?.attendanceOpen ?? false;
  const hasFilters = Boolean(committeeId || passId || statusOption || paymentStatus || search);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + results.length, total);

  const markAttendance = (registrationId: string, status: AttendanceStatus) =>
    attendanceMutation.mutate({ registrationId, status });

  return (
    <>
      <Helmet title="Registrations" />
      <WorkspacePage
        title="Registrations"
        description="Your delegate roster: search, filter, open a delegate's full record, record attendance and export."
        actions={
          <Button size="sm" variant="outline" onClick={exportRoster} disabled={isExporting || total === 0}>
            <Download aria-hidden /> {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-md">
          <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-xs">
            <Label htmlFor="reg-search">Search delegates</Label>
            <Input
              id="reg-search"
              type="search"
              placeholder="Name, email, institution or registration ID"
              value={searchInput}
              maxLength={ROSTER_SEARCH_MAX_LENGTH}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="reg-status">Registration status</Label>
            <select
              id="reg-status"
              className={SELECT_CLASS}
              value={statusOption}
              onChange={(event) => setStatusOption(event.target.value)}
            >
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="reg-pass">Pass</Label>
            <select id="reg-pass" className={SELECT_CLASS} value={passId} onChange={(event) => setPassId(event.target.value)}>
              <option value="">All passes</option>
              {(passesQuery.data ?? []).map((pass) => (
                <option key={pass.id} value={pass.id}>
                  {pass.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="reg-committee">Committee</Label>
            <select
              id="reg-committee"
              className={SELECT_CLASS}
              value={committeeId}
              onChange={(event) => setCommitteeId(event.target.value)}
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
              className={SELECT_CLASS}
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus | "")}
            >
              <option value="">Any payment status</option>
              {PAYMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm">
          <p className="text-body-md text-muted-foreground" aria-live="polite">
            {total === 0
              ? hasFilters
                ? "No delegates match"
                : "No delegates yet"
              : `${rangeStart}–${rangeEnd} of ${total}`}
          </p>
          {attendanceOpen && (
            <p className="text-body-md text-muted-foreground">
              The conference is under way — record attendance from a delegate's row or record.
            </p>
          )}
        </div>

        {delegatesQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading delegates...</p>}
        {delegatesQuery.isError && (
          <p role="alert" className="text-body-md text-destructive">
            {delegatesQuery.error.message}
          </p>
        )}

        {!delegatesQuery.isLoading && !delegatesQuery.isError && total === 0 && (
          <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
            <UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h2 className="mt-md font-display text-title-sm text-ink">
              {hasFilters ? "No delegates match these filters" : "No delegates yet"}
            </h2>
            <p className="mt-xs text-body-md text-muted-foreground">
              {hasFilters
                ? "Try a different search or clear a filter."
                : "Once delegates register for this conference, they will show up here."}
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[64rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Delegate</th>
                  <th className="px-md py-sm font-medium">Pass</th>
                  <th className="px-md py-sm font-medium">Committee / portfolio</th>
                  <th className="px-md py-sm font-medium">Status</th>
                  <th className="px-md py-sm font-medium">Payment</th>
                  <th className="px-md py-sm font-medium">Registered</th>
                  <th className="px-md py-sm font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const payment = latestPayment(row);
                  const paymentMeta = payment ? getPaymentStatusMeta(payment.status) : null;
                  const canMark = attendanceOpen && ATTENDANCE_ELIGIBLE.includes(row.status);
                  return (
                    <tr key={row.id} className="border-b border-border align-top last:border-0">
                      <td className="px-md py-sm">
                        <div className="flex flex-col items-start">
                          <button
                            type="button"
                            className="rounded-xs text-left font-medium text-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setOpenRegistrationId(row.id)}
                          >
                            {row.user.name}
                          </button>
                          <span className="text-caption text-muted-foreground">{row.user.email}</span>
                          {row.user.institution && (
                            <span className="text-caption text-muted-foreground">{row.user.institution}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-md py-sm text-body">{row.registrationProduct.name}</td>
                      <td className="px-md py-sm">
                        <div className="flex flex-col">
                          <span className="text-body">{row.committee?.name ?? "Unassigned"}</span>
                          {row.portfolio && (
                            <span className="text-caption text-muted-foreground">{row.portfolio.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-md py-sm">
                        <RegistrationStatusChip status={row.status} />
                      </td>
                      <td className="px-md py-sm">
                        {payment && paymentMeta ? (
                          <div className="flex flex-col gap-xxs">
                            <Badge variant="outline" className={getToneClassName(paymentMeta.tone)}>
                              {paymentMeta.label}
                            </Badge>
                            <span className="text-caption text-muted-foreground">{formatPrice(payment.amount)}</span>
                          </div>
                        ) : (
                          <span className="text-caption text-muted-foreground">No payment recorded</span>
                        )}
                      </td>
                      <td className="px-md py-sm text-body">{formatDate(row.createdAt)}</td>
                      <td className="px-md py-sm">
                        <div className="flex items-center justify-end gap-xxs">
                          {canMark && (
                            <>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`Mark ${row.user.name} attended`}
                                title="Mark attended"
                                disabled={attendanceMutation.isPending || row.status === "ATTENDED"}
                                onClick={() => markAttendance(row.id, "ATTENDED")}
                              >
                                <UserCheck aria-hidden />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`Mark ${row.user.name} no-show`}
                                title="Mark no-show"
                                disabled={attendanceMutation.isPending || row.status === "NO_SHOW"}
                                onClick={() => markAttendance(row.id, "NO_SHOW")}
                              >
                                <UserX aria-hidden />
                              </Button>
                            </>
                          )}
                          <Button size="xs" variant="outline" onClick={() => setOpenRegistrationId(row.id)}>
                            View
                          </Button>
                        </div>
                      </td>
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

      <DelegateDetailSheet
        munId={munId}
        registrationId={openRegistrationId}
        onClose={() => setOpenRegistrationId(null)}
        attendanceOpen={attendanceOpen}
        onMarkAttendance={markAttendance}
        attendancePending={attendanceMutation.isPending}
      />
    </>
  );
}
