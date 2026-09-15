import { Link, useLocation } from "react-router";
import { ChevronRightIcon } from "lucide-react";
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

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex list-none items-center gap-xs">
        <li className="flex items-center gap-xs">
          {currentMun || orgWideItem ? (
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
