import type { Metadata } from "next";
import { requireOrganizerActor } from "./auth";

/**
 * ORGANIZER WORKSPACE — auth gate.
 * ============================================================================
 * The single access check for every route under `/organizer/dashboard`.
 * Signed out -> `/login?redirectTo=…`; wrong role -> `/`. Because it lives at
 * the top of the segment, a module agent adding a new section page gets the
 * gate for free and cannot ship an ungated route by forgetting it.
 *
 * This is UX and defence in depth, NOT the security boundary. A layout does
 * not re-run on client-side navigation between its own children, so every
 * mutation still re-derives the actor server-side via `getSession()` inside
 * `lib/actions/*` (`assertOwnsOrAdmin`). Never rely on this gate alone.
 *
 * Chrome deliberately does NOT live here — the sidebar needs the `[munId]`
 * segment, which is a child of this layout and therefore unreachable from it.
 * The two sibling layouts below render `<WorkspaceShell>` instead:
 *
 *   (workspace)/layout.tsx   org-wide  — Overview, My MUNs
 *   [munId]/layout.tsx       per-MUN   — the 15 conference sections
 *
 * Routing contract and how to add a section: `./nav-config.ts`.
 */

export const metadata: Metadata = {
  title: { default: "Organizer workspace", template: "%s · Organizer" },
  robots: { index: false },
};

export default async function OrganizerDashboardGateLayout({
  children,
}: LayoutProps<"/organizer/dashboard">) {
  await requireOrganizerActor();
  return children;
}
