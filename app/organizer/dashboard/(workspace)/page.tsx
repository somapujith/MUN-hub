import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  ClockIcon,
  LayersIcon,
  PlusIcon,
  TrendingUpIcon,
} from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import { requireOrganizerActor } from "../auth";
import { munSectionHref } from "../nav-config";
import {
  daysUntil,
  getOrganizerWorkspaceData,
  getWorkspaceAlerts,
  type OrganizerMunSummary,
  type WorkspaceAlert,
} from "./workspace-data";
import { cn } from "cn";

/**
 * Overview (PRD § 6) — the organizer-wide landing screen.
 *
 * WHAT IS HERE, AND WHAT ISN'T
 * ----------------------------
 * PRD § 6 lists thirteen figures. Seven are computed from real rows and shown:
 * total registrations, confirmed, pending, available seats, capacity
 * utilisation, registrations in the last 24h / 7d / 30d, and a deadline
 * countdown (only for muns that actually carry a `registrationProducts.deadline`).
 *
 * Six are absent on purpose:
 *   GMV, platform fees, refunds  no organizer-wide payment aggregate exists.
 *                                A wrong money number gets reconciled against
 *                                and destroys trust in every other number here.
 *   registration conversion      needs a page-view denominator nothing records.
 *   registration trend           needs a per-day series; the three recency
 *                                buckets below are the honest subset of it.
 *
 * The Action Center renders only when `getWorkspaceAlerts` returns something,
 * and that function only emits the two alert kinds backed by real columns.
 * An empty Action Center is omitted entirely rather than shown reassuring
 * everything-is-fine copy that nothing verified.
 */

export const metadata: Metadata = { title: "Overview" };

export default async function OrganizerOverviewPage() {
  const actor = await requireOrganizerActor();
  const { muns, totals, recent, application } =
    await getOrganizerWorkspaceData(actor.userId);

  if (muns.length === 0) {
    return (
      <WorkspacePage
        title="Overview"
        description="Your conferences and registrations at a glance."
      >
        {application ? (
          <ApplicationUnderReview submittedAt={application.submittedAt} />
        ) : (
          <NoConferencesYet />
        )}
      </WorkspacePage>
    );
  }

  // One clock for the page: the stat grid, the alerts and the schedule all
  // count down from the same instant.
  const now = new Date();
  const alerts = await getWorkspaceAlerts(muns, now);

  const utilisation =
    totals.capacity > 0
      ? Math.round((totals.confirmed / totals.capacity) * 100)
      : null;

  // Rounding 1/220 to "0%" next to a "Confirmed: 1" stat reads as a broken
  // number. Say "<1%" instead — it's the same claim, told truthfully.
  const utilisationLabel =
    utilisation === null
      ? null
      : utilisation === 0 && totals.confirmed > 0
        ? "<1%"
        : `${utilisation}%`;

  const upcoming = muns
    .filter((mun) => mun.startDate !== null && mun.startDate >= now)
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime())
    .slice(0, 3);

  return (
    <WorkspacePage
      title="Overview"
      description="Your conferences and registrations at a glance."
      actions={
        <Button
          size="sm"
          variant="outline"
          render={<Link href="/organizer/dashboard/muns" />}
        >
          My MUNs
          <ArrowRightIcon aria-hidden strokeWidth={1.75} />
        </Button>
      }
    >
      {/* --- Headline figures. Registrations, the split, and seats left. --- */}
      <section aria-labelledby="overview-stats">
        <h2 id="overview-stats" className="sr-only">
          Registration summary
        </h2>
        <dl className="grid gap-xs sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total registrations"
            value={totals.totalRegistrations}
            hint={`across ${totals.munCount} ${totals.munCount === 1 ? "conference" : "conferences"}`}
          />
          <Stat
            label="Confirmed"
            value={totals.confirmed}
            hint="seat taken and paid"
            tone="success"
          />
          <Stat
            label="Pending"
            value={totals.pending}
            hint="reserved, awaiting payment"
            tone={totals.pending > 0 ? "warning" : "neutral"}
          />
          <Stat
            label="Available seats"
            value={totals.availableSeats}
            hint={
              utilisationLabel === null
                ? "no registration products configured"
                : `${utilisationLabel} of ${totals.capacity.toLocaleString("en-IN")} seats filled`
            }
          />
        </dl>
      </section>

      {/* --- Capacity utilisation: the one derived ratio worth a bar. ------ */}
      {utilisationLabel !== null && (
        <CapacityBar
          confirmed={totals.confirmed}
          pending={totals.pending}
          capacity={totals.capacity}
          utilisationLabel={utilisationLabel}
        />
      )}

      {alerts.length > 0 && <ActionCenter alerts={alerts} />}

      <div className="grid gap-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <RecentRegistrations recent={recent} />
        <UpcomingConferences muns={upcoming} now={now} />
      </div>
    </WorkspacePage>
  );
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

type StatTone = "neutral" | "success" | "warning";

