import type { ReactNode } from "react";
import { WorkspaceSidebar } from "@/components/organizer/workspace-sidebar";
import { WorkspaceTopbar } from "@/components/organizer/workspace-topbar";
import { SupportWidget } from "@/components/support/support-widget";
import type { WorkspaceMun } from "@/types/organizer";
import type { Role } from "@/types/enums";

interface WorkspaceShellProps {
  muns: readonly WorkspaceMun[];
  currentMun: WorkspaceMun | null;
  role: Role;
  children: ReactNode;
}

export function WorkspaceShell({ muns, currentMun, role, children }: WorkspaceShellProps) {
  return (
    <div className="flex min-h-full flex-1 lg:h-dvh lg:overflow-hidden">
      <aside className="hidden w-[17.5rem] shrink-0 border-r border-sidebar-border lg:block">
        <WorkspaceSidebar muns={muns} currentMun={currentMun} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col lg:h-dvh lg:overflow-y-auto">
        <WorkspaceTopbar muns={muns} currentMun={currentMun} role={role} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
      <SupportWidget />
    </div>
  );
}
