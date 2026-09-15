import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { PlusIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { munSectionHref } from "@/lib/organizer/nav-config";
import { MOCK_ORGANIZER_MUN_SUMMARIES } from "@/mocks/organizer";

export function OrganizerMunsPage() {
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
        <ul className="grid gap-md sm:grid-cols-2">
          {MOCK_ORGANIZER_MUN_SUMMARIES.map((mun) => (
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
      </WorkspacePage>
    </>
  );
}
