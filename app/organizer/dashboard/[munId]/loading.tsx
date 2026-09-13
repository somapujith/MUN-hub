import { WorkspacePageSkeleton } from "@/components/organizer/workspace-skeletons";

/**
 * `/organizer/dashboard/[munId]` — the bare conference URL.
 *
 * `./page.tsx` renders nothing: it `redirect()`s straight to the Setup
 * section. So this skeleton is intentionally minimal — a header bar and
 * nothing else. It exists to cover the gap between `[munId]/layout.tsx`
 * resolving (which is where the real wait is: `listWorkspaceMuns` +
 * `getWorkspaceMun` in parallel, plus the ownership check) and the redirect
 * firing, at which point `setup/loading.tsx` takes over.
 *
 * Drawing a full table or form body here would be actively wrong: whatever it
 * promised would be replaced milliseconds later by Setup's quite different
 * layout. A title bar is the honest amount of structure to commit to for a URL
 * that has no content of its own.
 */
export default function MunWorkspaceIndexLoading() {
  return <WorkspacePageSkeleton titleWidth="12rem" hasDescription={false} />;
}
