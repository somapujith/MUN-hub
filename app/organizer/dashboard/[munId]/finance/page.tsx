import type { Metadata } from "next";
import { BanknoteIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Payments & Finance (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Payments & Finance" };

export default function FinancePage() {
  return (
    <WorkspacePage title="Payments & finance">
      <ModulePlaceholder
        icon={BanknoteIcon}
        description="GMV, platform fees, refunds and settlements, reconciled against every registration."
      />
    </WorkspacePage>
  );
}
