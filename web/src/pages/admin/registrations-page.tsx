import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_REGISTRATIONS } from "@/mocks/admin";

export function AdminRegistrationsPage() {
  return (
    <AdminPageFrame title="Registrations" description="Cross-MUN registration search (mock ?q= wiring deferred).">
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[40rem] text-left text-body-md">
          <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
            <tr>
              <th className="px-md py-sm font-medium">Delegate</th>
              <th className="px-md py-sm font-medium">MUN</th>
              <th className="px-md py-sm font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_REGISTRATIONS.results.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-md py-sm text-ink">{row.delegateName}</td>
                <td className="px-md py-sm text-muted-foreground">{row.munName}</td>
                <td className="px-md py-sm text-muted-foreground">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPageFrame>
  );
}
