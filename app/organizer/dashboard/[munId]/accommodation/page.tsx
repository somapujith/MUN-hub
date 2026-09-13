import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { requireOrganizerActor } from "../../auth";
import { getAccommodationForMun } from "./queries";
import {
  AccommodationTable,
  AddAccommodationButton,
} from "./accommodation-table";

/**
 * Accommodation (PRD § 5).
 *
 * Reads via the page-local `./queries.ts` rather than calling
 * `listAccommodationOptions` directly — see the long note at the top of that
 * file. Both list functions in `lib/actions/accommodation.ts` are documented
 * "public read, no auth" and take NO session parameter, so calling them with a
 * munId straight off the URL would expose any organizer's accommodation
 * inventory to any other signed-in organizer. The ownership check lives in the
 * query.
 *
 * Auth: `../../layout.tsx` already gated this route and 404s a mun the actor
 * doesn't own, so this page adds no gate of its own. `requireOrganizerActor` is
 * called only to obtain the actor for the ownership-scoped read — it is
 * `cache()`d, so this shares the layout's single session round trip rather than
 * adding one. `getAccommodationForMun` still re-checks ownership itself; a
 * layout is chrome, not a security boundary.
 *
 * Field coverage: `accommodationOptions` carries name, price, capacity,
 * description and status, and `CreateAccommodationOptionInput` accepts exactly
 * those — so the form covers exactly those. Notably there is NO `currency`
 * column here (unlike `registrationProducts`), because accommodation is priced
 * additively into the same order as the pass.
 */

export const metadata: Metadata = { title: "Accommodation" };

export default async function AccommodationPage({
  params,
}: PageProps<"/organizer/dashboard/[munId]/accommodation">) {
  const { munId } = await params;
  const actor = await requireOrganizerActor();

  const data = await getAccommodationForMun(munId, actor.userId, actor.role);
  if (!data) notFound();

  return (
    <WorkspacePage
      title="Accommodation"
      description="Optional paid stays delegates can add to their registration — billed with the pass in one payment. Each option can ask its own questions, like meal preference or arrival date."
      actions={
        data.options.length > 0 ? (
          <AddAccommodationButton munId={munId} />
        ) : undefined
      }
    >
      <AccommodationTable munId={munId} data={data} />
    </WorkspacePage>
  );
}
