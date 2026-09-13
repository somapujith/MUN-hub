import type { Metadata } from "next";
import { CalendarCheck2Icon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * PLACEHOLDER — Conference Day (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Conference Day" };

export default function ConferenceDayPage() {
  return (
    <WorkspacePage title="Conference day">
      <ModulePlaceholder
        icon={CalendarCheck2Icon}
        description="QR check-in, the live attendance dashboard and delegate lookup for conference-day operations."
      />
    </WorkspacePage>
  );
}
