import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  getConversionFunnel,
  getGeographyBreakdown,
  getOrganizerLeaderboard,
  getPlatformFeeSummary,
  getReportingTrends,
  getTopConferences,
} from "@/api/admin-reporting";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import {
  ChartEmptyState,
  FunnelStage,
  RankedBarList,
  TrendLineChart,
  type RankedListItem,
} from "@/components/admin/reporting-charts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { REPORTING_RANGE_DAYS, type ReportingRangeDays, type TrendGranularity } from "@/types/admin-reporting";

const compactNumber = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });

function formatMoney(amount: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${compact ? compactNumber.format(amount) : amount.toLocaleString("en-IN")}`;
  }
}

function formatBucketLabel(bucket: string): string {
  const date = new Date(`${bucket}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  getLabel,
  "aria-label": ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (option: T) => string;
  "aria-label": string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex gap-2xs rounded-sm border border-border bg-card p-2xs">
      {options.map((option) => (
        <Button
          key={String(option)}
          type="button"
          size="sm"
          variant={option === value ? "default" : "ghost"}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {getLabel(option)}
        </Button>
      ))}
    </div>
  );
}

function SectionFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-md rounded-md border border-border bg-card p-lg" aria-label={title}>
      <div className="flex flex-col gap-xxs">
        <h2 className="font-display text-title-md text-ink">{title}</h2>
        {description && <p className="text-body-md text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function QueryState({
  isLoading,
  isError,
  error,
  skeletonHeight = "h-48",
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  skeletonHeight?: string;
}) {
  if (isLoading) return <Skeleton className={`w-full ${skeletonHeight}`} />;
  if (isError) {
    return (
      <p className="text-body-md text-destructive">
        {error instanceof Error ? error.message : "Unable to load this data."}
      </p>
    );
  }
  return null;
}

