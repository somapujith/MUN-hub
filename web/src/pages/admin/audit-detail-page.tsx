import { useParams } from "react-router";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";

export function AdminAuditDetailPage() {
  const { targetType = "", targetId = "" } = useParams();

  return (
    <AdminPageFrame
      title="Audit detail"
      description={`Target ${targetType}/${targetId} — mock detail shell.`}
    >
      <div className="rounded-md border border-dashed border-border bg-card p-lg text-body-md text-muted-foreground">
        Full audit history for this target will load from the API in Phase 6.3.
      </div>
    </AdminPageFrame>
  );
}
