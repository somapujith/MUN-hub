import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listAdminAuditEntries } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const PAGE_SIZE = 20;

export function AdminAuditPage() {
  const [offset, setOffset] = useState(0);
  // Staff reads of delegate data (one PII_READ row per list page load) would
  // bury the changes, so they are opt-in.
  const [includeDataAccess, setIncludeDataAccess] = useState(false);
  const params = { limit: PAGE_SIZE, offset, includeDataAccess };

  const auditQuery = useQuery({
    queryKey: queryKeys.adminAudit(params),
    queryFn: () => listAdminAuditEntries(params),
    placeholderData: (previous) => previous,
  });

  const results = auditQuery.data?.results ?? [];
  const total = auditQuery.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminPageFrame title="Audit log" description="Append-only audit trail across the platform.">
      <div className="flex items-center gap-xs">
        <Checkbox
          id="audit-include-data-access"
          checked={includeDataAccess}
          onCheckedChange={(checked) => {
            setIncludeDataAccess(checked === true);
            setOffset(0);
          }}
        />
        <label htmlFor="audit-include-data-access" className="text-body-md text-ink">
          Show staff reads of delegate data
        </label>
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
