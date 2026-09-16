import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { munSectionHref } from "@/lib/organizer/nav-config";
import { queryKeys } from "@/api/query-keys";
import { getOrganizerWorkspaceOverview } from "@/api/organizer-dashboard";

export function OrganizerMunsPage() {
  const workspaceQuery = useQuery({
    queryKey: queryKeys.organizerWorkspace(),
    queryFn: getOrganizerWorkspaceOverview,
  });

  const munSummaries = workspaceQuery.data?.muns ?? [];

  return (
    <>
      <Helmet title="My MUNs" />
      <WorkspacePage
        title="My MUNs"
        description="Every conference you manage on MUN Hub."
        actions={
          <Button size="sm" render={<Link to="/organizer/apply" />}>
            <PlusIcon aria-hidden strokeWidth={1.75} />
            Apply to host
          </Button>
        }
      >
        {workspaceQuery.isLoading && (
          <p className="text-body-md text-muted-foreground">Loading your conferences...</p>
        )}
        {workspaceQuery.isError && (
          <p className="text-body-md text-destructive">{workspaceQuery.error.message}</p>
        )}
        {!workspaceQuery.isLoading && !workspaceQuery.isError && munSummaries.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
            <h2 className="font-display text-title-sm text-ink">No conferences yet</h2>
            <p className="mt-xs text-body-md text-muted-foreground">
              Apply to host a MUN and, once approved, it appears here.
            </p>
            <Button className="mt-lg" size="sm" render={<Link to="/organizer/apply" />}>
              <PlusIcon aria-hidden strokeWidth={1.75} />
              Apply to host a MUN
            </Button>
          </div>
        )}
        {munSummaries.length > 0 && (
          <ul className="grid gap-md sm:grid-cols-2">
            {munSummaries.map((mun) => (
              <li key={mun.id}>
                <Link
                  to={munSectionHref(mun.id, "setup")}
                  className="flex h-full flex-col gap-sm rounded-md border border-border bg-card p-lg transition-colors hover:bg-surface-soft"
                >
                  <div className="flex items-start justify-between gap-sm">
                    <h2 className="font-display text-title-md text-ink">{mun.name}</h2>
                    <MunStatusBadge status={mun.status} />
                  </div>
                  <p className="text-body-md text-muted-foreground">
                    {mun.registrationCount} registrations · {mun.confirmedCount} confirmed
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </WorkspacePage>
    </>
  );
}
