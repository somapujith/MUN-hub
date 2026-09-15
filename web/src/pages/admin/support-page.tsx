import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_SUPPORT_TICKETS } from "@/mocks/admin";

export function AdminSupportPage() {
  return (
    <AdminPageFrame title="Support" description="Delegate and organizer support tickets.">
      <ul className="flex flex-col gap-sm">
        {MOCK_SUPPORT_TICKETS.map((ticket) => (
          <li key={ticket.id} className="rounded-md border border-border bg-card p-md">
            <p className="font-medium text-ink">{ticket.subject}</p>
            <p className="text-body-md text-muted-foreground">{ticket.status}</p>
          </li>
        ))}
      </ul>
    </AdminPageFrame>
  );
}
