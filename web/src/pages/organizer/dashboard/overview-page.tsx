import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import { munSectionHref } from "@/lib/organizer/nav-config";
import { queryKeys } from "@/api/query-keys";
import { getOrganizerWorkspaceOverview } from "@/api/organizer-dashboard";
import type { WorkspaceMun } from "@/types/organizer";

interface NextStep {
  text: string;
  cta: string;
  href: string;
  /** The organizer has something to do. */
  primary: boolean;
}

/** What each MUN is waiting for, in the organizer's words, and where to go next. */
function nextStep(mun: WorkspaceMun): NextStep {
  const section = (segment: string) => munSectionHref(mun.id, segment);
  switch (mun.status) {
    case "DRAFT":
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return {
        text: "MUN Hub is reviewing your application. We'll email you within 2 business days.",
        cta: "View application",
        href: "/organizer/apply",
        primary: false,
      };
    case "CHANGES_REQUESTED":
      return {
        text: "MUN Hub asked for changes to your application.",
        cta: "See what to change",
        href: "/organizer/apply",
        primary: true,
      };
    case "REJECTED":
      return { text: "This application wasn't approved.", cta: "View application", href: "/organizer/apply", primary: false };
    case "APPROVED":
    case "ONBOARDING":
    case "ACTION_REQUIRED":
    case "READY_FOR_SUBMISSION":
      return {
        text: "Approved. Set up your MUN, then submit it for review.",
        cta: "Continue setup",
        href: section("setup"),
        primary: true,
      };
    case "CONTENT_SUBMITTED":
    case "AUTOMATED_VALIDATION":
    case "ORGANIZER_CONFIRMATION":
      return {
        text: "Your MUN passed the checks. Confirm your submission to send it to MUN Hub.",
        cta: "Confirm submission",
        href: section("setup"),
        primary: true,
      };
    case "VERIFICATION":
      return {
        text: "MUN Hub is reviewing your MUN and will email you the result.",
        cta: "Review status",
        href: section("setup"),
        primary: false,
      };
    case "VERIFIED":
    case "GO_LIVE_QUEUE":
    case "PUBLISHING":
      return { text: "Approved. MUN Hub will publish it shortly.", cta: "Manage", href: section("setup"), primary: false };
    case "PUBLISHED":
      return {
        text: "Live on MUN Hub. Open registration when you're ready.",
        cta: "Registration settings",
        href: section("settings"),
        primary: true,
      };
    case "REGISTRATION_OPEN":
      return { text: "Registration is open.", cta: "View registrations", href: section("registrations"), primary: false };
    default:
      return { text: "", cta: "Manage", href: section("setup"), primary: false };
  }
}

export function OrganizerOverviewPage() {
  const workspaceQuery = useQuery({
    queryKey: queryKeys.organizerWorkspace(),
    queryFn: getOrganizerWorkspaceOverview,
  });

  const totals = workspaceQuery.data?.totals;
  const munSummaries = workspaceQuery.data?.muns ?? [];
  const utilisation =
    totals && totals.capacity > 0 ? Math.round((totals.confirmed / totals.capacity) * 100) : null;

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
        {workspaceQuery.isLoading && (
          <p className="text-body-md text-muted-foreground">Loading your workspace...</p>
        )}
        {workspaceQuery.isError && (
          <p className="text-body-md text-destructive">{workspaceQuery.error.message}</p>
        )}
        {totals && (
          <>
            <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
              {[
                { label: "Registrations", value: totals.registrations },
                { label: "Confirmed", value: totals.confirmed },
                { label: "Pending payment", value: totals.pending },
                { label: "Seats available", value: totals.availableSeats },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-border bg-card p-md">
                  <p className="text-body-md text-muted-foreground">{stat.label}</p>
                  <p className="font-display text-title-lg tabular-nums text-ink">{stat.value}</p>
                </div>
              ))}
            </div>
            {utilisation !== null && (
              <p className="text-body-md text-muted-foreground">
                Capacity utilisation: <span className="font-medium text-ink">{utilisation}%</span>
              </p>
            )}
            <section className="flex flex-col gap-md">
              <h2 className="font-display text-title-md text-ink">Your conferences</h2>
              {munSummaries.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                  <h3 className="font-display text-title-sm text-ink">No conferences yet</h3>
                  <p className="mt-xs text-body-md text-muted-foreground">
                    Apply to host a MUN and, once approved, it appears here.
                  </p>
                  <Button className="mt-lg" size="sm" render={<Link to="/organizer/apply" />}>
                    <PlusIcon aria-hidden strokeWidth={1.75} />
                    Apply to host a MUN
                  </Button>
                </div>
              ) : (
                <ul className="flex flex-col gap-sm">
                  {munSummaries.map((mun) => {
                    const step = nextStep(mun);
                    return (
                      <li
                        key={mun.id}
                        data-testid={`overview-mun-${mun.id}`}
                        className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-card p-md"
                      >
                        <div className="flex min-w-0 flex-col gap-xxs">
                          <div className="flex flex-wrap items-center gap-xs">
                            <span className="font-medium text-ink">{mun.name}</span>
                            <MunStatusBadge status={mun.status} />
                          </div>
                          <p className="text-body-md text-muted-foreground">
                            {formatDateRange(mun.startDate, mun.endDate)}
                            {mun.capacity > 0 && ` · ${mun.confirmedCount}/${mun.capacity} confirmed`}
                          </p>
                          <p className="text-body-md text-body">{step.text}</p>
                        </div>
                        <Button
                          variant={step.primary ? "default" : "outline"}
                          size="sm"
                          render={<Link to={step.href} />}
                        >
                          {step.cta}
                          <ArrowRightIcon aria-hidden strokeWidth={1.75} />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </WorkspacePage>
    </>
  );
}
