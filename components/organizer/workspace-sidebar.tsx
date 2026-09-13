"use client";

import Link from "next/link";
import { ArrowLeftIcon, GlobeIcon } from "lucide-react";
import { cn } from "cn";
import { WorkspaceNav } from "@/components/organizer/workspace-nav";
import { MunSwitcher } from "@/components/organizer/mun-switcher";
import type { WorkspaceMun } from "@/app/organizer/dashboard/workspace-queries";
import type { MunStatus } from "@/lib/db/schema-enums";

/**
 * Sidebar body — the wordmark, switcher, nav list and footer, with no
 * positioning of its own. The desktop rail (`workspace-shell.tsx`) and the
 * mobile drawer (`workspace-mobile-nav.tsx`) each supply their own container,
 * so this is the only place the contents are described.
 *
 * Client, not server: the drawer hands down an `onNavigate` callback to close
 * itself on link activation, and a function prop cannot cross a server
 * boundary. Everything it renders (`WorkspaceNav`, `MunSwitcher`) is already a
 * client component, so this costs nothing extra.
 */

/** Statuses where `/mun/[slug]` actually resolves — see `organizer-mun-card`. */
const PUBLICLY_VISIBLE: readonly MunStatus[] = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "COMPLETED",
];

interface WorkspaceSidebarProps {
  muns: readonly WorkspaceMun[];
  currentMun: WorkspaceMun | null;
  /** Drawer passes a close handler; the persistent rail passes nothing. */
  onNavigate?: () => void;
  className?: string;
}

export function WorkspaceSidebar({
  muns,
  currentMun,
  onNavigate,
  className,
}: WorkspaceSidebarProps) {
  const canPreview =
    currentMun !== null && PUBLICLY_VISIBLE.includes(currentMun.status);

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-sidebar", className)}>
      <div className="flex flex-col gap-sm border-b border-sidebar-border p-sm">
        <Link
          href="/"
          className="flex w-fit items-center gap-xs rounded-sm px-xs py-xxs font-display text-title-sm tracking-[-0.006em] text-ink outline-none transition-colors duration-150 ease-out hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
        >
          MUN Hub
          <span className="rounded-xs bg-surface-strong px-xxs py-px text-[11px] font-medium tracking-[0.16px] text-body uppercase dark:bg-muted dark:text-muted-foreground">
            Organizer
          </span>
        </Link>

        <MunSwitcher muns={muns} currentMun={currentMun} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-sm pr-sm pl-xs">
        <WorkspaceNav munId={currentMun?.id ?? null} onNavigate={onNavigate} />
      </div>

      <div className="flex flex-col gap-xxs border-t border-sidebar-border p-sm">
        {canPreview && (
          <Link
            href={`/mun/${currentMun.slug}`}
            className="flex items-center gap-xs rounded-sm px-xs py-[7px] text-body-md text-link outline-none transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-link-active focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
          >
            <GlobeIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-4 shrink-0"
            />
            View public listing
          </Link>
        )}
        <Link
          href="/muns"
          onClick={onNavigate}
          className="flex items-center gap-xs rounded-sm px-xs py-[7px] text-body-md text-muted-foreground outline-none transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
        >
          <ArrowLeftIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-4 shrink-0"
          />
          Back to marketplace
        </Link>
      </div>
    </div>
  );
}
