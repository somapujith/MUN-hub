import { WorkspaceShell } from "@/components/organizer/workspace-shell";
import { requireOrganizerActor } from "../auth";
import { listWorkspaceMuns } from "../workspace-queries";

/**
 * Chrome for the two ORGANIZER-WIDE routes: Overview (`/organizer/dashboard`)
 * and My MUNs (`/organizer/dashboard/muns`). No conference is in context here,
 * so the shell gets `currentMun={null}` and the sidebar shows the 2 org-wide
 * items plus a prompt to pick a conference.
 *
 * `(workspace)` is a route group — it adds no URL segment. Its only job is to
 * give these two routes a layout that the sibling `[munId]/` routes don't
 * share, since those need a different `currentMun`.
 *
 * The `requireOrganizerActor()` call is not a duplicated gate — the parent
 * `dashboard/layout.tsx` already redirected anyone unauthorised. A layout
 * simply can't inherit values from its parent, so this re-reads the actor's
 * id/role. It's `cache()`d, so it costs one session query per request total,
 * not one per layout.
 */

export default async function OrganizerWorkspaceLayout({
  children,
}: LayoutProps<"/organizer/dashboard">) {
  const actor = await requireOrganizerActor();
  const muns = await listWorkspaceMuns(actor.userId, actor.role);

  return (
    <WorkspaceShell muns={muns} currentMun={null} role={actor.role}>
      {children}
    </WorkspaceShell>
  );
}
