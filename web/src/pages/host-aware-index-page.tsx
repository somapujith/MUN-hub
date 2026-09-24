import { Suspense } from "react";
import { Navigate } from "react-router";
import { getHostZone, ZONE_DEFAULT_PATH, ZONE_LOGIN_PATH } from "@/lib/host-routing";
import { useSession } from "@/hooks/use-session";
import { HomePage } from "@/pages/home-page";
import { RouteLoadingSkeleton } from "@/components/layout/route-loading-skeleton";
// Lazy: this file is part of the marketplace host's eager entry graph (it's
// the "/" route element), but MunDetailPage is only actually rendered here
// on a wildcard <slug>.munhub.in host (the "mun" zone below) — a plain
// munhub.in/www visit never needs it. Importing the real component directly
// pulled its full source (~20KB+, plus transitive deps like the registration
// card and ad carousel) into every visitor's entry chunk regardless of host.
import { MunDetailPage } from "@/routes.lazy";

// Root ("/") route element for the role-subdomain architecture: renders the
// right landing screen based on which host the app is served from, so
// app./publish./admin.munhub.in and a per-MUN wildcard host all share one
// SPA build without duplicating the route tree per role.
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §7
export function HostAwareIndexPage() {
  const hostZone = getHostZone(window.location.hostname);
  const { data: session, isPending } = useSession();

  switch (hostZone.zone) {
    case "mun":
      return (
        <Suspense fallback={<RouteLoadingSkeleton />}>
          <MunDetailPage slugOverride={hostZone.munSlug} />
        </Suspense>
      );
    case "marketplace":
      return <HomePage />;
    case "organizer":
      // publish.munhub.in opens on its own sign-in page rather than bouncing
      // through the dashboard's auth guard first — the host IS the organizer
      // entrance, so a signed-out visitor should see a login form, not a flash
      // of redirect. The session cookie is shared across munhub.in hosts, so a
      // signed-in delegate lands on the organizer sign-in too, not the
      // organizer workspace.
      if (isPending) return null;
      return (
        <Navigate
          to={session?.role === "ORGANIZER" ? ZONE_DEFAULT_PATH.organizer : ZONE_LOGIN_PATH.organizer}
          replace
        />
      );
    default:
      return <Navigate to={ZONE_DEFAULT_PATH[hostZone.zone]} replace />;
  }
}
