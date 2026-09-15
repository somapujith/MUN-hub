import { Navigate, Outlet, useParams } from "react-router";
import { RequireAuth } from "@/guards/require-auth";
import { WorkspaceShell } from "@/components/organizer/workspace-shell";
import { MOCK_ORGANIZER_SESSION } from "@/mocks/session";
import { MOCK_WORKSPACE_MUNS, getMockWorkspaceMun } from "@/mocks/organizer";

/**
 * Per-MUN organizer sections — analogue of [munId]/layout.tsx
 */
export function MunWorkspaceLayout() {
  const { munId = "" } = useParams();
  const currentMun = getMockWorkspaceMun(munId);

  if (!currentMun) {
    return <Navigate to="/organizer/dashboard/muns" replace />;
  }

  return (
    <RequireAuth>
      <WorkspaceShell
        muns={MOCK_WORKSPACE_MUNS}
        currentMun={currentMun}
        role={MOCK_ORGANIZER_SESSION.role}
      >
        <Outlet />
      </WorkspaceShell>
    </RequireAuth>
  );
}
