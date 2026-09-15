import { Link } from "react-router";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_AUDIT_ENTRIES } from "@/mocks/admin";

export function AdminAuditPage() {
  return (
    <AdminPageFrame title="Audit log" description="Append-only audit trail across the platform.">
      <ul className="flex flex-col gap-sm">
        {MOCK_AUDIT_ENTRIES.map((entry) => (
          <li key={entry.id} className="rounded-md border border-border bg-card p-md">
            <Link
              to={`/admin/audit/${entry.targetType}/${entry.targetId}`}
              className="font-medium text-link hover:text-link-active"
            >
              {entry.action}
            </Link>
            <p className="text-body-md text-muted-foreground">
              {entry.targetType}/{entry.targetId} · {entry.at.toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </AdminPageFrame>
  );
}
