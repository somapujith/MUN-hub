import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listAdminAuditEntries, listAuditActors } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminSelectClassName } from "@/lib/admin/styles";
import { ACTION_TYPE_OPTIONS } from "@/lib/admin/audit-filters";

const PAGE_SIZE = 20;

/** Native date inputs give a local YYYY-MM-DD; the range endpoint wants full timestamps. */
function startOfDay(value: string): Date {
  return new Date(`${value}T00:00:00`);
}
function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999`);
}

export function AdminAuditPage() {
  const [offset, setOffset] = useState(0);
  // Staff reads of delegate data (one PII_READ row per list page load) would
  // bury the changes, so they are opt-in.
  const [includeDataAccess, setIncludeDataAccess] = useState(false);
  const [actorId, setActorId] = useState("");
  const [actionType, setActionType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const actorsQuery = useQuery({
    queryKey: queryKeys.adminAuditActors(),
    queryFn: listAuditActors,
  });
  const actors = actorsQuery.data ?? [];

  // PII_READ rows are left out of the feed entirely unless includeDataAccess
  // is on, so offering it as an action-type filter otherwise would always
  // return nothing.
  const actionTypeOptions = ACTION_TYPE_OPTIONS.filter(
    (option) => includeDataAccess || option.value !== "PII_READ",
  );

  const params = {
    limit: PAGE_SIZE,
    offset,
    includeDataAccess,
    actorId: actorId || undefined,
    actionType: actionType || undefined,
    from: from ? startOfDay(from) : undefined,
    to: to ? endOfDay(to) : undefined,
  };

  const auditQuery = useQuery({
    queryKey: queryKeys.adminAudit(params),
    queryFn: () => listAdminAuditEntries(params),
    placeholderData: (previous) => previous,
  });

  const results = auditQuery.data?.results ?? [];
  const total = auditQuery.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters = Boolean(actorId || actionType || from || to || includeDataAccess);
  const clearFilters = () => {
    setActorId("");
    setActionType("");
    setFrom("");
    setTo("");
    setIncludeDataAccess(false);
    setOffset(0);
  };

  return (
    <AdminPageFrame title="Audit log" description="Append-only audit trail across the platform.">
      <div className="flex flex-wrap items-end gap-md">
        <div className="flex flex-col gap-xs">
          <Label htmlFor="audit-actor">Actor</Label>
          <select
            id="audit-actor"
            className={adminSelectClassName}
            value={actorId}
            onChange={(event) => {
              setActorId(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">Any actor</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-xs">
          <Label htmlFor="audit-action-type">Action type</Label>
          <select
            id="audit-action-type"
            className={adminSelectClassName}
            value={actionType}
            onChange={(event) => {
              setActionType(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">Any action</option>
            {actionTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-xs">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            className="h-10 w-auto"
            value={from}
            max={to || undefined}
            onChange={(event) => {
              setFrom(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        <div className="flex flex-col gap-xs">
          <Label htmlFor="audit-to">To</Label>
          <Input
            id="audit-to"
            type="date"
            className="h-10 w-auto"
            value={to}
            min={from || undefined}
            onChange={(event) => {
              setTo(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        <div className="flex items-center gap-xs pb-[11px]">
          <Checkbox
            id="audit-include-data-access"
            checked={includeDataAccess}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setIncludeDataAccess(next);
              // A now-hidden PII_READ selection would silently filter on
              // whatever the browser falls back to; clear it instead.
              if (!next && actionType === "PII_READ") setActionType("");
              setOffset(0);
            }}
          />
          <label htmlFor="audit-include-data-access" className="text-body-md text-ink">
            Show staff reads of delegate data
          </label>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      {auditQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading audit log...</p>}
      {auditQuery.isError && (
        <p className="text-body-md text-destructive">
          {auditQuery.error instanceof Error ? auditQuery.error.message : "Unable to load audit log"}
        </p>
      )}
      {!auditQuery.isLoading && !auditQuery.isError && results.length === 0 && (
        <p className="text-body-md text-muted-foreground">No admin actions recorded yet.</p>
      )}
      {results.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {results.map((entry) => (
            <li key={entry.id} className="rounded-md border border-border bg-card p-md">
              <Link
                // A list read's target id is a route pattern ("GET /admin/..."), so both parts are encoded.
                to={`/admin/audit/${encodeURIComponent(entry.targetType)}/${encodeURIComponent(entry.targetId)}`}
                className="font-medium text-link hover:text-link-active break-words"
              >
                {entry.action}
              </Link>
              <p className="break-words text-body-md text-muted-foreground">
                {entry.targetType}/{entry.targetId} · {entry.actorName} · {entry.createdAt.toLocaleString()}
              </p>
              {entry.reason && (
                <p className="mt-xxs break-words text-body-md text-body">{entry.reason}</p>
              )}
            </li>
          ))}
        </ul>
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
              disabled={offset === 0 || auditQuery.isFetching}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft aria-hidden /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || auditQuery.isFetching}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </AdminPageFrame>
  );
}
