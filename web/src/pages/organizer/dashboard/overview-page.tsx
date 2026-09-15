import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import { munSectionHref } from "@/lib/organizer/nav-config";
import {
  MOCK_ORGANIZER_MUN_SUMMARIES,
  MOCK_ORGANIZER_TOTALS,
} from "@/mocks/organizer";

export function OrganizerOverviewPage() {
  const { registrations, confirmed, pending, capacity, availableSeats } = MOCK_ORGANIZER_TOTALS;
  const utilisation = capacity > 0 ? Math.round((confirmed / capacity) * 100) : 0;

  return (
    <>
      <Helmet title="Overview" />
      <WorkspacePage
        title="Overview"
        description="Your conferences and registrations at a glance."
        actions={
          <Button size="sm" render={<Link to="/organizer/apply" />}>
            <PlusIcon aria-hidden strokeWidth={1.75} />
            Host a MUN
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
          {[
            { label: "Registrations", value: registrations },
            { label: "Confirmed", value: confirmed },
            { label: "Pending payment", value: pending },
            { label: "Seats available", value: availableSeats },
          ].map((stat) => (
            <div key={stat.label} className="rounded-md border border-border bg-card p-md">
              <p className="text-body-md text-muted-foreground">{stat.label}</p>
              <p className="font-display text-title-lg tabular-nums text-ink">{stat.value}</p>
            </div>
          ))}
        </div>
        <p className="text-body-md text-muted-foreground">
          Capacity utilisation: <span className="font-medium text-ink">{utilisation}%</span> (mock data)
        </p>
        <section className="flex flex-col gap-md">
          <h2 className="font-display text-title-md text-ink">Your conferences</h2>
          <ul className="flex flex-col gap-sm">
            {MOCK_ORGANIZER_MUN_SUMMARIES.map((mun) => (
              <li key={mun.id} className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-card p-md">
                <div className="flex min-w-0 flex-col gap-xxs">
                  <div className="flex flex-wrap items-center gap-xs">
                    <span className="font-medium text-ink">{mun.name}</span>
                    <MunStatusBadge status={mun.status} />
                  </div>
                  <p className="text-body-md text-muted-foreground">
                    {formatDateRange(mun.startDate, mun.endDate)} · {mun.confirmedCount}/{mun.capacity} confirmed
                  </p>
                </div>
                <Button variant="outline" size="sm" render={<Link to={munSectionHref(mun.id, "setup")} />}>
                  Manage
                  <ArrowRightIcon aria-hidden strokeWidth={1.75} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </WorkspacePage>
    </>
  );
}