export function AdminReportingPage() {
  const [days, setDays] = useState<ReportingRangeDays>(30);
  const [granularity, setGranularity] = useState<TrendGranularity>("day");

  const rangeParams = useMemo(() => ({ days }), [days]);
  const trendsParams = useMemo(() => ({ days, granularity }), [days, granularity]);

  const trendsQuery = useQuery({
    queryKey: adminQueryKeys.reportingTrends(trendsParams),
    queryFn: () => getReportingTrends(trendsParams),
  });
  const funnelQuery = useQuery({
    queryKey: adminQueryKeys.reportingFunnel(rangeParams),
    queryFn: () => getConversionFunnel(rangeParams),
  });
  const topConferencesQuery = useQuery({
    queryKey: adminQueryKeys.reportingTopConferences(rangeParams),
    queryFn: () => getTopConferences(rangeParams),
  });
  const organizersQuery = useQuery({
    queryKey: adminQueryKeys.reportingOrganizers(rangeParams),
    queryFn: () => getOrganizerLeaderboard(rangeParams),
  });
  const geographyQuery = useQuery({
    queryKey: adminQueryKeys.reportingGeography(rangeParams),
    queryFn: () => getGeographyBreakdown(rangeParams),
  });
  const feesQuery = useQuery({
    queryKey: adminQueryKeys.reportingFees(rangeParams),
    queryFn: () => getPlatformFeeSummary(rangeParams),
  });

  const topConferencesByRegistrations: RankedListItem[] = (topConferencesQuery.data?.byRegistrations ?? []).map((row) => ({
    id: row.munId,
    label: row.name,
    value: row.value,
  }));
  const topConferencesByRevenue: RankedListItem[] = (topConferencesQuery.data?.byRevenue ?? []).map((row) => ({
    id: row.munId,
    label: row.name,
    value: row.value,
  }));
  const organizersByPublished: RankedListItem[] = (organizersQuery.data?.byConferencesPublished ?? []).map((row) => ({
    id: row.organizerId,
    label: row.name,
    sublabel: row.email,
    value: row.value,
  }));
  const organizersByRevenue: RankedListItem[] = (organizersQuery.data?.byRevenue ?? []).map((row) => ({
    id: row.organizerId,
    label: row.name,
    sublabel: row.email,
    value: row.value,
  }));

  return (
    <>
      <Helmet title="Analytics" />
      <AdminPageFrame
        title="Analytics"
        description="Trends, conversion, and revenue across the platform — see the Overview page for current queue depths."
      >
        <div className="flex flex-wrap items-center justify-between gap-md">
          <p className="text-body-md text-muted-foreground">Range applies to every section below.</p>
          <SegmentedControl
            aria-label="Date range"
            options={REPORTING_RANGE_DAYS}
            value={days}
            onChange={setDays}
            getLabel={(option) => `${option}d`}
          />
        </div>

        <SectionFrame title="Trends" description="Registrations, revenue and signups, bucketed by day or week.">
          <div className="flex justify-end">
            <SegmentedControl
              aria-label="Trend granularity"
              options={["day", "week"] as const}
              value={granularity}
              onChange={setGranularity}
              getLabel={(option) => (option === "day" ? "Daily" : "Weekly")}
            />
          </div>

          <QueryState isLoading={trendsQuery.isLoading} isError={trendsQuery.isError} error={trendsQuery.error} />
          {trendsQuery.data && (
            <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
              <div className="flex flex-col gap-xs">
                <h3 className="text-body-md font-medium text-ink">Registrations</h3>
                <TrendLineChart
                  title="Registrations per bucket"
                  formatBucket={formatBucketLabel}
                  series={[
                    { key: "registrations", label: "Registrations", colorToken: "chart-1", points: trendsQuery.data.registrations },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-xs">
                <h3 className="text-body-md font-medium text-ink">Revenue collected</h3>
                <TrendLineChart
                  title="Revenue per bucket"
                  formatBucket={formatBucketLabel}
                  formatValue={(value) => formatMoney(value, "INR", true)}
                  series={[
                    { key: "gross", label: "Gross", colorToken: "chart-2", points: trendsQuery.data.revenue.gross },
                    { key: "net", label: "Net of fee", colorToken: "chart-3", points: trendsQuery.data.revenue.net },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-xs">
                <h3 className="text-body-md font-medium text-ink">New signups</h3>
                <TrendLineChart
                  title="Signups per bucket"
                  formatBucket={formatBucketLabel}
                  series={[
                    { key: "organizers", label: "Organizers", colorToken: "chart-4", points: trendsQuery.data.signups.organizers },
                    { key: "delegates", label: "Delegates", colorToken: "chart-5", points: trendsQuery.data.signups.delegates },
                  ]}
                />
              </div>
            </div>
          )}
        </SectionFrame>

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <SectionFrame title="Registration funnel" description="Of registrations started in this range.">
            <QueryState isLoading={funnelQuery.isLoading} isError={funnelQuery.isError} error={funnelQuery.error} skeletonHeight="h-40" />
            {funnelQuery.data && (
              <>
                <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
                  <FunnelStage
                    label="Started"
                    value={funnelQuery.data.registrations.started}
                    total={funnelQuery.data.registrations.started}
                    colorToken="chart-1"
                  />
                  <FunnelStage
                    label="Confirmed"
                    value={funnelQuery.data.registrations.confirmed}
                    total={funnelQuery.data.registrations.started}
                    colorToken="chart-3"
                  />
                  <FunnelStage
                    label="Cancelled"
                    value={funnelQuery.data.registrations.cancelled}
                    total={funnelQuery.data.registrations.started}
                    colorToken="chart-2"
                  />
                </div>
                <p className="text-body-md text-muted-foreground">
                  Conversion rate: <span className="font-medium text-ink">{percentFormat.format(funnelQuery.data.registrations.conversionRate)}</span>
                </p>
              </>
            )}
          </SectionFrame>

          <SectionFrame title="Payment funnel" description="PAID vs FAILED attempts, and exceptions opened.">
            <QueryState isLoading={funnelQuery.isLoading} isError={funnelQuery.isError} error={funnelQuery.error} skeletonHeight="h-40" />
            {funnelQuery.data && (
              <>
                <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
                  <FunnelStage
                    label="Total payments"
                    value={funnelQuery.data.payments.totalPayments}
                    total={funnelQuery.data.payments.totalPayments}
                    colorToken="chart-1"
                  />
                  <FunnelStage
                    label="Paid"
                    value={funnelQuery.data.payments.paid}
                    total={funnelQuery.data.payments.totalPayments}
                    colorToken="chart-3"
                  />
                  <FunnelStage
                    label="Failed"
                    value={funnelQuery.data.payments.failed}
                    total={funnelQuery.data.payments.totalPayments}
                    colorToken="chart-2"
                  />
                </div>
                <p className="text-body-md text-muted-foreground">
                  Success rate: <span className="font-medium text-ink">{percentFormat.format(funnelQuery.data.payments.successRate)}</span>
                  {" · "}
                  Exception rate: <span className="font-medium text-ink">{percentFormat.format(funnelQuery.data.payments.exceptionRate)}</span>
                  {" "}
                  ({funnelQuery.data.payments.exceptionsOpened.toLocaleString("en-IN")} opened)
                </p>
              </>
            )}
          </SectionFrame>
        </div>

        <SectionFrame title="Top conferences" description="Top 10 by registration count and by revenue, for this range.">
          <QueryState
            isLoading={topConferencesQuery.isLoading}
            isError={topConferencesQuery.isError}
            error={topConferencesQuery.error}
            skeletonHeight="h-48"
          />
          {topConferencesQuery.data && (
            <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
              <div className="flex flex-col gap-sm">
                <h3 className="text-body-md font-medium text-ink">By registrations</h3>
                <RankedBarList items={topConferencesByRegistrations} colorToken="chart-1" />
              </div>
              <div className="flex flex-col gap-sm">
                <h3 className="text-body-md font-medium text-ink">By revenue</h3>
                <RankedBarList
                  items={topConferencesByRevenue}
                  colorToken="chart-3"
                  formatValue={(value) => formatMoney(value, "INR", true)}
                />
              </div>
            </div>
          )}
        </SectionFrame>

        <SectionFrame title="Organizer leaderboard" description="Top 10 organizers by conferences ever published, and by revenue generated in this range.">
          <QueryState isLoading={organizersQuery.isLoading} isError={organizersQuery.isError} error={organizersQuery.error} skeletonHeight="h-48" />
          {organizersQuery.data && (
            <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
              <div className="flex flex-col gap-sm">
                <h3 className="text-body-md font-medium text-ink">By conferences published</h3>
                <RankedBarList items={organizersByPublished} colorToken="chart-4" />
              </div>
              <div className="flex flex-col gap-sm">
                <h3 className="text-body-md font-medium text-ink">By revenue</h3>
                <RankedBarList
                  items={organizersByRevenue}
                  colorToken="chart-3"
                  formatValue={(value) => formatMoney(value, "INR", true)}
                />
              </div>
            </div>
          )}
        </SectionFrame>

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <SectionFrame title="Geography" description="Registrations and revenue by conference city, for this range.">
            <QueryState isLoading={geographyQuery.isLoading} isError={geographyQuery.isError} error={geographyQuery.error} skeletonHeight="h-40" />
            {geographyQuery.data &&
              (geographyQuery.data.length === 0 ? (
                <ChartEmptyState />
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[24rem] text-left text-body-md">
                    <thead className="border-b border-border bg-surface-soft/60">
                      <tr>
                        <th scope="col" className="px-md py-sm font-medium text-ink">City</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Country</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Registrations</th>
                        <th scope="col" className="px-md py-sm font-medium text-ink">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geographyQuery.data.map((row) => (
                        <tr key={row.city ?? "—"} className="border-b border-border last:border-0">
                          <td className="px-md py-sm text-ink">{row.city ?? "Unknown"}</td>
                          <td className="px-md py-sm text-body">{row.country ?? "—"}</td>
                          <td className="px-md py-sm tabular-nums text-body">{row.registrationCount.toLocaleString("en-IN")}</td>
                          <td className="px-md py-sm tabular-nums text-ink">{formatMoney(row.revenue, "INR")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </SectionFrame>

          <SectionFrame title="Platform fee" description="Fee and GST on it, collected from PAID payments in this range.">
            <QueryState isLoading={feesQuery.isLoading} isError={feesQuery.isError} error={feesQuery.error} skeletonHeight="h-40" />
            {feesQuery.data &&
              (feesQuery.data.length === 0 ? (
                <ChartEmptyState label="No platform fee collected in this range" />
              ) : (
                <div className="flex flex-col gap-sm">
                  {feesQuery.data.map((row) => (
                    <div key={row.currency} className="grid grid-cols-1 gap-sm rounded-sm border border-border p-md sm:grid-cols-3">
                      <div>
                        <p className="text-body-md text-muted-foreground">Platform fee ({row.currency})</p>
                        <p className="font-display text-title-md tabular-nums text-ink">{formatMoney(row.platformFeeTotal, row.currency)}</p>
                      </div>
                      <div>
                        <p className="text-body-md text-muted-foreground">GST on fee</p>
                        <p className="font-display text-title-md tabular-nums text-ink">{formatMoney(row.platformFeeTaxTotal, row.currency)}</p>
                      </div>
                      <div>
                        <p className="text-body-md text-muted-foreground">Paid payments</p>
                        <p className="font-display text-title-md tabular-nums text-ink">{row.paidPayments.toLocaleString("en-IN")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </SectionFrame>
        </div>
      </AdminPageFrame>
    </>
  );
}
