import type { Metadata } from "next";
import { ListChecksIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Registration Form (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Registration Form" };

export default function FormPage() {
  return (
    <WorkspacePage title="Registration form">
      <ModulePlaceholder
        icon={ListChecksIcon}
        description="The form builder that replaces Google Forms: field types, validation and conditional logic."
      />
    </WorkspacePage>
  );
}
