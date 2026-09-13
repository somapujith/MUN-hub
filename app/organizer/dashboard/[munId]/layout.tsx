import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/organizer/workspace-shell";
import { requireOrganizerActor } from "../auth";
import { getWorkspaceMun, listWorkspaceMuns } from "../workspace-queries";

/**
 * Chrome + ownership gate for the 15 PER-MUN sections
 * (`/organizer/dashboard/[munId]/<section>`).
 *
 * Two things happen here that the org-wide sibling layout doesn't do:
 *
 *   1. Ownership. `getWorkspaceMun` returns null both for "no such mun" and
 *      "not yours", and both render the same 404. Probing a fabricated uuid
 *      and probing a real one you don't own are therefore indistinguishable
 *      from the outside. Note this is still not the security boundary —
 *      `assertOwnsOrAdmin` inside `lib/actions/*` re-checks on every mutation,
 *      because a layout doesn't re-run on client navigation between children.
 *
 *   2. Conference context. The resolved mun flows into `<WorkspaceShell>`,
 *      which is what unlocks the 15 sections in the sidebar, names the
 *      switcher, and puts the live status badge in the top bar.
 *
 * Section pages under here should NOT re-check auth or ownership — read
 * `params.munId` and call the frozen `lib/actions/*` contract, which does its
 * own server-side check. Routing contract: `../nav-config.ts`.
 */

export default async function MunWorkspaceLayout({
  children,
  params,
}: LayoutProps<"/organizer/dashboard/[munId]">) {
  const { munId } = await params;
  const actor = await requireOrganizerActor();

  const [muns, currentMun] = await Promise.all([
    listWorkspaceMuns(actor.userId, actor.role),
    getWorkspaceMun(munId, actor.userId, actor.role),
  ]);

  if (!currentMun) notFound();

  return (
    <WorkspaceShell muns={muns} currentMun={currentMun} role={actor.role}>
      {children}
    </WorkspaceShell>
  );
}
