// Resolves which "zone" of the app a hostname belongs to, for the
// role-subdomain architecture (app./organize./admin./api.munhub.in +
// wildcard *.munhub.in for per-MUN slug pages).
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §7
//
// munhub.in/www.munhub.in and any non-munhub.in host (local dev) resolve to
// "marketplace" — path-based routing there is unchanged from today. In
// production, munhub.in/www still serve the existing Next.js app on Vercel,
// so this branch is reachable only in local dev for now.

export type HostZone =
  | { zone: "marketplace" }
  | { zone: "student" }
  | { zone: "organizer" }
  | { zone: "admin" }
  | { zone: "mun"; munSlug: string };

const ROOT_DOMAIN = "munhub.in";

export function getHostZone(hostname: string): HostZone {
  if (!hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    return { zone: "marketplace" };
  }

  const label = hostname.slice(0, -(ROOT_DOMAIN.length + 1));

  switch (label) {
    case "www":
      return { zone: "marketplace" };
    case "app":
      return { zone: "student" };
    case "organize":
      return { zone: "organizer" };
    case "admin":
      return { zone: "admin" };
    default:
      return { zone: "mun", munSlug: label };
  }
}

export const ZONE_DEFAULT_PATH: Record<Exclude<HostZone["zone"], "mun">, string> = {
  marketplace: "/",
  student: "/dashboard",
  organizer: "/organizer/dashboard",
  admin: "/admin",
};

const ZONE_SUBDOMAIN: Record<Exclude<HostZone["zone"], "mun">, string | null> = {
  marketplace: null,
  student: "app",
  organizer: "organize",
  admin: "admin",
};

/**
 * Resolves a path in another zone to something safe to navigate to from the
 * CURRENT host.
 *
 * In production the zones are separate origins (`organize.munhub.in` vs
 * `munhub.in`), and React Router cannot navigate across origins — a `<Link>`
 * to "/organizer/dashboard" from the marketplace host would just 404 into the
 * marketplace SPA. So this returns an absolute `https://` URL whenever the
 * target zone differs from the current one, and a plain path when it doesn't
 * (including all of local dev, where every zone shares one origin).
 *
 * Callers pair this with `isCrossOrigin` to pick `<a href>` over `<Link to>`.
 */
export function resolveZoneUrl(
  zone: Exclude<HostZone["zone"], "mun">,
  path: string,
  hostname: string = typeof window === "undefined" ? "" : window.location.hostname,
): string {
  const isProductionHost = hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`);
  if (!isProductionHost) return path;

  const current = getHostZone(hostname);
  if (current.zone === zone) return path;

  const subdomain = ZONE_SUBDOMAIN[zone];
  return subdomain ? `https://${subdomain}.${ROOT_DOMAIN}${path}` : `https://${ROOT_DOMAIN}${path}`;
}

/** True when `resolveZoneUrl` produced an absolute URL, i.e. a full page navigation is required. */
export function isCrossOrigin(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** Where a signed-in user of this role belongs, as a navigable URL from the current host. */
export function homeUrlForRole(role: string): string {
  switch (role) {
    case "ORGANIZER":
      return resolveZoneUrl("organizer", ZONE_DEFAULT_PATH.organizer);
    case "OPERATIONS":
    case "ADMIN":
    case "SUPER_ADMIN":
      return resolveZoneUrl("admin", ZONE_DEFAULT_PATH.admin);
    default:
      return resolveZoneUrl("student", ZONE_DEFAULT_PATH.student);
  }
}
