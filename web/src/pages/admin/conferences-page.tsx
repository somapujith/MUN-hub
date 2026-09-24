import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { LandmarkIcon, SearchIcon } from "lucide-react";
import { listAdminMuns } from "@/api/admin-muns";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAdminDateRange } from "@/lib/admin/go-live-labels";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { adminSelectClassName } from "@/lib/admin/styles";
import { getStatusMeta } from "@/lib/mun-status";
import type { MunStatus } from "@/types/enums";

const PAGE_SIZE = 20;

// Lifecycle order, so the filter reads like the pipeline.
const STATUS_OPTIONS: MunStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
  "ONBOARDING",
  "ACTION_REQUIRED",
  "READY_FOR_SUBMISSION",
  "CONTENT_SUBMITTED",
  "AUTOMATED_VALIDATION",
  "ORGANIZER_CONFIRMATION",
  "VERIFICATION",
  "VERIFIED",
  "GO_LIVE_QUEUE",
  "PUBLISHING",
  "PUBLISHED",
  "UNPUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "RESULTS_PENDING",
  "RESULTS_UNDER_REVIEW",
  "COMPLETED",
  "ARCHIVED",
  "SUSPENDED",
  "CANCELLED",
  "REJECTED",
];

function isMunStatus(value: string | null): value is MunStatus {
  return value !== null && (STATUS_OPTIONS as string[]).includes(value);
}

/**
 * Every MUN on the platform, whatever its status — search by MUN name, slug,
 * or organizer name/email, filter by status. Search and filter live in the
 * URL so a filtered view can be shared.
 */
export function AdminConferencesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const rawStatus = searchParams.get("status");
  const status = isMunStatus(rawStatus) ? rawStatus : undefined;
  // Drill-down from the Organizers console's per-organizer MUN count/link
  // (see organizers-page.tsx). `organizerName` is display-only — it's never
  // sent to the API, just used to label the filter chip below without an
  // extra round-trip.
  const organizerId = searchParams.get("organizerId") ?? undefined;
  const organizerName = searchParams.get("organizerName") ?? undefined;

  const [searchInput, setSearchInput] = useState(urlQuery);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed === urlQuery) return;
      setPage(0);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (trimmed) next.set("q", trimmed);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, urlQuery, setSearchParams]);

  const params = useMemo(
    () => ({ q: urlQuery || undefined, status, organizerId, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [urlQuery, status, organizerId, page],
  );

  const munsQuery = useQuery({
    queryKey: adminQueryKeys.muns(params),
    queryFn: () => listAdminMuns(params),
    placeholderData: (previous) => previous,
  });

  const results = munsQuery.data?.results ?? [];
  const total = munsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(urlQuery || status || organizerId);

  const clearOrganizerFilter = () => {
    setPage(0);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("organizerId");
        next.delete("organizerName");
        return next;
      },
      { replace: true },
    );
  };

  return (
    <AdminPageFrame
      title="Conferences"
      description="Every MUN on the platform, at any stage. Open one to see its review state, modules, payment account and history."
    >
      <div className="flex flex-wrap items-end gap-md">
        <div className="flex w-full max-w-sm flex-col gap-xs">
          <Label htmlFor="conference-search">Search</Label>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="conference-search"
              type="search"
              placeholder="MUN name, slug, organizer name or email"
              className="pl-xxl"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="conference-status">Status</Label>
          <select
            id="conference-status"
            className={adminSelectClassName}
            value={status ?? ""}
            onChange={(event) => {
              setPage(0);
              setSearchParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  if (event.target.value) next.set("status", event.target.value);
                  else next.delete("status");
                  return next;
                },
                { replace: true },
              );
            }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {getStatusMeta(option).label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-body-md tabular-nums text-muted-foreground sm:ml-auto" aria-live="polite">
          {munsQuery.isLoading ? "Loading…" : `${total} ${total === 1 ? "conference" : "conferences"}`}
        </p>
      </div>

      {organizerId && (
        <div className="flex items-center gap-xs">
          <Badge variant="secondary">
            Organizer: {organizerName ?? "filtered"}
          </Badge>
          <Button variant="link" size="sm" className="h-auto w-fit p-0" onClick={clearOrganizerFilter}>
            Clear
          </Button>
        </div>
      )}

      {munsQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : munsQuery.isError ? (
        <p className="text-body-md text-destructive">
          {munsQuery.error instanceof Error ? munsQuery.error.message : "Unable to load conferences right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <LandmarkIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">
            {filtered ? "No conferences match." : "No conferences yet."}
          </p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            {filtered
              ? "Try a different search or status."
              : "A MUN appears here as soon as an organizer applies to host it."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[56rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">Conference</th>
                <th className="px-md py-sm font-medium">Organizer</th>
                <th className="px-md py-sm font-medium">Status</th>
                <th className="px-md py-sm font-medium">Dates</th>
                <th className="px-md py-sm text-right font-medium">Registrations</th>
              </tr>
            </thead>
            <tbody>
              {results.map((mun) => (
                <tr key={mun.id} className="border-b border-border align-top last:border-0">
                  <td className="px-md py-sm">
                    <Link to={`/admin/muns/${mun.id}`} className="font-medium text-link hover:text-link-active">
                      {mun.name}
                    </Link>
                    <p className="text-body-md text-muted-foreground">
                      {mun.slug}
                      {mun.city ? ` · ${mun.city}` : ""}
                    </p>
                  </td>
                  <td className="px-md py-sm">
                    <p className="text-ink">{mun.organizerName}</p>
                    <p className="text-body-md break-all text-muted-foreground">{mun.organizerEmail}</p>
                  </td>
                  <td className="px-md py-sm">
                    <MunStatusBadge status={mun.status} />
                  </td>
                  <td className="px-md py-sm whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatAdminDateRange(mun.startDate, mun.endDate)}
                  </td>
                  <td className="px-md py-sm text-right tabular-nums">
                    <span className="font-medium text-ink">{mun.seatedRegistrations}</span>
                    <span className="text-muted-foreground"> confirmed</span>
                    {mun.pendingRegistrations > 0 && (
                      <p className="text-body-md text-muted-foreground">{mun.pendingRegistrations} pending</p>
                    )}
                  </td>
                </tr>
              ))}
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
  );
}
