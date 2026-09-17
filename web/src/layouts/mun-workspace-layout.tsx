import { Link, Navigate, Outlet, useParams } from "react-router";
import { RequireOrganizer } from "@/guards/require-organizer";
import { ReviewLockBanner } from "@/components/organizer/go-live/review-lock-banner";
import { WorkspaceShell } from "@/components/organizer/workspace-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { useOrganizerWorkspaceMuns } from "@/layouts/workspace-layout";

/**
 * Per-MUN organizer sections — analogue of [munId]/layout.tsx.
 *
 * The current MUN is resolved from the organizer's own conferences
 * (GET /organizer/workspace/overview). An id the organizer doesn't own, or
 * that doesn't exist, goes back to My MUNs. The API re-checks ownership on
 * every section request regardless.
 */
export function MunWorkspaceLayout() {
  return (
    <RequireOrganizer>
      <MunWorkspace />
    </RequireOrganizer>
  );
}

function MunWorkspace() {
  const { munId = "" } = useParams();
  const { data: session } = useSession();
  const workspace = useOrganizerWorkspaceMuns();
  const role = session?.role ?? "ORGANIZER";

  if (workspace.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-md p-lg" aria-busy="true" aria-label="Loading conference">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (workspace.isError) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-start gap-sm p-lg">
        <h1 className="font-display text-title-md text-ink">Couldn't load your conferences</h1>
        <p className="text-body-md text-muted-foreground">{workspace.error.message}</p>
        <div className="flex gap-sm">
          <Button size="sm" onClick={() => void workspace.refetch()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" render={<Link to="/organizer/dashboard/muns" />}>
            Back to My MUNs
          </Button>
        </div>
      </div>
    );
  }

  const muns = workspace.data.muns;
  const currentMun = muns.find((mun) => mun.id === munId);

  if (!currentMun) {
    return <Navigate to="/organizer/dashboard/muns" replace />;
  }

  return (
    <WorkspaceShell muns={muns} currentMun={currentMun} role={role}>
      <ReviewLockBanner mun={currentMun} />
      <Outlet />
    </WorkspaceShell>
  );
}
