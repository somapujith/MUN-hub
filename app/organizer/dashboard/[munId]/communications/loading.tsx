import {
  ModulePlaceholderSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx`: a `<WorkspacePage title="Communications">` with no
 * description, wrapping a `<ModulePlaceholder>`. The section is still an
 * unbuilt module, so the skeleton stands in for the dashed "not yet" panel —
 * when the real module lands, swap the body here for a table/form/stat
 * skeleton to match it.
 *
 * The sidebar and top bar are NOT drawn: `[munId]/layout.tsx` renders
 * `<WorkspaceShell>` above this Suspense boundary and stays painted.
 */
export default function CommunicationsLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="13rem" hasDescription={false}>
      <ModulePlaceholderSkeleton />
    </WorkspacePageSkeleton>
  );
}
