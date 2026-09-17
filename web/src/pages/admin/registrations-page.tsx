import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, UsersRoundIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import { getRegistrationsQueue } from "@/api/admin-registrations";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 20;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    value,
  );
}

export function AdminRegistrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [searchInput, setSearchInput] = useState(urlQuery);
  const [page, setPage] = useState(0);

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

  const q = urlQuery.trim();
  const params = useMemo(
    () => ({ q: q || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [q, page],
  );

  const registrationsQuery = useQuery({
    queryKey: ["admin", "registrations", params],
    queryFn: () => getRegistrationsQueue(params),
    placeholderData: (previous) => previous,
  });

  const results = registrationsQuery.data?.results ?? [];
  const total = registrationsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE + results.length, total);

  return (
    <>
      <Helmet title="Registrations" />
      <AdminPageFrame
        title="Registrations"
        description="Platform-wide registration search across every conference — by delegate name or email, MUN, or registration ID."
      >
        <div className="flex flex-wrap items-end justify-between gap-md">
          <div className="flex flex-col gap-xs">
            <label htmlFor="admin-registrations-search" className="text-body-md font-medium text-ink">
              Search
            </label>
            <div className="relative w-full max-w-sm">
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
          <p className="text-body-md text-muted-foreground">
            {total === 0 ? "No registrations" : `${rangeStart}–${rangeEnd} of ${total}`}
          </p>
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
              {q ? "No registrations match that search." : "No registrations yet."}
            </p>
            <p className="max-w-sm text-body-md text-muted-foreground">
              {q ? "Try a different name, MUN, or registration ID." : "Registrations will show up here once delegates start signing up."}
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[52rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Delegate</th>
                  <th className="px-md py-sm font-medium">MUN</th>
                  <th className="px-md py-sm font-medium">Status</th>
                  <th className="px-md py-sm font-medium">Payment</th>
                  <th className="px-md py-sm font-medium">Registered</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const paymentMeta = row.paymentStatus ? getPaymentStatusMeta(row.paymentStatus) : null;
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-md py-sm">
                        <div className="flex flex-col">
                          <span className="font-medium text-ink">{row.delegateName}</span>
                          <span className="text-caption text-muted-foreground">{row.delegateEmail}</span>
                        </div>
                      </td>
                      <td className="px-md py-sm text-body">{row.munName}</td>
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
    </>
  );
}
