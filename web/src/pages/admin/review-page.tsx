import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_REVIEW_QUEUE } from "@/mocks/admin";

export function AdminReviewPage() {
  return (
    <AdminPageFrame
      title="Applications"
      description="Gate 1 — organizer application approval queue."
    >
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[32rem] text-left text-body-md">
          <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
            <tr>
              <th className="px-md py-sm font-medium">Organization</th>
              <th className="px-md py-sm font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_REVIEW_QUEUE.results.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-md py-sm text-ink">{row.name}</td>
                <td className="px-md py-sm text-muted-foreground">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border px-md py-sm text-body-md text-muted-foreground">
          {MOCK_REVIEW_QUEUE.total} total (mock)
        </p>
      </div>
    </AdminPageFrame>
  );
}
