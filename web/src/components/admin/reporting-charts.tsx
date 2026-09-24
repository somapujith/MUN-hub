import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";

// -----------------------------------------------------------------------------
// Hand-built SVG/CSS chart primitives for the admin Analytics page. No chart
// library exists in web/node_modules, so per the task brief these are simple
// SVG (trend line) and CSS-width (ranked list) components rather than a new
// dependency. Colors come from this app's own `--chart-1`..`--chart-5` design
// tokens (web/src/index.css) — fixed categorical order, never cycled
// per-series, consistent with the app's muted/editorial style in both themes.
// -----------------------------------------------------------------------------

export type ChartColorToken = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5";

// Literal class strings (not template-interpolated) so Tailwind's static
// scanner sees every one of them.
const STROKE_CLASS: Record<ChartColorToken, string> = {
  "chart-1": "stroke-chart-1",
  "chart-2": "stroke-chart-2",
  "chart-3": "stroke-chart-3",
  "chart-4": "stroke-chart-4",
  "chart-5": "stroke-chart-5",
};
const BG_CLASS: Record<ChartColorToken, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
};
const BG_SOFT_CLASS: Record<ChartColorToken, string> = {
  "chart-1": "bg-chart-1/12",
  "chart-2": "bg-chart-2/12",
  "chart-3": "bg-chart-3/12",
  "chart-4": "bg-chart-4/12",
  "chart-5": "bg-chart-5/12",
};

