"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { munSectionHref } from "@/app/organizer/dashboard/nav-config";
import type { WorkspaceMun } from "@/app/organizer/dashboard/workspace-queries";

/**
 * Conference context + switcher, pinned under the workspace wordmark.
 *
 * Switching keeps you on the section you were already looking at: if you're on
 * Committees for MUN A, picking MUN B lands on Committees for MUN B rather
 * than bouncing you to that MUN's Overview. The current segment is read with
 * `useSelectedLayoutSegments()` instead of parsing `usePathname()` so it stays
 * correct if the route shape ever changes.
 *
 * With exactly one MUN this still renders as a menu rather than static text —
 * the menu is also where "Create another conference" lives, and an organizer
 * with one conference is precisely who needs that.
 */

interface MunSwitcherProps {
  muns: readonly WorkspaceMun[];
  /** The MUN whose section is currently open, or null on an org-wide route. */
  currentMun: WorkspaceMun | null;
}

export function MunSwitcher({ muns, currentMun }: MunSwitcherProps) {
  // Under `app/organizer/dashboard/layout.tsx` the segments inside a per-MUN
  // route are `[munId], <section>`. Anything else is an org-wide route.
  const segments = useSelectedLayoutSegments();
  const currentSection = currentMun ? (segments[1] ?? null) : null;

  function hrefFor(mun: WorkspaceMun): string {
    return currentSection
      ? munSectionHref(mun.id, currentSection)
      : munSectionHref(mun.id, "setup");
  }

  if (muns.length === 0) {
    return (
      <div className="flex flex-col gap-xs rounded-md border border-dashed border-border p-sm">
        <p className="text-body-md text-pretty text-muted-foreground">
          No conferences yet.
        </p>
        <Button size="sm" render={<Link href="/organizer/apply" />}>
          <PlusIcon aria-hidden strokeWidth={1.75} />
          Apply to host a MUN
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="h-auto w-full justify-between gap-xs px-sm py-xs text-left"
            aria-label={
              currentMun
                ? `Conference: ${currentMun.name}. Switch conference`
                : "Choose a conference"
            }
          >
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-[12px] font-normal tracking-[0.16px] text-muted-foreground uppercase">
                Conference
              </span>
              <span className="truncate text-body-md font-medium">
                {currentMun ? currentMun.name : "All conferences"}
              </span>
            </span>
            <ChevronsUpDownIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </Button>
        }
      />

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="max-h-80 w-(--anchor-width) min-w-64"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your conferences</DropdownMenuLabel>
          {muns.map((mun) => {
            const selected = mun.id === currentMun?.id;
            return (
              <DropdownMenuItem
                key={mun.id}
                className="h-auto items-start gap-xs py-xs"
                render={<Link href={hrefFor(mun)} />}
              >
                <CheckIcon
                  aria-hidden
                  strokeWidth={2}
                  className={selected ? "mt-px" : "mt-px opacity-0"}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-xxs">
                  <span className="truncate font-medium text-ink">
                    {mun.name}
                  </span>
                  <MunStatusBadge status={mun.status} className="w-fit" />
                </span>
                {selected && <span className="sr-only">(current)</span>}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/organizer/apply" />}>
            <PlusIcon aria-hidden strokeWidth={1.75} />
            Apply to host another MUN
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
