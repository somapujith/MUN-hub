import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { getMunSetup } from "./queries";
import { SetupTabs } from "./setup-tabs";
import { DatesVenueForm, GeneralForm } from "./setup-forms";
import { VerificationPanel } from "./verification-panel";

/**
 * MUN Setup (PRD § 9).
 *
 * Seven sub-sections render as a tab strip inside this one route — they are
 * not sidebar entries, per `../../nav-config.ts`. Two of them (General, Dates
 * & venue) are real forms against `updateMunDetails`; the other five are
 * honest placeholders because no columns exist behind them (see `setup-tabs.tsx`).
 *
 * No auth or ownership check here: `../layout.tsx` gates the route and 404s a
 * mun this actor doesn't own, and every mutation re-checks server-side inside
 * `lib/actions/mun-config.ts`.
 *
 * The `notFound()` below is not that gate — it only covers the narrow race
 * where the mun is deleted between the layout's read and this one.
 */

export const metadata: Metadata = { title: "MUN Setup" };

export default async function SetupPage({
  params,
}: PageProps<"/organizer/dashboard/[munId]/setup">) {
  const { munId } = await params;
  const mun = await getMunSetup(munId);

  if (!mun) notFound();

  return (
    <WorkspacePage
      title="MUN setup"
      description="Your conference's core record — how it's named, when it runs, and where delegates are going."
    >
      <VerificationPanel munId={mun.id} status={mun.status} />

      <SetupTabs
        generalPanel={
          <GeneralForm
            munId={mun.id}
            name={mun.name}
            edition={mun.edition}
            theme={mun.theme}
            description={mun.description}
          />
        }
        datesVenuePanel={
          <DatesVenueForm
            munId={mun.id}
            startDate={mun.startDate}
            endDate={mun.endDate}
            venue={mun.venue}
            city={mun.city}
            country={mun.country}
          />
        }
      />
    </WorkspacePage>
  );
}
