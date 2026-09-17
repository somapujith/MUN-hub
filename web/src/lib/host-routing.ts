// Resolves which "zone" of the app a hostname belongs to, for the
// role-subdomain architecture (app./publish./admin./api.munhub.in +
// wildcard *.munhub.in for per-MUN slug pages).
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §7
//
// munhub.in/www.munhub.in and any non-munhub.in host (local dev) resolve to
// "marketplace" — path-based routing there is unchanged. In local dev every
// zone shares one origin, so nothing here ever produces a cross-origin URL.

export type HostZone =
  | { zone: "marketplace" }
  | { zone: "student" }
  | { zone: "organizer" }
  | { zone: "admin" }
  | { zone: "mun"; munSlug: string };

type NamedZone = Exclude<HostZone["zone"], "mun">;

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
    // `publish` is the organizer host. `organize` was the original name and is
    // kept as an alias so any link or bookmark made before the rename still
    // lands in the organizer workspace rather than being read as a MUN slug.
    case "publish":
    case "organize":
      return { zone: "organizer" };
    case "admin":
      return { zone: "admin" };
    default:
      return { zone: "mun", munSlug: label };
  }
}

export const ZONE_DEFAULT_PATH: Record<NamedZone, string> = {
  marketplace: "/",
  student: "/dashboard",
  organizer: "/organizer/dashboard",
  admin: "/admin",
};

/** Each zone's own sign-in page — where RequireAuth bounces unauthenticated visitors. */
export const ZONE_LOGIN_PATH: Record<NamedZone, string> = {
  marketplace: "/login",
  student: "/login",
  organizer: "/organizer/login",
  admin: "/admin/login",
};

/** Canonical subdomain per zone — what generated links point at. */
const ZONE_SUBDOMAIN: Record<NamedZone, string | null> = {
  marketplace: null,
  student: "app",
  organizer: "publish",
  admin: "admin",
};

function isProductionHost(hostname: string): boolean {
  return hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`);
}

function currentHostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

/**
 * Resolves a path in another zone to something safe to navigate to from the
 * CURRENT host.
 *
 * In production the zones are separate origins (`publish.munhub.in` vs
 * `munhub.in`), and React Router cannot navigate across origins — a `<Link>`
 * to "/organizer/dashboard" from the marketplace host would just render inside
 * the marketplace host. So this returns an absolute `https://` URL whenever
 * the target zone differs from the current one, and a plain path when it
 * doesn't (including all of local dev, where every zone shares one origin).
 *
 * Callers pair this with `isCrossOrigin` to pick `<a href>` over `<Link to>`.
 */
export function resolveZoneUrl(zone: NamedZone, path: string, hostname: string = currentHostname()): string {
  if (!isProductionHost(hostname)) return path;

  const current = getHostZone(hostname);
  if (current.zone === zone) return path;

  const subdomain = ZONE_SUBDOMAIN[zone];
  return subdomain ? `https://${subdomain}.${ROOT_DOMAIN}${path}` : `https://${ROOT_DOMAIN}${path}`;
}

/**
 * `fetch` credentials mode for API calls made from this host. The API trusts
 * only the marketplace/role hosts with the session cookie; a per-MUN slug host
 * gets anonymous CORS (server/lib/origins.ts), and a browser only lets a page
 * read such a response when the request carried no cookies.
 */
export function apiCredentialsMode(hostname: string = currentHostname()): RequestCredentials {
  return getHostZone(hostname).zone === "mun" ? "omit" : "include";
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

/** Which zone owns a given path, for paths that belong to exactly one zone. */
export function zoneForPath(pathname: string): NamedZone | null {
  if (pathname === "/organizer" || pathname.startsWith("/organizer/")) return "organizer";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

/** The sign-in page an unauthenticated visitor to `pathname` should be sent to. */
export function loginPathFor(pathname: string, hostname: string = currentHostname()): string {
  const byPath = zoneForPath(pathname);
  if (byPath) return ZONE_LOGIN_PATH[byPath];
  const byHost = getHostZone(hostname);
  return byHost.zone === "mun" ? ZONE_LOGIN_PATH.marketplace : ZONE_LOGIN_PATH[byHost.zone];
}

/**
 * If `pathname` belongs to a zone other than the one this host serves,
 * returns the absolute URL on that zone's canonical host; otherwise null.
 *
 * Every host serves the same SPA build, so without this an organizer page
 * would happily render at munhub.in/organizer/... too — the organizer
 * workspace would have two addresses and publish.munhub.in wouldn't actually
 * be where it lives.
 */
export function canonicalUrlFor(pathname: string, search = "", hostname: string = currentHostname()): string | null {
  const owner = zoneForPath(pathname);
  // A per-MUN slug host only renders its own MUN page at "/". Everything else
  // (registering, signing in, browsing) belongs to a host the API trusts with
  // the session cookie — it never does for slug hosts (see apiCredentialsMode).
  if (getHostZone(hostname).zone === "mun") {
    return pathname === "/" ? null : resolveZoneUrl(owner ?? "marketplace", `${pathname}${search}`, hostname);
  }
  // Scoped to the organizer workspace — that's the zone that has been given a
  // dedicated host. /admin/* is left where it's served today.
  if (owner !== "organizer") return null;
  const url = resolveZoneUrl(owner, `${pathname}${search}`, hostname);
  return isCrossOrigin(url) ? url : null;
}