export function ChartEmptyState({ label = "No data for this range" }: { label?: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border text-body-md text-muted-foreground">
      {label}
    </div>
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  points: { bucket: string; value: number }[];
  colorToken: ChartColorToken;
}

interface TrendLineChartProps {
  title: string;
  series: ChartSeries[];
  formatValue?: (value: number) => string;
  formatBucket?: (bucket: string) => string;
  height?: number;
}

const VIEW_WIDTH = 600;

/**
 * A multi-series line chart, one axis, thin 2px lines, a recessive 3-line
 * grid. Ships a hover/focus readout (per dataviz's "add the hover layer by
 * default" rule) as a below-chart detail panel rather than a
 * cursor-following tooltip — simpler to keep correct across the SVG
 * viewBox's independent scaling, and every point stays reachable by
 * keyboard via its own focusable hit target. A legend renders for 2+ series
 * (a single series is named by the chart title instead).
 */
export function TrendLineChart({ title, series, formatValue = String, formatBucket = (b) => b, height = 220 }: TrendLineChartProps) {
  const titleId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const buckets = series[0]?.points.map((point) => point.bucket) ?? [];
  const hasAnyValue = series.some((s) => s.points.some((point) => point.value > 0));

  const padding = { top: 12, right: 8, bottom: 8, left: 8 };
  const plotWidth = VIEW_WIDTH - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.points.map((point) => point.value)));

  const xFor = (index: number) =>
    padding.left + (buckets.length <= 1 ? plotWidth / 2 : (index / (buckets.length - 1)) * plotWidth);
  const yFor = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;

  const pathFor = (points: { value: number }[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(" ");

  const shownIndex = activeIndex ?? buckets.length - 1;

  if (buckets.length === 0 || !hasAnyValue) {
    return <ChartEmptyState />;
  }

  return (
    <div className="flex flex-col gap-sm">
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="w-full"
        onMouseLeave={() => setActiveIndex(null)}
      >
        <title id={titleId}>{title}</title>
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={padding.left}
            x2={VIEW_WIDTH - padding.right}
            y1={padding.top + plotHeight * (1 - fraction)}
            y2={padding.top + plotHeight * (1 - fraction)}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={pathFor(s.points)}
            fill="none"
            className={STROKE_CLASS[s.colorToken]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {activeIndex !== null && (
          <line
            x1={xFor(activeIndex)}
            x2={xFor(activeIndex)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            className="stroke-border-strong"
            strokeWidth={1}
          />
        )}
        {buckets.map((bucket, index) => (
          <rect
            key={bucket}
            x={xFor(index) - plotWidth / Math.max(buckets.length, 1) / 2}
            y={padding.top}
            width={plotWidth / Math.max(buckets.length, 1)}
            height={plotHeight}
            fill="transparent"
            className="cursor-pointer outline-none"
            onMouseEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
            tabIndex={0}
            role="button"
            aria-label={`${formatBucket(bucket)}: ${series
              .map((s) => `${s.label} ${formatValue(s.points[index]?.value ?? 0)}`)
              .join(", ")}`}
          />
        ))}
      </svg>

      {buckets[shownIndex] && (
        <div className="flex flex-wrap items-baseline gap-x-lg gap-y-xs rounded-sm border border-border bg-surface-soft/60 px-md py-sm">
          <span className="text-caption text-muted-foreground">{formatBucket(buckets[shownIndex])}</span>
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-xs text-body-md text-ink">
              <span className={cn("size-2 rounded-full", BG_CLASS[s.colorToken])} aria-hidden />
              {series.length > 1 && <span className="text-muted-foreground">{s.label}</span>}
              <span className="tabular-nums font-medium">{formatValue(s.points[shownIndex]?.value ?? 0)}</span>
            </span>
          ))}
        </div>
      )}

      {series.length > 1 && (
        <div className="flex flex-wrap gap-md" role="list" aria-label="Series">
          {series.map((s) => (
            <span key={s.key} role="listitem" className="flex items-center gap-xs text-body-md text-muted-foreground">
              <span className={cn("size-2 rounded-full", BG_CLASS[s.colorToken])} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface RankedListItem {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
}

interface RankedBarListProps {
  items: RankedListItem[];
  formatValue?: (value: number) => string;
  emptyLabel?: string;
  colorToken?: ChartColorToken;
  /** When given, each row links to this admin URL (e.g. a conference's or organizer's detail page) instead of rendering as plain text. */
  getHref?: (item: RankedListItem) => string;
}

/** A ranked, horizontal-bar list — the "table" alternative dataviz recommends for a ranking with a magnitude, without pulling in a chart library. */
export function RankedBarList({
  items,
  formatValue = String,
  emptyLabel = "No data for this range",
  colorToken = "chart-1",
  getHref,
}: RankedBarListProps) {
  const maxValue = useMemo(() => Math.max(1, ...items.map((item) => item.value)), [items]);

  if (items.length === 0) {
    return <ChartEmptyState label={emptyLabel} />;
  }

  return (
    <ol className="flex flex-col gap-xs">
      {items.map((item, index) => {
        const rowContent = (
          <>
            <div className="flex min-w-0 items-center gap-sm">
              <span className="w-5 shrink-0 text-caption tabular-nums text-muted-foreground">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-body-md font-medium text-ink">{item.label}</p>
                {item.sublabel && <p className="truncate text-caption text-muted-foreground">{item.sublabel}</p>}
              </div>
            </div>
            <span className="shrink-0 tabular-nums text-body-md text-ink">{formatValue(item.value)}</span>
          </>
        );
        // Hover/focus use a translucent ink overlay rather than an opaque
        // surface color — the decorative proportional bar (the span below)
        // sits underneath at low opacity and an opaque hover fill would hide
        // it. focus-visible:ring-inset keeps the ring from being clipped by
        // this li's overflow-hidden (needed to clip the bar's corners).
        const rowClassName =
          "relative flex items-center justify-between gap-md px-md py-sm outline-none transition-colors hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
        return (
          <li key={item.id} className="relative overflow-hidden rounded-sm border border-border">
            <span
              aria-hidden
              className={cn("absolute inset-y-0 left-0", BG_SOFT_CLASS[colorToken])}
              style={{ width: `${Math.max((item.value / maxValue) * 100, 2)}%` }}
            />
            {getHref ? (
              <Link to={getHref(item)} className={rowClassName}>
                {rowContent}
              </Link>
            ) : (
              <div className={rowClassName}>{rowContent}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface FunnelStageProps {
  label: string;
  value: number;
  /** The stage this percentage is relative to (usually the funnel's first stage). */
  total: number;
  colorToken?: ChartColorToken;
}

/** One funnel stage: a stat tile with a proportional bar underneath, relative to the funnel's starting count. */
export function FunnelStage({ label, value, total, colorToken = "chart-1" }: FunnelStageProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-xs rounded-md border border-border bg-card p-md">
      <p className="text-body-md text-muted-foreground">{label}</p>
      <p className="font-display text-title-lg tabular-nums text-ink">{value.toLocaleString("en-IN")}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-soft">
        <div className={cn("h-full", BG_CLASS[colorToken])} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <p className="text-caption text-muted-foreground">{pct}% of started</p>
    </div>
  );
}
