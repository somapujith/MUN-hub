import type { Metadata } from "next";
import { listCommittees, listPortfolios } from "@/lib/actions/mun-config";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { CommitteeBoard } from "./committee-board";
import type { CommitteeRow } from "./types";

/**
 * Committees & Portfolios (PRD § 12 + § 13).
 *
 * Portfolios live here rather than on their own route: `createPortfolio` takes
 * a `committeeId`, never a `munId`, so a standalone Portfolios page would open
 * by asking "which committee?" — which is the list you just left. See
 * `../../nav-config.ts` for the full reasoning.
 *
 * NO AUTH CHECK HERE. `[munId]/layout.tsx` has already gated this route
 * (signed-out -> /login, wrong role -> /, not-your-mun -> 404), and every
 * mutation re-checks ownership inside `lib/actions/mun-config` via
 * `assertOwnsOrAdmin`. Adding a third check would be a stale duplicate.
 *
 * DATA SHAPE — the honest version, not the PRD's aspirational one:
 * `listCommittees` returns bare `Committee` rows. There is no allocation count
 * on them and no backend entry point that returns one, so the PRD § 12 example
 * (`UNSC 30/30 FULL`) cannot be rendered truthfully yet — a fabricated
 * numerator on a capacity display is worse than no numerator, because an
 * organizer would make close-registration decisions on it. What IS real is the
 * portfolio seat count (sum of `portfolios.availability`) versus the
 * committee's `capacity`, both of which are configuration the organizer
 * themselves entered. That's what the row shows, labelled as seats configured
 * — not as delegates registered.
 *
 * The N+1 on `listPortfolios` is deliberate and bounded: a conference has tens
 * of committees, not thousands, and the frozen contract exposes no batched
 * `listPortfolios(munId)`. `Promise.all` makes it one round-trip wide rather
 * than N deep.
 */

export const metadata: Metadata = { title: "Committees & Portfolios" };

export default async function CommitteesPage({
  params,
}: PageProps<"/organizer/dashboard/[munId]/committees">) {
  const { munId } = await params;

  const committees = await listCommittees(munId);
  const withPortfolios: CommitteeRow[] = await Promise.all(
    committees.map(async (committee) => ({
      ...committee,
      portfolios: await listPortfolios(committee.id),
    })),
  );

  // `listCommittees` has no ORDER BY, so Postgres is free to return rows in
  // whatever order the heap hands back — which visibly reshuffles the list
  // after an unrelated edit. Sort here so the page is stable across renders.
  withPortfolios.sort((a, b) => a.name.localeCompare(b.name));
  for (const committee of withPortfolios) {
    committee.portfolios.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <WorkspacePage
      title="Committees & portfolios"
      description="Set up each committee, its capacity and agenda, then build out the portfolio list delegates will choose from."
    >
      <CommitteeBoard munId={munId} committees={withPortfolios} />
    </WorkspacePage>
  );
}
