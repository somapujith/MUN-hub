import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FlagOffIcon,
  MailIcon,
  MoreHorizontalIcon,
  SearchIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  cancelRegistration,
  downloadRegistrationsCsv,
  flagRegistrationDuplicate,
  getRegistrationsQueue,
  resendRegistrationConfirmation,
  unflagRegistrationDuplicate,
} from "@/api/admin-registrations";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getRegistrationStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { adminSelectClassName } from "@/lib/admin/styles";
import { usePageClamp } from "@/lib/admin/use-page-clamp";
import type { AdminRegistrationRow } from "@/types/admin-registrations";
import type { RegistrationStatus } from "@/types/enums";

const PAGE_SIZE = 20;

// Same order conference-detail-page.tsx's own registration-count grid uses,
// so the two pages read as siblings.
const STATUS_OPTIONS: RegistrationStatus[] = [
  "CONFIRMED",
  "ATTENDED",
  "NO_SHOW",
  "PENDING",
  "PAYMENT_PENDING",
  "CANCELLED",
  "REFUNDED",
];

// Only a registration that was actually confirmed at some point has an
// honest "your registration is confirmed" email to resend — mirrors
// lib/actions/admin-review.ts's RESEND_ELIGIBLE_STATUSES.
const RESEND_ELIGIBLE_STATUSES = new Set<RegistrationStatus>(["CONFIRMED", "ATTENDED", "NO_SHOW"]);
const ALREADY_CANCELLED_STATUSES = new Set<RegistrationStatus>(["CANCELLED", "REFUNDED"]);

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    value,
  );
}

