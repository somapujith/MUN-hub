import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { BarChart3 } from "lucide-react";
import { useParams } from "react-router";
import { getMunAnalytics } from "@/api/mun-analytics";
import { queryKeys } from "@/api/query-keys";
import { formatPrice } from "@/components/shared/currency";
import { WorkspacePage } from "@/components/organizer/workspace-page";

export function OrganizerAnalyticsPage() {
  const { munId = "" } = useParams();
  const analyticsQuery = useQuery({
    queryKey: queryKeys.munAnalytics(munId),
    queryFn: () => getMunAnalytics(munId),
    enabled: Boolean(munId),
  });

  const analytics = analyticsQuery.data;
  const products = analytics?.products ?? [];

  return (
    <>
      <Helmet title="Analytics" />
      <WorkspacePage
        title="Analytics"
        description="Registration counts and revenue by registration pass."
      >
        {analyticsQuery.isLoading && (
          <p className="text-body-md text-muted-foreground">Loading analytics...</p>
        )}
        {analyticsQuery.isError && (
          <p className="text-body-md text-destructive">{analyticsQuery.error.message}</p>
        )}
        {analytics && (
          <>
            <div className="grid grid-cols-2 gap-sm lg:grid-cols-3">
              {[
                { label: "Confirmed registrations", value: analytics.totalRegistrations.toLocaleString("en-IN") },
                { label: "Revenue collected", value: formatPrice(analytics.totalRevenue) },
                { label: "Registration passes", value: products.length.toLocaleString("en-IN") },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-border bg-card p-md">
                  <p className="text-body-md text-muted-foreground">{stat.label}</p>
                  <p className="font-display text-title-lg tabular-nums text-ink">{stat.value}</p>
                </div>
              ))}
            </div>

            <section aria-label="Revenue by registration pass" className="flex flex-col gap-md">
              <h2 className="font-display text-title-md text-ink">By registration pass</h2>
              {products.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                  <BarChart3 className="mx-auto size-8 text-muted-foreground" aria-hidden />
                  <h3 className="mt-md font-display text-title-sm text-ink">No registration passes yet</h3>
                  <p className="mt-xs text-body-md text-muted-foreground">
                    Add a registration pass under Products to start seeing analytics here.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-left text-body-md">
                    <thead className="border-b border-border bg-surface-soft/60">
                      <tr>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Pass</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Price</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Capacity</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Confirmed</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Fill rate</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => {
                        const fillRate = product.capacity > 0
                          ? Math.round((product.registrationCount / product.capacity) * 100)
                          : 0;
                        return (
                          <tr key={product.productId} className="border-b border-border last:border-0">
                            <td className="px-md py-sm text-ink">{product.productName}</td>
                            <td className="px-md py-sm tabular-nums text-body">{formatPrice(product.price)}</td>
                            <td className="px-md py-sm tabular-nums text-body">{product.capacity}</td>
                            <td className="px-md py-sm tabular-nums text-body">{product.registrationCount}</td>
                            <td className="px-md py-sm tabular-nums text-body">{fillRate}%</td>
                            <td className="px-md py-sm tabular-nums text-ink">{formatPrice(product.revenue)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-caption text-muted-foreground">
              Counts include CONFIRMED and ATTENDED registrations only; revenue includes PAID payments only.
            </p>
          </>
        )}
      </WorkspacePage>
    </>
  );
}
