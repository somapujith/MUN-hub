import { redirect } from "next/navigation";
import { munSectionHref } from "../nav-config";

/**
 * `/organizer/dashboard/[munId]` has no content of its own — every per-MUN
 * screen is a named section. Rather than 404 a URL an organizer can plausibly
 * type (or that a future link might build by concatenation), send them to the
 * first section in the sidebar.
 *
 * The redirect is safe without an ownership check: `[munId]/layout.tsx` runs
 * first and 404s an id the actor doesn't own, so this only ever fires for a
 * mun they can already reach.
 */
export default async function MunWorkspaceIndex({
  params,
}: PageProps<"/organizer/dashboard/[munId]">) {
  const { munId } = await params;
  redirect(munSectionHref(munId, "setup"));
}
