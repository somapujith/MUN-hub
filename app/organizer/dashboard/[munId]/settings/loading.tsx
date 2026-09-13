import {
  ModulePlaceholderSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx`: a `<WorkspacePage title="Settings">` with no
 * description, wrapping a `<ModulePlaceholder>`.
 *
 * Deliberately NOT a form skeleton even though Settings will obviously become
 * one. A skeleton promises the shape of what is about to appear; drawing input
 * rows here would hand off to a dashed "not built yet" panel and read as a
 * failed load. Swap `<ModulePlaceholderSkeleton>` for
 * `<DashboardFormSkeleton>` in the same commit that builds the real module.
 */
export default function SettingsLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="8rem" hasDescription={false}>
      <ModulePlaceholderSkeleton />
    </WorkspacePageSkeleton>
  );
}
