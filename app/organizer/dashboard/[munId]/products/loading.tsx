import {
  DashboardTableSkeleton,
  StatStripSkeleton,
  WorkspacePageSkeleton,
} from "@/components/organizer/workspace-skeletons";

/**
 * Mirrors `./page.tsx` + `./product-table.tsx`: header with an "Add product"
 * action, the hairline summary strip, then the product rows.
 *
 * The action slot is drawn because it is conditional on `data.products.length`
 * — a MUN with zero products renders no button and an empty state instead.
 * Drawing it is the right bet: the loading state only matters for organizers
 * who return to a configured conference, and a missing-then-appearing button
 * shifts the header more than a present-then-absent one.
 */
export default function ProductsLoading() {
  return (
    <WorkspacePageSkeleton titleWidth="20rem" actions={1}>
      <div className="flex flex-col gap-lg">
        <StatStripSkeleton />
        <DashboardTableSkeleton rows={4} columns={5} />
      </div>
    </WorkspacePageSkeleton>
  );
}
