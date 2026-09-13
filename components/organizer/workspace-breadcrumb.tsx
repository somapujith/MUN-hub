"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import {
  WORKSPACE_NAV_ITEMS,
  getMunNavSection,
  munSectionHref,
} from "@/app/organizer/dashboard/nav-config";
import type { WorkspaceMun } from "@/app/organizer/dashboard/workspace-queries";

/**
 * Top-bar breadcrumb. Derived from the route segments rather than passed in as
 * a prop, so a module page can never forget to set it and can never set it to
 * something the URL contradicts.
 *
 * Shapes:
 *   Overview                              (org-wide root)
 *   Overview  ›  My MUNs                  (org-wide leaf)
 *   Overview  ›  {MUN name}  ›  {Section} (per-MUN)
 */

interface WorkspaceBreadcrumbProps {
  currentMun: WorkspaceMun | null;
}

const LINK_CLASS =
  "rounded-sm text-body-md text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Chevron() {
  return (
    <ChevronRightIcon
      aria-hidden
      strokeWidth={1.75}
      className="size-3.5 shrink-0 text-border-strong"
    />
  );
}

export function WorkspaceBreadcrumb({ currentMun }: WorkspaceBreadcrumbProps) {
  const segments = useSelectedLayoutSegments();

  // Org-wide leaf: segments are the path under /organizer/dashboard, e.g.
  // ["muns"]. Per-MUN: ["<uuid>", "<section>"].
  const orgWideItem = currentMun
    ? null
    : WORKSPACE_NAV_ITEMS.find(
        (item) => !item.exact && item.href.endsWith(`/${segments[0] ?? ""}`),
      );

  const section = currentMun ? getMunNavSection(segments[1] ?? "") : undefined;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex list-none items-center gap-xs">
        <li className="flex items-center gap-xs">
          {currentMun || orgWideItem ? (
            <Link href="/organizer/dashboard" className={LINK_CLASS}>
              Overview
            </Link>
          ) : (
            <span aria-current="page" className="text-body-md font-medium text-ink">
              Overview
            </span>
          )}
        </li>

        {orgWideItem && (
          <li className="flex items-center gap-xs">
            <Chevron />
            <span
              aria-current="page"
              className="truncate text-body-md font-medium text-ink"
            >
              {orgWideItem.label}
            </span>
          </li>
        )}

        {currentMun && (
          <li className="flex min-w-0 items-center gap-xs">
            <Chevron />
            {section ? (
              <Link
                href={munSectionHref(currentMun.id, "setup")}
                className={`${LINK_CLASS} truncate`}
              >
                {currentMun.name}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="truncate text-body-md font-medium text-ink"
              >
                {currentMun.name}
              </span>
            )}
          </li>
        )}

        {currentMun && section && (
          <li className="flex min-w-0 items-center gap-xs">
            <Chevron />
            <span
              aria-current="page"
              className="truncate text-body-md font-medium text-ink"
            >
              {section.title ?? section.label}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
