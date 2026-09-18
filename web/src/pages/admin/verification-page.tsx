import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { getModuleReviewQueue } from "@/api/module-verification";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MODULE_LABELS } from "@/lib/admin/module-labels";
import { adminSelectClassName } from "@/lib/admin/styles";
import { usePageClamp } from "@/lib/admin/use-page-clamp";
import type { ModuleVerificationState } from "@/types/enums";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<{ value: ModuleVerificationState; label: string }> = [
  { value: "PENDING_REVIEW", label: "Pending review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "CHANGES_REQUESTED", label: "Changes requested" },
  { value: "REJECTED", label: "Rejected" },
  { value: "NOT_SUBMITTED", label: "Not submitted" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Gate 2 — MUN-content review ("is this MUN's content correct enough to
 * publish"), at module granularity. Wraps `getModuleReviewQueue` /
 * `reviewModule` (lib/lifecycle/module-verification.ts). This is NEVER the
 * organizer-application approval gate — see `AdminReviewPage` for that
 * (Gate 1, whole-mun, a completely different table and action). A module
 * `VERIFIED` decision here can auto-advance the mun's overall status once
 * every required module has passed (`checkAllModulesVerified`), but this
 * page never touches `muns.status` directly.
 *
 * The actual decision (with the submitted content to review) is made on the
 * MUN's own page — "Review module" below deep-links to
 * `/admin/muns/:munId#module-:moduleName`, which auto-expands that module's
 * row in ModulesSection (conference-detail-page.tsx) and shows the same
 * decision form (`ModuleReviewForm`) inline, next to what the organizer
 * actually submitted. This page stays a flat, filterable queue.
 */
export function AdminVerificationPage() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<ModuleVerificationState>("PENDING_REVIEW");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = { status, q: search || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const queueQuery = useQuery({
    queryKey: queryKeys.adminModuleReviewQueue(params),
    queryFn: () => getModuleReviewQueue(params),
    placeholderData: (previous) => previous,
  });

  const results = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  usePageClamp(Boolean(queueQuery.data), page, setPage, totalPages, (newPage) =>
    toast.message(`Moved to page ${newPage + 1} — no more results on the page you were viewing.`),
  );

  return (
    <AdminPageFrame
      title="Verification"
      description="Gate 2 — module-level content-verification console. Deciding here checks whether one part of a MUN's content is accurate enough to publish; it does not decide whether the organizer is approved to run a MUN (see Applications)."
    >
      <div className="flex flex-wrap items-end gap-md">
        <div className="flex w-full max-w-md flex-col gap-xs">
          <label htmlFor="verification-search" className="text-body-md font-medium text-ink">
            Search
          </label>
          <div className="relative w-full">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="verification-search"
              type="search"
              placeholder="MUN name"
              className="pl-xxl"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="verification-status">Status</Label>
          <select
            id="verification-status"
            className={adminSelectClassName}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ModuleVerificationState);
              setPage(0);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-body-md text-muted-foreground">
          {total === 0 ? "No modules" : `${total} module${total === 1 ? "" : "s"}`}
        </p>
      </div>

      {queueQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : queueQuery.isError ? (
        <p className="text-body-md text-destructive">
          {queueQuery.error instanceof Error
            ? queueQuery.error.message
            : "Unable to load the verification queue right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <ShieldCheckIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">
            {status === "PENDING_REVIEW" ? "No modules pending review." : "No modules match."}
          </p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            {search
              ? "Try a different MUN name."
              : status === "PENDING_REVIEW"
                ? "Modules land here once an organizer confirms them for review."
                : "Try a different status."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[40rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">MUN</th>
                <th className="px-md py-sm font-medium">Module</th>
                <th className="px-md py-sm font-medium">Confirmed</th>
                <th className="px-md py-sm font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-md py-sm font-medium text-ink">{row.munName}</td>
                  <td className="px-md py-sm text-muted-foreground">{MODULE_LABELS[row.moduleName] ?? row.moduleName}</td>
                  <td className="px-md py-sm tabular-nums text-muted-foreground">
                    {formatDate(row.organizerConfirmedAt)}
                  </td>
                  <td className="px-md py-sm text-right">
                    <Button variant="outline" size="sm" render={<Link to={`/admin/muns/${row.munId}#module-${row.moduleName}`} />}>
                      Review module
                    </Button>
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
