import type { Metadata } from "next";
import { AwardIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Results & Awards (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Results & Awards" };

export default function ResultsPage() {
  return (
    <WorkspacePage title="Results & awards">
      <ModulePlaceholder
        icon={AwardIcon}
        description="Record Best Delegate and commendation awards, then submit them for MUN Hub verification."
      />
    </WorkspacePage>
  );
}
