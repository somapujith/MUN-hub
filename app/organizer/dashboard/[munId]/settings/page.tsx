import type { Metadata } from "next";
import { SettingsIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Settings (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <WorkspacePage title="Settings">
      <ModulePlaceholder
        icon={SettingsIcon}
        description="Conference-level preferences, the public page URL, and archiving this MUN."
      />
    </WorkspacePage>
  );
}
