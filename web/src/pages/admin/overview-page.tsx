import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardListIcon, LayersIcon, LifeBuoyIcon, AlertTriangleIcon, RocketIcon } from "lucide-react";
import { getAdminAnalytics } from "@/api/admin-analytics";
import { getAdminOverviewStats } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { getRegistrationStatusMeta } from "@/components/dashboard/registration-status";
import { Skeleton } from "@/components/ui/skeleton";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import type { AdminAnalytics, RevenueByCurrency } from "@/types/admin-analytics";
import type { AdminOverviewStats } from "@/types/admin-audit";
import type { RegistrationStatus } from "@/types/enums";

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

const REGISTRATION_ORDER: RegistrationStatus[] = [
  "CONFIRMED",
  "ATTENDED",
  "NO_SHOW",
  "PENDING",
  "PAYMENT_PENDING",
  "CANCELLED",
  "REFUNDED",
];

const statLabelClassName = "text-body-md text-muted-foreground";
// Standalone headline values use proportional figures; tabular-nums is for columns.
const statValueClassName = "font-display text-display-md font-medium text-ink";

const compactNumber = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

function formatMoney(amount: number, currency: string, compact: boolean): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(amount);
  } catch {
    // Not an ISO 4217 code Intl knows.
    return `${currency} ${compact ? compactNumber.format(amount) : amount.toLocaleString("en-IN")}`;
  }
}

/** INR first (the platform's currency), then any others by GMV. */
function primaryRevenue(revenue: RevenueByCurrency[]): { primary: RevenueByCurrency; others: RevenueByCurrency[] } {
  const inr = revenue.find((row) => row.currency === "INR");
  const primary = inr ?? revenue[0] ?? {
    currency: "INR",
    gmv: 0,
    platformFeeTotal: 0,
    paidPayments: 0,
    paidPaymentsWithoutFeeBreakdown: 0,
  };
  return { primary, others: revenue.filter((row) => row !== primary) };
}

function StatTile({ label, value, title, note }: { label: string; value: string; title?: string; note?: string }) {
  return (
    <div className="flex flex-col gap-xxs rounded-md border border-border bg-card p-lg">
      <dt className={statLabelClassName}>{label}</dt>
      <dd className={statValueClassName} title={title}>
        {value}
      </dd>
      {note && <dd className="text-body-md text-muted-foreground">{note}</dd>}
    </div>
  );
}

function PlatformActivity({ analytics }: { analytics: AdminAnalytics }) {
  const { primary, others } = primaryRevenue(analytics.revenue);
  const totalRegistrations = REGISTRATION_ORDER.reduce(
    (sum, status) => sum + (analytics.registrationsByStatus[status] ?? 0),
    0,
  );
  const missingFees = primary.paidPaymentsWithoutFeeBreakdown;

  return (
    <div className="flex flex-col gap-md">
      <dl className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Gross merchandise value"
          value={formatMoney(primary.gmv, primary.currency, true)}
          title={formatMoney(primary.gmv, primary.currency, false)}
          note={`${primary.paidPayments.toLocaleString("en-IN")} paid ${primary.paidPayments === 1 ? "payment" : "payments"}${
            others.length > 0
              ? ` · also ${others.map((row) => formatMoney(row.gmv, row.currency, true)).join(", ")}`
              : ""
          }`}
        />
        <StatTile
          label="Platform fees"
          value={formatMoney(primary.platformFeeTotal, primary.currency, true)}
          title={formatMoney(primary.platformFeeTotal, primary.currency, false)}
          note={
            missingFees > 0
              ? `Excludes ${missingFees} older ${missingFees === 1 ? "payment" : "payments"} with no fee breakdown`
              : "Across all paid payments"
          }
        />
        <StatTile
          label="Live conferences"
          value={compactNumber.format(analytics.liveMuns)}
          note="Published, registering or running"
        />
        <StatTile
          label="New organizers"
          value={compactNumber.format(analytics.newOrganizersLast7Days)}
          note="Signed up in the last 7 days"
        />
      </dl>

      <section className="flex flex-col gap-sm rounded-md border border-border bg-card p-lg" aria-labelledby="registrations-by-status">
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <h3 id="registrations-by-status" className="text-body-md font-medium text-ink">
            Registrations by status
          </h3>
          <p className="text-body-md text-muted-foreground">{totalRegistrations.toLocaleString("en-IN")} in total</p>
        </div>
        <dl className="grid grid-cols-2 gap-md sm:grid-cols-4 lg:grid-cols-7">
          {REGISTRATION_ORDER.map((status) => (
            <div key={status} className="flex flex-col gap-0.5">
              <dt className={statLabelClassName}>{getRegistrationStatusMeta(status).label}</dt>
              <dd className="font-display text-title-lg text-ink">
                {(analytics.registrationsByStatus[status] ?? 0).toLocaleString("en-IN")}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export function AdminOverviewPage() {
  const statsQuery = useQuery({
    queryKey: queryKeys.adminOverview(),
    queryFn: getAdminOverviewStats,
  });

  const analyticsQuery = useQuery({
    queryKey: adminQueryKeys.analytics(),
    queryFn: getAdminAnalytics,
  });

  return (
    <AdminPageFrame
      title="Overview"
      description="Current depth of every operations queue, and platform activity."
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
              {/* text-display-sm was never a token, so these rendered at body size. */}
              <p className="font-display text-display-md text-ink">
                {statsQuery.data[key]}
              </p>
            </Link>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-md" aria-labelledby="platform-activity">
        <h2 id="platform-activity" className="font-display text-title-md text-ink">
          Platform activity
        </h2>
        {analyticsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : analyticsQuery.isError ? (
          <p className="text-body-md text-destructive">
            {analyticsQuery.error instanceof Error ? analyticsQuery.error.message : "Unable to load platform activity"}
          </p>
        ) : analyticsQuery.data ? (
          <PlatformActivity analytics={analyticsQuery.data} />
        ) : null}
      </section>
    </AdminPageFrame>
  );
}
