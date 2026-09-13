import type { Metadata } from "next";
import { UsersRoundIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Executive Board (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Executive Board" };

export default function ExecutiveBoardPage() {
  return (
    <WorkspacePage title="Executive Board">
      <ModulePlaceholder
        icon={UsersRoundIcon}
        description="Chairs, co-chairs, directors and moderators, with their bios, photos and committee assignments."
      />
    </WorkspacePage>
  );
}
