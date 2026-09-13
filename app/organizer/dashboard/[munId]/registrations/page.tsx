import type { Metadata } from "next";
import { FilterXIcon, UsersIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { WorkspaceEmptyState } from "@/components/organizer/workspace-empty-state";
import { DelegateTable } from "@/components/organizer/delegate-table";
import {
  PAYMENT_STATUS_OPTIONS,
  RegistrationFilterBar,
} from "@/components/organizer/registration-filter-bar";
import { getDelegateList, type DelegateFilters } from "@/lib/actions/organizer-dashboard";
import { listCommittees } from "@/lib/actions/mun-config";
import { munSectionHref } from "../../nav-config";

/**
 * Registrations — PRD § 17. The delegate roster for one conference.
 *
 * VIEW + FILTER ONLY, DELIBERATELY.
 * PRD § 17 also specifies Edit allocation / Assign committee / Assign
 * portfolio / Cancel / Refund / Export / Contact delegate. None of those have
 * a server action in `lib/actions/*`, and `lib/**` is frozen contract surface
 * this session doesn't own. Rendering them — even disabled — would advertise
 * capability the product doesn't have, so they're absent entirely. The one
 * per-row affordance is a native `<details>` expander over data already
 * fetched. Wire the mutations here when the backend lands them.
 *
 * FILTERING IS SERVER-SIDE AND ONLY AS WIDE AS THE CONTRACT.
 * `DelegateFilters` is exactly `{ committeeId?: string; paymentStatus?: string }`.
 * Both arrive as search params and are handed to `getDelegateList`, so the
 * database does the work and a shared/bookmarked URL reproduces the view. PRD
 * § 17's other six filters (portfolio, registration type, date, institution,
 * city, attendance) are not in `DelegateFilters` and are not faked client-side.
 *
 * No auth or ownership check here: `../../layout.tsx` gates the route and
 * `getDelegateList` re-derives the actor from `getSession()` and calls
 * `assertOwnsOrAdmin` itself.
 */

export const metadata: Metadata = { title: "Registrations" };

/** Narrows a raw search param to a real `payments.status` value. */
function parsePaymentStatus(value: string | undefined): string {
  if (!value) return "";
  return (PAYMENT_STATUS_OPTIONS as readonly string[]).includes(value) ? value : "";
}

export default async function RegistrationsPage({
  params,
  searchParams,
}: PageProps<"/organizer/dashboard/[munId]/registrations">) {
  const { munId } = await params;
  const query = await searchParams;

  const rawCommittee = typeof query.committee === "string" ? query.committee : "";
  const paymentStatus = parsePaymentStatus(
    typeof query.payment === "string" ? query.payment : undefined,
  );

  // Committees are fetched before the roster because an unknown `?committee=`
  // must not be forwarded to the action: `getDelegateList` would return an
  // empty set and the UI would show "no delegates" for what is really a bad
  // URL. Validating against this MUN's own committees also stops the param
  // being used to probe another conference's committee ids.
  const committees = await listCommittees(munId);
  const committeeId = committees.some((committee) => committee.id === rawCommittee)
    ? rawCommittee
    : "";

  const filters: DelegateFilters = {
    ...(committeeId ? { committeeId } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
  };

  const rows = await getDelegateList(munId, filters);

  const basePath = munSectionHref(munId, "registrations");
  const hasFilters = Boolean(committeeId || paymentStatus);

  return (
    <WorkspacePage
      title="Registrations"
      description="Every delegate registered for this conference. Filter by committee or payment status; expand a row for the full submission."
    >
      <RegistrationFilterBar
        basePath={basePath}
        committees={committees.map((committee) => ({
          id: committee.id,
          name: committee.name,
        }))}
        selectedCommitteeId={committeeId}
        selectedPaymentStatus={paymentStatus}
        resultCount={rows.length}
      />

      <div className="flex items-baseline justify-between gap-sm">
        <h2 className="font-display text-title-sm text-ink">
          {rows.length} {rows.length === 1 ? "registration" : "registrations"}
          {hasFilters && (
            <span className="font-normal text-muted-foreground"> matching filters</span>
          )}
        </h2>
      </div>

      {rows.length > 0 ? (
        <DelegateTable rows={rows} />
      ) : hasFilters ? (
        // A filtered-to-empty roster is a different problem from an empty
        // roster: the fix is clearing a filter, not waiting for delegates. Two
        // separate empty states rather than one generic "nothing here".
        <WorkspaceEmptyState
          icon={FilterXIcon}
          title="No matching registrations"
          description="No one on this roster matches the filters above."
          action={{ label: "Clear filters", href: basePath }}
        />
      ) : (
        <WorkspaceEmptyState
          icon={UsersIcon}
          title="No registrations yet"
          description="Delegates appear here the moment they start a registration — including ones still awaiting payment."
        />
      )}
    </WorkspacePage>
  );
}
