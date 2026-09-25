import { useSession } from "@/hooks/use-session";
import { resolveZoneUrl } from "@/lib/host-routing";

/**
 * Where a "List your MUN" call to action should send the current viewer, or
 * `null` when it shouldn't be shown at all.
 *
 * Organizer and delegate accounts are separate, and a delegate account can't
 * become an organizer one — so a signed-in delegate (or staff) account never
 * sees an organizer-registration entry point. Signed-out visitors go to
 * the organizer login (which creates the account on first use — there's no
 * separate signup); organizers go straight to the host application. Hidden
 * while the session is loading so a delegate never sees it flash in.
 *
 * Returns an absolute publish.munhub.in URL in production; React Router's
 * `<Link>` treats that as a normal cross-origin navigation.
 */
export function useListYourMunHref(): string | null {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return resolveZoneUrl("organizer", "/organizer/login");
  if (session.role === "ORGANIZER") return resolveZoneUrl("organizer", "/organizer/apply");
  return null;
}
