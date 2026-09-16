import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listAdminAuditEntries } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

export function AdminAuditPage() {
  const [offset, setOffset] = useState(0);
  const params = { limit: PAGE_SIZE, offset };

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
                to={`/admin/audit/${entry.targetType}/${entry.targetId}`}
                className="font-medium text-link hover:text-link-active"
              >
                {entry.action}
              </Link>
              <p className="text-body-md text-muted-foreground">
                {entry.targetType}/{entry.targetId} · {entry.actorName} · {entry.createdAt.toLocaleString()}
              </p>
              {entry.reason && (
                <p className="mt-xxs text-body-md text-body">{entry.reason}</p>
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
