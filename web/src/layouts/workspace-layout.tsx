import { Outlet } from "react-router";
import { RequireOrganizer } from "@/guards/require-organizer";
import { WorkspaceShell } from "@/components/organizer/workspace-shell";
import { MOCK_ORGANIZER_SESSION } from "@/mocks/session";
import { MOCK_WORKSPACE_MUNS } from "@/mocks/organizer";

/**
 * Org-wide organizer routes: Overview + My MUNs.
 * Analogue of Next app/organizer/dashboard/(workspace)/layout.tsx
 */
export function WorkspaceLayout() {
  return (
    <RequireOrganizer>
      <WorkspaceShell
        muns={MOCK_WORKSPACE_MUNS}
        currentMun={null}
        role={MOCK_ORGANIZER_SESSION.role}
      >
        <Outlet />
      </WorkspaceShell>
    </RequireOrganizer>
  );
}
