import { Link, useLocation } from "react-router";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import {
  WORKSPACE_NAV_ITEMS,
  getMunNavSection,
  munSectionHref,
  parseOrganizerDashboardPath,
} from "@/lib/organizer/nav-config";
import type { WorkspaceMun } from "@/types/organizer";

interface WorkspaceBreadcrumbProps {
  currentMun: WorkspaceMun | null;
}

const LINK_CLASS =
  "rounded-sm text-body-md text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Chevron() {
  return (
    <ChevronRightIcon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-border-strong" />
  );
}

export function WorkspaceBreadcrumb({ currentMun }: WorkspaceBreadcrumbProps) {
  const { pathname } = useLocation();
  const { orgWideLeaf, section: sectionSegment } = parseOrganizerDashboardPath(pathname);

  const orgWideItem = currentMun
    ? null
    : WORKSPACE_NAV_ITEMS.find((item) => !item.exact && item.href.endsWith(`/${orgWideLeaf ?? ""}`));

  const section = currentMun && sectionSegment ? getMunNavSection(sectionSegment) : undefined;

  // Deeper crumbs exist whenever this isn't the root "Overview" page itself.
  const hasDeeperCrumb = Boolean(currentMun || orgWideItem);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex list-none items-center gap-xs">
        <li
          className={cn(
            "flex items-center gap-xs",
            // "Overview" never truncates (no `min-w-0`), so on a narrow
            // viewport with a mun name AND a section crumb after it, this
            // segment kept its full width and forced BOTH truncatable
            // crumbs to absorb all the shrinking — squeezing the current
            // page's own name (the one crumb that actually matters once
            // you're this deep) down to an unreadable ~21px, invisible in
            // practice. Confirmed at 320/375px on any per-mun workspace
            // page. "Overview" duplicates the sidebar's "MUN Hub" home
            // link, so it's the safest one to drop below `sm` rather than
            // making every crumb fight over the same starved space.
            hasDeeperCrumb && "hidden sm:flex",
          )}
        >
          {hasDeeperCrumb ? (
            <Link to="/organizer/dashboard" className={LINK_CLASS}>Overview</Link>
          ) : (
            <span aria-current="page" className="text-body-md font-medium text-ink">Overview</span>
          )}
        </li>
        {orgWideItem && (
          <li className="flex items-center gap-xs">
            <Chevron />
            <span aria-current="page" className="truncate text-body-md font-medium text-ink">
              {orgWideItem.label}
            </span>
          </li>
        )}
        {currentMun && (
          <li className="flex min-w-0 items-center gap-xs">
            <Chevron />
            {section ? (
              <Link to={munSectionHref(currentMun.id, "setup")} className={`${LINK_CLASS} truncate`}>
                {currentMun.name}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-body-md font-medium text-ink">
                {currentMun.name}
              </span>
            )}
          </li>
        )}
        {currentMun && section && (
          <li className="flex min-w-0 items-center gap-xs">
            <Chevron />
            <span aria-current="page" className="truncate text-body-md font-medium text-ink">
              {section.title ?? section.label}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
