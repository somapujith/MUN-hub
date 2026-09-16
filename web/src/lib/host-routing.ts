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
