import { Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { RequireOrganizer } from "@/guards/require-organizer";
import { WorkspaceShell } from "@/components/organizer/workspace-shell";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/api/query-keys";
import { getOrganizerWorkspaceOverview } from "@/api/organizer-dashboard";

/**
 * The signed-in organizer's own conferences, for the workspace shell's MUN
 * switcher. Same query key as the Overview / My MUNs pages, so the shell and
 * the page share one request.
 */
export function useOrganizerWorkspaceMuns() {
  return useQuery({
    queryKey: queryKeys.organizerWorkspace(),
    queryFn: getOrganizerWorkspaceOverview,
  });
}

/**
 * Org-wide organizer routes: Overview + My MUNs.
 * Analogue of Next app/organizer/dashboard/(workspace)/layout.tsx
 */
export function WorkspaceLayout() {
  return (
    <RequireOrganizer>
      <OrgWorkspace />
    </RequireOrganizer>
  );
}

function OrgWorkspace() {
  const { data: session } = useSession();
  const workspace = useOrganizerWorkspaceMuns();

  return (
    <WorkspaceShell
      muns={workspace.data?.muns ?? []}
      currentMun={null}
      role={session?.role ?? "ORGANIZER"}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
