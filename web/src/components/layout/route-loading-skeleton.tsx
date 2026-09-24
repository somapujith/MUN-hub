import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic content-area loading placeholder for route-level code-split
 * boundaries (organizer workspace, admin console) — shown for the brief
 * window while a lazy route chunk downloads, not while data loads (each
 * page already has its own data-loading skeleton/spinner for that, e.g.
 * MunWorkspaceLayout's `workspace.isPending` branch). Deliberately generic
 * (same three-block shape MunWorkspaceLayout already used inline for its own
 * loading state) since one component covers many differently-shaped pages —
 * this is only ever on screen for a chunk fetch, typically cached after the
 * first visit.
 */
export function RouteLoadingSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-md p-lg" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