/**
 * A single figure. `value` is nullable because "available seats" is genuinely
 * unknowable until at least one registration product exists — an em dash says
 * that; a zero would claim the conference is sold out.
 */
function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | null;
  hint?: string;
  tone?: StatTone;
}) {
  return (
    <div className="flex flex-col gap-xxs rounded-md border border-border bg-card p-md">
      <dt className="text-body-md text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-display text-display-md tabular-nums",
          tone === "success" && value !== null && value > 0
            ? "text-success-text"
            : tone === "warning" && value !== null && value > 0
              ? "text-warning-text"
              : "text-ink",
        )}
      >
        {value === null ? (
          <span className="text-muted-foreground" aria-label="Not available">
            &mdash;
          </span>
        ) : (
          value.toLocaleString("en-IN")
        )}
      </dd>
      {hint && <p className="text-body-md text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Capacity utilisation as a two-segment bar: confirmed seats solid, pending
 * seats hatched behind them. Percentages are also stated in text — the bar is
 * the redundant channel, not the only one.
 */
function CapacityBar({
  confirmed,
  pending,
  capacity,
  utilisationLabel,
}: {
  confirmed: number;
  pending: number;
  capacity: number;
  utilisationLabel: string;
}) {
  // A single registration against a 220-seat cap is 0.45% — one sub-pixel of
  // bar, i.e. visually identical to zero. Floor any non-zero segment at a
  // width that actually reads as "something is here"; the exact figure is
  // stated in text beside it, so the bar is allowed to be approximate.
  const MIN_VISIBLE_PCT = 1.5;
  const floorPct = (value: number) =>
    value === 0 ? 0 : Math.max((value / capacity) * 100, MIN_VISIBLE_PCT);

  const confirmedPct = Math.min(floorPct(confirmed), 100);
  const pendingPct = Math.min(floorPct(pending), 100 - confirmedPct);

  return (
    <section
      aria-labelledby="capacity-heading"
      className="flex flex-col gap-xs rounded-md border border-border bg-card p-md"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-xs">
        <h2 id="capacity-heading" className="text-label-md text-ink">
          Capacity utilisation{" "}
          <span className="tabular-nums text-muted-foreground">
            {utilisationLabel}
          </span>
        </h2>
        <p className="text-body-md text-muted-foreground">
          <span className="tabular-nums text-ink">{confirmed.toLocaleString("en-IN")}</span>{" "}
          of <span className="tabular-nums">{capacity.toLocaleString("en-IN")}</span>{" "}
          seats confirmed
          {pending > 0 && (
            <>
              {" · "}
              <span className="tabular-nums">{pending.toLocaleString("en-IN")}</span>{" "}
              pending
            </>
          )}
        </p>
      </div>

      <div
        role="img"
        aria-label={`${utilisationLabel} of seats confirmed${pending > 0 ? `, ${pending} more pending` : ""}`}
        className="flex h-2 w-full overflow-hidden rounded-pill bg-surface-strong dark:bg-muted"
      >
        <span
          className="h-full bg-success transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${confirmedPct}%` }}
        />
        <span
          className="h-full bg-warning/50 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${pendingPct}%` }}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Action Center (PRD § 6)                                                    */
/* -------------------------------------------------------------------------- */

function ActionCenter({ alerts }: { alerts: readonly WorkspaceAlert[] }) {
  return (
    <section
      aria-labelledby="action-center"
      className="flex flex-col gap-xs rounded-md border border-border bg-card p-md"
    >
      <div className="flex items-baseline justify-between gap-xs">
        <h2 id="action-center" className="text-label-md text-ink">
          Action center
        </h2>
        <p className="text-body-md text-muted-foreground">
          <span className="tabular-nums">{alerts.length}</span>{" "}
          {alerts.length === 1 ? "item needs" : "items need"} attention
        </p>
      </div>

      <ul className="flex list-none flex-col gap-xxs">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <Link
              href={alert.href}
              className={cn(
                "group/alert flex items-start gap-sm rounded-sm border border-transparent px-xs py-xs",
                "transition-colors duration-150 ease-out hover:bg-surface-soft dark:hover:bg-muted",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm",
                  alert.kind === "committee-full"
                    ? "bg-warning/20 text-warning-text"
                    : "bg-info/12 text-info-text",
                )}
              >
                {alert.kind === "committee-full" ? (
                  <LayersIcon strokeWidth={1.75} className="size-4" />
                ) : (
                  <CalendarClockIcon strokeWidth={1.75} className="size-4" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-xxs">
                <span className="text-label-md text-ink">{alert.title}</span>
                <span className="text-body-md text-pretty text-muted-foreground">
                  {alert.detail}
                </span>
              </span>
              <ArrowRightIcon
                aria-hidden
                strokeWidth={1.75}
                className="ml-auto mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover/alert:translate-x-0.5 motion-reduce:transition-none"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Recency + schedule                                                         */
/* -------------------------------------------------------------------------- */

/**
 * PRD § 6's "registrations today / week / month". Rolling windows, not
 * calendar ones — see `countRecentRegistrations` for why the labels say "last
 * 24 hours" rather than "today".
 */
function RecentRegistrations({
  recent,
}: {
  recent: { today: number; week: number; month: number };
}) {
  const rows = [
    { label: "Last 24 hours", value: recent.today },
    { label: "Last 7 days", value: recent.week },
    { label: "Last 30 days", value: recent.month },
  ];

  return (
    <section
      aria-labelledby="recent-heading"
      className="flex flex-col gap-xs rounded-md border border-border bg-card p-md"
    >
      <h2
        id="recent-heading"
        className="flex items-center gap-xs text-label-md text-ink"
      >
        <TrendingUpIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 text-muted-foreground"
        />
        New confirmed registrations
      </h2>
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-sm border-b border-border py-xs last:border-b-0 last:pb-0"
          >
            <dt className="text-body-md text-body dark:text-muted-foreground">
              {row.label}
            </dt>
            <dd className="font-display text-title-sm tabular-nums text-ink">
              {row.value.toLocaleString("en-IN")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The next three conferences by start date, with a days-away countdown. This
 * is the honest version of PRD § 6's "deadline countdown": a registration
 * deadline only renders where one is configured, and the conference date
 * itself is always known, so the section is never empty for an organizer with
 * a future event.
 */
function UpcomingConferences({
  muns,
  now,
}: {
  muns: readonly OrganizerMunSummary[];
  now: Date;
}) {
  return (
    <section
      aria-labelledby="upcoming-heading"
      className="flex flex-col gap-xs rounded-md border border-border bg-card p-md"
    >
      <h2
        id="upcoming-heading"
        className="flex items-center gap-xs text-label-md text-ink"
      >
        <CalendarClockIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 text-muted-foreground"
        />
        Upcoming conferences
      </h2>

      {muns.length === 0 ? (
        <p className="py-xs text-body-md text-pretty text-muted-foreground">
          Nothing scheduled ahead. Set dates on a conference in MUN Setup and it
          appears here.
        </p>
      ) : (
        <ul className="flex list-none flex-col">
          {muns.map((mun) => {
            const days = mun.startDate ? daysUntil(mun.startDate, now) : null;
            const deadline = mun.registrationDeadline;
            const deadlineDays = deadline ? daysUntil(deadline, now) : null;

            return (
              <li
                key={mun.id}
                className="flex flex-wrap items-center justify-between gap-x-sm gap-y-xxs border-b border-border py-xs last:border-b-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-xxs">
                  <div className="flex flex-wrap items-center gap-xs">
                    <Link
                      href={munSectionHref(mun.id, "setup")}
                      className="rounded-sm text-label-md text-ink outline-none transition-colors duration-150 ease-out hover:text-link focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {mun.name}
                    </Link>
                    <MunStatusBadge status={mun.status} />
                  </div>
                  <p className="text-body-md tabular-nums text-muted-foreground">
                    {formatDateRange(mun.startDate, mun.endDate)}
                    {deadlineDays !== null && deadlineDays >= 0 && (
                      <>
                        {" · "}
                        <span className="text-warning-text">
                          registration closes in {deadlineDays}{" "}
                          {deadlineDays === 1 ? "day" : "days"}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {days !== null && (
                  <p className="shrink-0 text-body-md tabular-nums text-muted-foreground">
                    in <span className="text-ink">{days}</span>{" "}
                    {days === 1 ? "day" : "days"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Zero-conference states (carried over from the pre-workspace dashboard)     */
/* -------------------------------------------------------------------------- */

function ApplicationUnderReview({ submittedAt }: { submittedAt: Date }) {
  return (
    <div className="flex flex-col items-start gap-md rounded-md border border-border bg-surface-soft p-xl dark:bg-card">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full bg-info/15 text-info-text"
      >
        <ClockIcon strokeWidth={1.75} className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-xs">
        <h2 className="font-display text-title-sm text-ink">
          Application under review
        </h2>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          We received your application on{" "}
          {new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(submittedAt)}
          . Once it&rsquo;s approved your conference appears here and you can
          start building out committees and pricing.
        </p>
      </div>
    </div>
  );
}

function NoConferencesYet(): ReactNode {
  return (
    <div className="flex flex-col items-start gap-md rounded-md border border-dashed border-border bg-surface-soft p-xl dark:bg-card">
      <div className="flex max-w-prose flex-col gap-xs">
        <h2 className="font-display text-title-lg text-balance text-ink">
          No conferences yet
        </h2>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          Apply to host a MUN and, once approved, you&rsquo;ll manage
          committees, registrations and payments right here.
        </p>
      </div>
      <Button render={<Link href="/organizer/apply" />}>
        <PlusIcon aria-hidden strokeWidth={1.75} />
        Apply to host a MUN
      </Button>
    </div>
  );
}
