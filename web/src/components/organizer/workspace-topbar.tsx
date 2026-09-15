import { WorkspaceMobileNav } from "@/components/organizer/workspace-mobile-nav";
import { WorkspaceBreadcrumb } from "@/components/organizer/workspace-breadcrumb";
import { SiteHeaderUserMenu } from "@/components/layout/site-header-user-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import type { WorkspaceMun } from "@/types/organizer";
import type { Role } from "@/types/enums";

interface WorkspaceTopbarProps {
  muns: readonly WorkspaceMun[];
  currentMun: WorkspaceMun | null;
  role: Role;
}

export function WorkspaceTopbar({ muns, currentMun, role }: WorkspaceTopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-sm border-b border-border bg-background/95 px-md backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <WorkspaceMobileNav muns={muns} currentMun={currentMun} />
      <div className="flex min-w-0 flex-1 items-center gap-sm">
        <WorkspaceBreadcrumb currentMun={currentMun} />
        {currentMun && (
          <MunStatusBadge status={currentMun.status} className="hidden shrink-0 sm:inline-flex" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-xs">
        <ThemeToggle />
        <SiteHeaderUserMenu role={role} dashboardHref="/organizer/dashboard" />
      </div>
    </header>
  );
}
