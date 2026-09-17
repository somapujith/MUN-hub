import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { loginPathFor } from "@/lib/host-routing";

/**
 * UX-only auth gate. Server is authoritative — every protected API route
 * derives identity from the session cookie; never trust client-supplied userId.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="content-container flex flex-col gap-md py-xxl" aria-busy="true">
        <Skeleton className="h-9 w-[min(100%,16rem)] rounded-sm" />
        <Skeleton className="h-4 w-[min(100%,24rem)] rounded-sm" />
        <Skeleton className="h-[200px] w-full rounded-md" />
      </div>
    );
  }

  if (!session) {
    const redirectTo = encodeURIComponent(
      `${location.pathname}${location.search}${location.hash}`,
    );
    // Organizer pages bounce to the organizer sign-in, not the delegate one —
    // an organizer who hits a stale link on publish.munhub.in should land on
    // that host's own login page.
    return <Navigate to={`${loginPathFor(location.pathname)}?redirectTo=${redirectTo}`} replace />;
  }

  return children;
}
