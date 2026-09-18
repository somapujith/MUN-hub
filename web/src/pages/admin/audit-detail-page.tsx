import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getAuditHistory } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";

export function AdminAuditDetailPage() {
  const { targetType = "", targetId = "" } = useParams();

  const historyQuery = useQuery({
    queryKey: queryKeys.adminAuditHistory(targetType, targetId),
    queryFn: () => getAuditHistory(targetType, targetId),
    enabled: Boolean(targetType && targetId),
  });

  const entries = historyQuery.data ?? [];

  return (
    <AdminPageFrame
      title="Audit detail"
      description={`Full history for ${targetType}/${targetId}, oldest first.`}
    >
      {historyQuery.isLoading && (
        <p className="text-body-md text-muted-foreground">Loading audit history...</p>
      )}
      {historyQuery.isError && (
        <p className="text-body-md text-destructive">
          {historyQuery.error instanceof Error ? historyQuery.error.message : "Unable to load audit history"}
        </p>
      )}
      {!historyQuery.isLoading && !historyQuery.isError && entries.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-card p-lg text-body-md text-muted-foreground">
          No recorded actions for this target.
        </div>
      )}
      {entries.length > 0 && (
        <ol className="flex flex-col gap-sm">
          {entries.map((entry, index) => (
            <li key={`${entry.action}-${entry.createdAt.toISOString()}-${index}`} className="rounded-md border border-border bg-card p-md">
              <p className="break-words font-medium text-ink">{entry.action}</p>
              <p className="break-words text-body-md text-muted-foreground">
                {entry.createdAt.toLocaleString()} · actor {entry.actorId}
              </p>
              {entry.reason && <p className="mt-xxs break-words text-body-md text-body">{entry.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </AdminPageFrame>
  );
}
