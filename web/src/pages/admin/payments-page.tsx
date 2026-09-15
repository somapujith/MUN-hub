import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_PAYMENT_EXCEPTIONS } from "@/mocks/admin";

export function AdminPaymentsPage() {
  return (
    <AdminPageFrame title="Payments" description="Payment exceptions requiring manual review.">
      <ul className="flex flex-col gap-sm">
        {MOCK_PAYMENT_EXCEPTIONS.map((row) => (
          <li key={row.id} className="rounded-md border border-border bg-card p-md">
            <p className="font-medium text-ink">Registration {row.registrationId}</p>
            <p className="text-body-md text-muted-foreground">{row.reason}</p>
          </li>
        ))}
      </ul>
    </AdminPageFrame>
  );
}