export function AdminRegistrationsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const status = (searchParams.get("status") as RegistrationStatus | null) ?? "";
  const munId = searchParams.get("munId") ?? "";

  const [searchInput, setSearchInput] = useState(urlQuery);
  const [page, setPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AdminRegistrationRow | null>(null);
  const [flagTarget, setFlagTarget] = useState<AdminRegistrationRow | null>(null);

  // Debounce typing into both the query that drives the fetch and the `?q=`
  // URL param — the admin console mock's page comment flagged real `?q=`
  // wiring as deferred; this makes the search state a real, shareable/
  // deep-linkable URL param instead of component-only state, while still
  // avoiding a fetch (and a history write) on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(0);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          const trimmed = searchInput.trim();
          if (trimmed) next.set("q", trimmed);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const setFilter = (key: "status" | "munId", value: string) => {
    setPage(0);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const q = urlQuery.trim();
  const params = useMemo(
    () => ({
      q: q || undefined,
      status: status || undefined,
      munId: munId || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [q, status, munId, page],
  );

  const registrationsQuery = useQuery({
    queryKey: queryKeys.adminRegistrations(params),
    queryFn: () => getRegistrationsQueue(params),
    placeholderData: (previous) => previous,
  });

  const invalidateAfterMutation = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.adminRegistrationsAll() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() }),
    ]);

  const cancelMutation = useMutation({
    mutationFn: ({ registrationId, reason }: { registrationId: string; reason: string }) =>
      cancelRegistration(registrationId, reason),
    onSuccess: async () => {
      await invalidateAfterMutation();
      setCancelTarget(null);
      toast.success("Registration cancelled");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to cancel this registration"),
  });

  const flagMutation = useMutation({
    mutationFn: ({ registrationId, reason }: { registrationId: string; reason: string }) =>
      flagRegistrationDuplicate(registrationId, reason),
    onSuccess: async () => {
      await invalidateAfterMutation();
      setFlagTarget(null);
      toast.success("Flagged as a duplicate");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to flag this registration"),
  });

  const unflagMutation = useMutation({
    mutationFn: (registrationId: string) => unflagRegistrationDuplicate(registrationId),
    onSuccess: async () => {
      await invalidateAfterMutation();
      toast.success("Duplicate flag cleared");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to clear the flag"),
  });

  const resendMutation = useMutation({
    mutationFn: (registrationId: string) => resendRegistrationConfirmation(registrationId),
    onSuccess: (result) => {
      if (result.sent) toast.success("Confirmation email resent");
      else toast.message("Not sent — this delegate has turned off optional email");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to resend the confirmation"),
  });

  const exportCsv = async () => {
    setIsExporting(true);
    try {
      await downloadRegistrationsCsv({ q: q || undefined, status: status || undefined, munId: munId || undefined });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export registrations");
    } finally {
      setIsExporting(false);
    }
  };

  const results = registrationsQuery.data?.results ?? [];
  const total = registrationsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE + results.length, total);
  const hasFilters = Boolean(q || status || munId);

  usePageClamp(Boolean(registrationsQuery.data), page, setPage, totalPages, (newPage) =>
    toast.message(`Moved to page ${newPage + 1} — no more results on the page you were viewing.`),
  );

  return (
    <>
      <Helmet title="Registrations" />
      <AdminPageFrame
        title="Registrations"
        description="Platform-wide registration search across every conference — by delegate name or email, MUN, or registration ID."
      >
        <div className="flex flex-wrap items-end justify-between gap-md">
          <div className="flex flex-wrap items-end gap-md">
            <div className="flex w-full max-w-md flex-col gap-xs">
              <label htmlFor="admin-registrations-search" className="text-body-md font-medium text-ink">
                Search
              </label>
              <div className="relative w-full">
                <SearchIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="admin-registrations-search"
                  type="search"
                  placeholder="Delegate name or email, MUN, or registration ID"
                  className="pl-xxl"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-xs">
              <label htmlFor="admin-registrations-status" className="text-body-md font-medium text-ink">
                Status
              </label>
              <select
                id="admin-registrations-status"
                className={adminSelectClassName}
                value={status}
                onChange={(event) => setFilter("status", event.target.value)}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {getRegistrationStatusMeta(option).label}
                  </option>
                ))}
              </select>
            </div>
            {munId && (
              <Button variant="outline" size="sm" onClick={() => setFilter("munId", "")}>
                <XIcon aria-hidden /> Clear MUN filter
              </Button>
            )}
          </div>
          <div className="flex items-center gap-md">
            <p className="text-body-md text-muted-foreground">
              {total === 0 ? "No registrations" : `${rangeStart}–${rangeEnd} of ${total}`}
            </p>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isExporting || total === 0}>
              <DownloadIcon aria-hidden /> {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        {registrationsQuery.isLoading && (
          <p className="text-body-md text-muted-foreground">Loading registrations...</p>
        )}
        {registrationsQuery.isError && (
          <p className="text-body-md text-destructive">
            {registrationsQuery.error instanceof Error
              ? registrationsQuery.error.message
              : "Unable to load registrations right now."}
          </p>
        )}

        {!registrationsQuery.isLoading && !registrationsQuery.isError && results.length === 0 && (
          <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
            <UsersRoundIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
            <p className="font-display text-title-md text-ink">
              {hasFilters ? "No registrations match these filters." : "No registrations yet."}
            </p>
            <p className="max-w-sm text-body-md text-muted-foreground">
              {hasFilters
                ? "Try a different name, MUN, registration ID or status."
                : "Registrations will show up here once delegates start signing up."}
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[58rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Delegate</th>
                  <th className="px-md py-sm font-medium">MUN</th>
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
                  const paymentMeta = row.paymentStatus ? getPaymentStatusMeta(row.paymentStatus) : null;
                  const canCancel = !ALREADY_CANCELLED_STATUSES.has(row.status);
                  const canResend = RESEND_ELIGIBLE_STATUSES.has(row.status);
                  const isFlagged = row.flaggedDuplicateAt !== null;
                  const rowBusy =
                    (cancelMutation.isPending && cancelMutation.variables?.registrationId === row.id) ||
                    (flagMutation.isPending && flagMutation.variables?.registrationId === row.id) ||
                    (unflagMutation.isPending && unflagMutation.variables === row.id) ||
                    (resendMutation.isPending && resendMutation.variables === row.id);
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-md py-sm">
                        <div className="flex flex-col gap-xxs">
                          <span className="flex items-center gap-xs font-medium text-ink">
                            {row.delegateName}
                            {isFlagged && (
                              <Badge variant="outline" className={getToneClassName("warning")}>
                                Duplicate
                              </Badge>
                            )}
                          </span>
                          <span className="text-caption text-muted-foreground">{row.delegateEmail}</span>
                        </div>
                      </td>
                      <td className="px-md py-sm text-body">
                        <Link to={`/admin/muns/${row.munId}`} className="text-link hover:underline">
                          {row.munName}
                        </Link>
                      </td>
                      <td className="px-md py-sm">
                        <RegistrationStatusChip status={row.status} />
                      </td>
                      <td className="px-md py-sm">
                        {paymentMeta ? (
                          <Badge variant="outline" className={getToneClassName(paymentMeta.tone)}>
                            {paymentMeta.label}
                          </Badge>
                        ) : (
                          <span className="text-caption text-muted-foreground">No payment recorded</span>
                        )}
                      </td>
                      <td className="px-md py-sm text-body">{formatDate(row.createdAt)}</td>
                      <td className="px-md py-sm text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="outline"
                                size="icon-sm"
                                disabled={rowBusy}
                                aria-label={`Actions for ${row.delegateName}'s registration`}
                              >
                                <MoreHorizontalIcon aria-hidden />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            {canCancel && (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setCancelTarget(row)}
                                nativeButton
                                render={<button type="button" />}
                              >
                                <BanIcon /> Cancel registration
                              </DropdownMenuItem>
                            )}
                            {isFlagged ? (
                              <DropdownMenuItem
                                onClick={() => unflagMutation.mutate(row.id)}
                                nativeButton
                                render={<button type="button" />}
                              >
                                <FlagOffIcon /> Clear duplicate flag
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setFlagTarget(row)}
                                nativeButton
                                render={<button type="button" />}
                              >
                                <CopyIcon /> Flag as duplicate
                              </DropdownMenuItem>
                            )}
                            {canResend && (
                              <DropdownMenuItem
                                onClick={() => resendMutation.mutate(row.id)}
                                nativeButton
                                render={<button type="button" />}
                              >
                                <MailIcon /> Resend confirmation
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-md border-t border-border px-md py-sm">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 0 || registrationsQuery.isFetching}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeftIcon aria-hidden /> Previous
                </Button>
                <p className="text-body-md tabular-nums text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages || registrationsQuery.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRightIcon aria-hidden />
                </Button>
              </div>
            )}
          </div>
        )}
      </AdminPageFrame>

      <ReasonDialog
        open={cancelTarget !== null}
        title="Cancel registration"
        description={
          cancelTarget
            ? `Cancel ${cancelTarget.delegateName}'s registration for ${cancelTarget.munName}? This releases the seat immediately. MUN Hub has no refunds — this does not touch any payment already taken.`
            : ""
        }
        confirmLabel="Cancel registration"
        pendingLabel="Cancelling..."
        isPending={cancelMutation.isPending}
        onConfirm={(reason) => {
          if (!cancelTarget) return;
          cancelMutation.mutate({ registrationId: cancelTarget.id, reason });
        }}
        onClose={() => setCancelTarget(null)}
      />

      <ReasonDialog
        open={flagTarget !== null}
        title="Flag as duplicate"
        description={
          flagTarget
            ? `Mark ${flagTarget.delegateName}'s registration for ${flagTarget.munName} as a suspected duplicate. This is a visible marker only — it does not cancel the registration.`
            : ""
        }
        confirmLabel="Flag as duplicate"
        pendingLabel="Flagging..."
        isPending={flagMutation.isPending}
        onConfirm={(reason) => {
          if (!flagTarget) return;
          flagMutation.mutate({ registrationId: flagTarget.id, reason });
        }}
        onClose={() => setFlagTarget(null)}
      />
    </>
  );
}
