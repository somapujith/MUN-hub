import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { MOCK_GO_LIVE_QUEUE } from "@/mocks/admin";

const SLA_LABEL: Record<string, string> = {
  ON_TRACK: "On track",
  APPROACHING: "Approaching",
  DELAYED: "Delayed",
  PAUSED: "Paused",
  COMPLETED: "Completed",
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AdminGoLiveQueuePage() {
  const { results, total } = MOCK_GO_LIVE_QUEUE;

  return (
    <AdminPageFrame
      title="Go-live queue"
      description="MUNs approved for publish — SLA computed on read (mock getGoLiveQueue)."
    >
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[48rem] text-left text-body-md">
          <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
            <tr>
              <th className="px-md py-sm font-medium">MUN</th>
              <th className="px-md py-sm font-medium">Status</th>
              <th className="px-md py-sm font-medium">Submitted</th>
              <th className="px-md py-sm font-medium">SLA deadline</th>
              <th className="px-md py-sm font-medium">SLA state</th>
              <th className="px-md py-sm font-medium">Queued</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.submissionId} className="border-b border-border last:border-0">
                <td className="px-md py-sm font-medium text-ink">{row.munName}</td>
                <td className="px-md py-sm">
                  <MunStatusBadge status={row.munStatus} />
                </td>
                <td className="px-md py-sm text-muted-foreground">{formatDate(row.submittedAt)}</td>
                <td className="px-md py-sm text-muted-foreground">{formatDate(row.slaDeadline)}</td>
                <td className="px-md py-sm text-muted-foreground">{SLA_LABEL[row.slaState] ?? row.slaState}</td>
                <td className="px-md py-sm text-muted-foreground">{formatDate(row.queuedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border px-md py-sm text-body-md text-muted-foreground">
          {total} in queue (mock)
        </p>
      </div>
    </AdminPageFrame>
  );
}
