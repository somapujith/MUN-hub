import { Navigate } from "react-router";
import { getHostZone, ZONE_DEFAULT_PATH } from "@/lib/host-routing";
import { HomePage } from "@/pages/home-page";
import { MunDetailPage } from "@/pages/mun-detail-page";

// Root ("/") route element for the role-subdomain architecture: renders the
// right landing screen based on which host the app is served from, so
// app./organize./admin.munhub.in and a per-MUN wildcard host all share one
// SPA build without duplicating the route tree per role.
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §7
export function HostAwareIndexPage() {
  const hostZone = getHostZone(window.location.hostname);

  switch (hostZone.zone) {
    case "mun":
      return <MunDetailPage slugOverride={hostZone.munSlug} />;
    case "marketplace":
      return <HomePage />;
    default:
      return <Navigate to={ZONE_DEFAULT_PATH[hostZone.zone]} replace />;
  }
}
