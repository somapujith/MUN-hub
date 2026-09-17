import { Navigate } from "react-router";
import { getHostZone, ZONE_DEFAULT_PATH, ZONE_LOGIN_PATH } from "@/lib/host-routing";
import { useSession } from "@/hooks/use-session";
import { HomePage } from "@/pages/home-page";
import { MunDetailPage } from "@/pages/mun-detail-page";

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
      return <MunDetailPage slugOverride={hostZone.munSlug} />;
    case "marketplace":
      return <HomePage />;
    case "organizer":
      // publish.munhub.in opens on its own sign-in page rather than bouncing
      // through the dashboard's auth guard first — the host IS the organizer
      // entrance, so a signed-out visitor should see a login form, not a flash
      // of redirect.
      if (isPending) return null;
      return (
        <Navigate
          to={session ? ZONE_DEFAULT_PATH.organizer : ZONE_LOGIN_PATH.organizer}
          replace
        />
      );
    default:
      return <Navigate to={ZONE_DEFAULT_PATH[hostZone.zone]} replace />;
  }
}
