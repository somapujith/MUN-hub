import type { Metadata } from "next";
import { ChartNoAxesColumnIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Analytics (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <WorkspacePage title="Analytics">
      <ModulePlaceholder
        icon={ChartNoAxesColumnIcon}
        description="Registration trends, committee utilisation, the conversion funnel and audience breakdowns."
      />
    </WorkspacePage>
  );
}
