import type { Metadata } from "next";
import { UserCogIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Team & Permissions (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Team & Permissions" };

export default function TeamPage() {
  return (
    <WorkspacePage title="Team & permissions">
      <ModulePlaceholder
        icon={UserCogIcon}
        description="Invite team members and scope what each role can reach — finance, registrations, content or check-in."
      />
    </WorkspacePage>
  );
}
