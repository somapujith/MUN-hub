import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardListIcon, LayersIcon, LifeBuoyIcon, AlertTriangleIcon, RocketIcon } from "lucide-react";
import { getAdminOverviewStats } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import type { AdminOverviewStats } from "@/types/admin-audit";

const CARD_DEFS: Array<{
  key: keyof AdminOverviewStats;
  label: string;
  href: string;
  icon: typeof ClipboardListIcon;
}> = [
  { key: "pendingApplications", label: "Pending Applications", href: "/admin/review", icon: ClipboardListIcon },
  { key: "pendingModuleReviews", label: "Pending Module Reviews", href: "/admin/verification", icon: LayersIcon },
  { key: "openSupportTickets", label: "Open Support Tickets", href: "/admin/support", icon: LifeBuoyIcon },
  { key: "paymentExceptions", label: "Payment Exceptions", href: "/admin/payments", icon: AlertTriangleIcon },
  { key: "goLiveQueue", label: "Go-live queue", href: "/admin/go-live-queue", icon: RocketIcon },
];

export function AdminOverviewPage() {
  const statsQuery = useQuery({
    queryKey: queryKeys.adminOverview(),
    queryFn: getAdminOverviewStats,
  });

  return (
    <AdminPageFrame
      title="Overview"
      description="Current depth of every operations queue."
    >
      {statsQuery.isLoading && (
        <p className="text-body-md text-muted-foreground">Loading overview...</p>
      )}
      {statsQuery.isError && (
        <p className="text-body-md text-destructive">
          {statsQuery.error instanceof Error ? statsQuery.error.message : "Unable to load overview"}
        </p>
      )}
      {statsQuery.data && (
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-5">
          {CARD_DEFS.map(({ key, label, href, icon: Icon }) => (
            <Link
              key={href}
              to={href}
              className="flex flex-col gap-sm rounded-md border border-border bg-card p-lg transition-colors hover:bg-surface-soft"
            >
              <Icon aria-hidden strokeWidth={1.75} className="size-5 text-muted-foreground" />
              <p className="text-body-md text-muted-foreground">{label}</p>
              <p className="font-display text-display-sm tabular-nums text-ink">
                {statsQuery.data[key]}
              </p>
            </Link>
          ))}
        </div>
      )}
    </AdminPageFrame>
  );
}
