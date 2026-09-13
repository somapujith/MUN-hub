import type { Metadata } from "next";
import { FolderOpenIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Documents & Media (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Documents & Media" };

export default function DocumentsPage() {
  return (
    <WorkspacePage title="Documents & media">
      <ModulePlaceholder
        icon={FolderOpenIcon}
        description="Brochures, handbooks, the logo, cover image and gallery, with per-file public visibility."
      />
    </WorkspacePage>
  );
}
