import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { OrganizerMunCard } from "@/components/organizer/organizer-mun-card";
import { Button } from "@/components/ui/button";
import { requireOrganizerActor } from "../../auth";
import { getOrganizerWorkspaceData } from "../workspace-data";

/**
 * My MUNs (PRD § 7) — every conference the organizer runs, and the entry point
 * into each one's 15-section workspace.
 *
 * The card itself is `components/organizer/organizer-mun-card.tsx`; see the
 * note there for which PRD § 7 fields and actions are deliberately absent
 * (GMV, Duplicate, Archive) and why.
 *
 * No auth check here on purpose: `dashboard/layout.tsx` already gated the
 * route and `requireOrganizerActor()` is the cached read of that same session,
 * used only to get the id every query is scoped by.
 */

export const metadata: Metadata = { title: "My MUNs" };

export default async function MyMunsPage() {
  const actor = await requireOrganizerActor();
  const { muns } = await getOrganizerWorkspaceData(actor.userId);

  // One clock for the whole list, so two cards rendered in the same paint can
  // never disagree about how many days are left.
  const now = new Date();

  return (
    <WorkspacePage
      title="My MUNs"
      description="Every conference you organise. Open one to manage its committees, registrations and payments."
      actions={
        <Button size="sm" render={<Link href="/organizer/apply" />}>
          <PlusIcon aria-hidden strokeWidth={1.75} />
          Apply to host a MUN
        </Button>
      }
    >
      {muns.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <p className="text-body-md text-muted-foreground">
            <span className="tabular-nums">{muns.length}</span>{" "}
            {muns.length === 1 ? "conference" : "conferences"}
          </p>
          <ul className="grid list-none gap-sm md:grid-cols-2 xl:grid-cols-3">
            {muns.map((mun) => (
              <li key={mun.id} className="flex">
                <OrganizerMunCard mun={mun} now={now} />
              </li>
            ))}
          </ul>
        </>
      )}
    </WorkspacePage>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-md rounded-md border border-dashed border-border bg-surface-soft p-xl dark:bg-card">
      <div className="flex max-w-prose flex-col gap-xs">
        <h2 className="font-display text-title-sm text-ink">
          No conferences yet
        </h2>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          Apply to host a MUN. Once it&rsquo;s approved you&rsquo;ll manage
          committees, registrations and payments from here.
        </p>
      </div>
      <Button size="sm" render={<Link href="/organizer/apply" />}>
        Apply to host a MUN
        <ArrowRightIcon aria-hidden strokeWidth={1.75} />
      </Button>
    </div>
  );
}
