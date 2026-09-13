import type { Metadata } from "next";
import { MegaphoneIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Communications (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Communications" };

export default function CommunicationsPage() {
  return (
    <WorkspacePage title="Communications">
      <ModulePlaceholder
        icon={MegaphoneIcon}
        description="Targeted email announcements to delegate segments — by committee, payment status or institution."
      />
    </WorkspacePage>
  );
}
