import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_VERIFICATION_QUEUE } from "@/mocks/admin";

export function AdminVerificationPage() {
  return (
    <AdminPageFrame
      title="Verification"
      description="Module-level verification console — pending review rows."
    >
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[32rem] text-left text-body-md">
          <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
            <tr>
              <th className="px-md py-sm font-medium">MUN</th>
              <th className="px-md py-sm font-medium">Module</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_VERIFICATION_QUEUE.results.map((row, i) => (
              <tr key={`${row.munId}-${row.moduleName}-${i}`} className="border-b border-border last:border-0">
                <td className="px-md py-sm text-ink">{row.munName}</td>
                <td className="px-md py-sm text-muted-foreground">{row.moduleName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border px-md py-sm text-body-md text-muted-foreground">
          {MOCK_VERIFICATION_QUEUE.total} pending (mock)
        </p>
      </div>
    </AdminPageFrame>
  );
}
