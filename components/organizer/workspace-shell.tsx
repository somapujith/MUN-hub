import type { ReactNode } from "react";
import { WorkspaceSidebar } from "@/components/organizer/workspace-sidebar";
import { WorkspaceTopbar } from "@/components/organizer/workspace-topbar";
import { SupportWidget } from "@/components/support/support-widget";
import type { WorkspaceMun } from "@/app/organizer/dashboard/workspace-queries";
import type { Role } from "@/lib/db/schema-enums";

/**
 * The organizer workspace chrome: persistent left rail at `lg`+, drawer below,
 * 56px top bar, scrollable content column. Deliberately not `SiteHeader` /
 * `SiteFooter` — see `workspace-topbar.tsx` for why a workspace gets different
 * chrome from the marketing site.
 *
 * WHY THIS IS A COMPONENT AND NOT JUST `dashboard/layout.tsx`
 * ----------------------------------------------------------
 * The sidebar needs to know which MUN you're inside, and that id lives in the
 * `[munId]` segment — a *child* of `dashboard/`. A layout only receives its own
 * params, so `dashboard/layout.tsx` structurally cannot read it. Rather than
 * scraping the pathname out of `headers()` (which defeats partial prerendering
 * and breaks the moment the route shape changes), the two sibling layouts each
 * render this shell with the context they actually have:
 *
 *   (workspace)/layout.tsx  -> currentMun={null}   org-wide: Overview, My MUNs
 *   [munId]/layout.tsx      -> currentMun={mun}    the 15 per-MUN sections
 *
 * They are siblings under `dashboard/layout.tsx` (which holds the auth gate),
 * so exactly one of them is ever mounted and the shell never nests inside
 * itself. Cost of the split: switching between an org-wide route and a per-MUN
 * route remounts the rail. That is one remount per context switch, which is
 * also exactly when the rail's contents legitimately change.
 */

interface WorkspaceShellProps {
  muns: readonly WorkspaceMun[];
  currentMun: WorkspaceMun | null;
  role: Role;
  children: ReactNode;
}

export function WorkspaceShell({
  muns,
  currentMun,
  role,
  children,
}: WorkspaceShellProps) {
  return (
    <div className="flex min-h-full flex-1 lg:h-dvh lg:overflow-hidden">
      {/* `hidden`, not width-0: below `lg` the drawer already renders these
          links, and two copies in the tab order is a keyboard trap in slow
          motion. */}
      <aside className="hidden w-[17.5rem] shrink-0 border-r border-sidebar-border lg:block">
        <WorkspaceSidebar muns={muns} currentMun={currentMun} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:h-dvh lg:overflow-y-auto">
        <WorkspaceTopbar muns={muns} currentMun={currentMun} role={role} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>

      {/* Top-level sibling, not nested in either scroll container above —
          `fixed` positioning is relative to the viewport as long as no
          ancestor sets `transform`/`filter`/`perspective`, which neither
          does. Organizer-only: ADMIN/OPERATIONS/SUPER_ADMIN can view this
          workspace too but get their own `/admin/support` queue instead. */}
      {role === "ORGANIZER" && <SupportWidget role="ORGANIZER" inboxHref="/organizer/support" />}
    </div>
  );
}
