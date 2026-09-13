"use client";

import * as React from "react";
import { cn } from "cn";
import {
  ChevronRightIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Portfolio } from "@/lib/types";
import { deleteCommitteeAction, deletePortfolioAction } from "./actions";
import { CommitteeDialog } from "./committee-dialog";
import { DeleteDialog } from "./delete-dialog";
import { PortfolioDialog } from "./portfolio-dialog";
import { seatsConfigured, type CommitteeRow } from "./types";

/**
 * The committees list, with portfolios as an expandable child list per row.
 *
 * DISCLOSURE, NOT ACCORDION. `components/ui/accordion.tsx` does not exist in
 * this tree, and the pattern here isn't an accordion anyway: multiple
 * committees must be open at once (an organizer cross-checks portfolio counts
 * between two committees), and each header carries its own edit/delete/add
 * buttons — nesting interactive controls inside an accordion trigger is an
 * a11y violation (a button inside a button). So the trigger is a dedicated
 * chevron button with `aria-expanded` + `aria-controls`, and the row actions
 * are siblings of it, not children.
 *
 * STATE. Open/closed lives here and is intentionally NOT persisted: after a
 * `revalidatePath` the server re-renders this subtree with fresh props while
 * this component's state survives (same position in the tree, same key), so a
 * committee stays open across a mutation. A newly-created committee gets
 * auto-expanded via `pendingExpandRef` so the organizer lands on its empty
 * portfolio list rather than a collapsed row they have to find.
 *
 * NO OPTIMISTIC UI. Every mutation goes through a server action that calls
 * `revalidatePath`, and the rendered list is always the server's `committees`
 * prop. There is no client-side copy of the list to drift out of sync — if a
 * delete fails, the row is still there because the server still has it.
 */

interface CommitteeBoardProps {
  munId: string;
  committees: CommitteeRow[];
}

type CommitteeDialogState =
  | { mode: "create" }
  | { mode: "edit"; committee: CommitteeRow };

type PortfolioDialogState = {
  committee: CommitteeRow;
  portfolio?: Portfolio;
};

type DeleteState =
  | { kind: "committee"; committee: CommitteeRow }
  | { kind: "portfolio"; committee: CommitteeRow; portfolio: Portfolio };

export function CommitteeBoard({ munId, committees }: CommitteeBoardProps) {
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [committeeDialog, setCommitteeDialog] =
    React.useState<CommitteeDialogState | null>(null);
  const [portfolioDialog, setPortfolioDialog] =
    React.useState<PortfolioDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteState | null>(
    null,
  );

  // Ids of committees that existed on the previous render. A committee that
  // appears in `committees` but not here was just created (by this user, in
  // this session) and should open itself.
  const knownIdsRef = React.useRef<ReadonlySet<string> | null>(null);

  React.useEffect(() => {
    const currentIds = new Set(committees.map((committee) => committee.id));
    const known = knownIdsRef.current;
    knownIdsRef.current = currentIds;

    // First render: nothing is "new", everything starts collapsed.
    if (known === null) return;

    const added = [...currentIds].filter((id) => !known.has(id));
    if (added.length === 0) return;

    setExpanded((previous) => {
      const next = new Set(previous);
      for (const id of added) next.add(id);
      return next;
    });
  }, [committees]);

  function toggle(committeeId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(committeeId)) next.delete(committeeId);
      else next.add(committeeId);
      return next;
    });
  }

  const totalPortfolios = committees.reduce(
    (total, committee) => total + committee.portfolios.length,
    0,
  );

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-md text-body dark:text-muted-foreground">
          {committees.length === 0 ? (
            "No committees yet."
          ) : (
            <>
              <span className="font-medium tabular-nums text-ink">
                {committees.length}
              </span>{" "}
              {committees.length === 1 ? "committee" : "committees"} ·{" "}
              <span className="font-medium tabular-nums text-ink">
                {totalPortfolios}
              </span>{" "}
              {totalPortfolios === 1 ? "portfolio" : "portfolios"}
            </>
          )}
        </p>

        <Button size="sm" onClick={() => setCommitteeDialog({ mode: "create" })}>
          <PlusIcon aria-hidden />
          Add committee
        </Button>
      </div>

      {committees.length === 0 ? (
        <EmptyBoard onCreate={() => setCommitteeDialog({ mode: "create" })} />
      ) : (
        <ul className="flex flex-col gap-sm">
          {committees.map((committee) => (
            <CommitteeCard
              key={committee.id}
              committee={committee}
              expanded={expanded.has(committee.id)}
              onToggle={() => toggle(committee.id)}
              onEdit={() => setCommitteeDialog({ mode: "edit", committee })}
              onDelete={() => setDeleteTarget({ kind: "committee", committee })}
              onAddPortfolio={() => setPortfolioDialog({ committee })}
              onEditPortfolio={(portfolio) =>
                setPortfolioDialog({ committee, portfolio })
              }
              onDeletePortfolio={(portfolio) =>
                setDeleteTarget({ kind: "portfolio", committee, portfolio })
              }
            />
          ))}
        </ul>
      )}

      {/*
        Keyed by the row being edited so each open gets a fresh mount — an
        uncontrolled `defaultValue` ignores post-mount changes, so a shared
        instance would show the previously-edited committee's values.
      */}
      {committeeDialog && (
        <CommitteeDialog
          key={
            committeeDialog.mode === "edit"
              ? committeeDialog.committee.id
              : "new-committee"
          }
          munId={munId}
          committee={
            committeeDialog.mode === "edit"
              ? committeeDialog.committee
              : undefined
          }
          open
          onOpenChange={(open) => {
            if (!open) setCommitteeDialog(null);
          }}
        />
      )}

      {portfolioDialog && (
        <PortfolioDialog
          key={
            portfolioDialog.portfolio?.id ??
            `new-portfolio-${portfolioDialog.committee.id}`
          }
          munId={munId}
          committeeId={portfolioDialog.committee.id}
          committeeName={portfolioDialog.committee.name}
          portfolio={portfolioDialog.portfolio}
          open
          onOpenChange={(open) => {
            if (!open) setPortfolioDialog(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          key={
            deleteTarget.kind === "committee"
              ? `delete-committee-${deleteTarget.committee.id}`
              : `delete-portfolio-${deleteTarget.portfolio.id}`
          }
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          {...deleteCopy(deleteTarget)}
          onConfirm={() =>
            deleteTarget.kind === "committee"
              ? deleteCommitteeAction(munId, deleteTarget.committee.id)
              : deletePortfolioAction(munId, deleteTarget.portfolio.id)
          }
        />
      )}
    </div>
  );
}

function deleteCopy(target: DeleteState): {
  title: string;
  subject: string;
  consequence: string;
  confirmLabel: string;
} {
  if (target.kind === "portfolio") {
    return {
      title: "Delete portfolio",
      subject: target.portfolio.name,
      consequence: `Removed from ${target.committee.name}. Delegates can no longer select it.`,
      confirmLabel: "Delete portfolio",
    };
  }

  const count = target.committee.portfolios.length;
  return {
    title: "Delete committee",
    subject: target.committee.name,
    consequence:
      count > 0
        ? `This also deletes its ${count} ${count === 1 ? "portfolio" : "portfolios"}. This cannot be undone.`
        : "This cannot be undone.",
    confirmLabel: "Delete committee",
  };
}

// ---------------------------------------------------------------------------

interface CommitteeCardProps {
  committee: CommitteeRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddPortfolio: () => void;
  onEditPortfolio: (portfolio: Portfolio) => void;
  onDeletePortfolio: (portfolio: Portfolio) => void;
}

function CommitteeCard({
  committee,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddPortfolio,
  onEditPortfolio,
  onDeletePortfolio,
}: CommitteeCardProps) {
  const panelId = `committee-panel-${committee.id}`;
  const headingId = `committee-heading-${committee.id}`;
  const seats = seatsConfigured(committee.portfolios);

  return (
    <li
      className={cn(
        "rounded-md border border-border bg-background transition-[border-color,box-shadow] duration-150",
        expanded && "border-border-strong",
        "dark:bg-card",
      )}
    >
      <div className="flex flex-wrap items-start gap-sm p-md sm:flex-nowrap sm:items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="mt-0.5 shrink-0 sm:mt-0"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "transition-transform duration-150 ease-out motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          <span className="sr-only">
            {expanded ? "Collapse" : "Expand"} {committee.name}
          </span>
        </Button>

        <div className="flex min-w-0 flex-1 flex-col gap-xxs">
          <div className="flex flex-wrap items-center gap-xs">
            <h2
              id={headingId}
              className="min-w-0 font-display text-title-sm text-ink"
            >
              {committee.name}
            </h2>
            {/*
              PRD § 12 shows `UNSC 30/30 FULL`. The numerator in that example is
              registered delegates — `listCommittees` returns no such count and
              no action exposes one, so this shows the committee's configured
              capacity plainly instead of inventing a fill number an organizer
              would make close-registration decisions on.
            */}
            <Badge variant="secondary" className="tabular-nums">
              {committee.capacity} {committee.capacity === 1 ? "seat" : "seats"}
            </Badge>
            <SeatBalance capacity={committee.capacity} seats={seats} />
          </div>

          {committee.agenda && (
            <p className="line-clamp-1 text-body-md text-body dark:text-muted-foreground">
              {committee.agenda}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-xxs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={`Edit ${committee.name}`}
          >
            <PencilIcon aria-hidden />
            <span className="sr-only sm:not-sr-only">Edit</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            className="text-destructive-text! hover:bg-destructive/10"
            aria-label={`Delete ${committee.name}`}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      </div>

      {/*
        Kept mounted but `hidden` so the panel's DOM (and any focus inside it)
        is stable across expand/collapse, and `aria-controls` always resolves.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!expanded}
        className="border-t border-border px-md py-md"
      >
        <PortfolioList
          committee={committee}
          onAdd={onAddPortfolio}
          onEdit={onEditPortfolio}
          onDelete={onDeletePortfolio}
        />
      </div>
    </li>
  );
}

/**
 * Configured portfolio seats vs. committee capacity. Both numbers are things
 * the organizer typed — this is a consistency check on their own configuration,
 * not an occupancy readout. Silent when they agree; flagged when they don't,
 * because an under-seated committee cannot fill and an over-seated one will
 * hit the transactional capacity guard at registration time.
 */
function SeatBalance({
  capacity,
  seats,
}: {
  capacity: number;
  seats: number;
}) {
  if (capacity === 0 || seats === capacity) return null;

  const over = seats > capacity;
  return (
    <Badge
      variant={over ? "warning" : "outline"}
      className="tabular-nums"
      title={
        over
          ? "Portfolio seats exceed committee capacity — registration will cap at capacity."
          : "Portfolio seats don't fill the committee capacity yet."
      }
    >
      {seats}/{capacity} portfolio seats
    </Badge>
  );
}

// ---------------------------------------------------------------------------

interface PortfolioListProps {
  committee: CommitteeRow;
  onAdd: () => void;
  onEdit: (portfolio: Portfolio) => void;
  onDelete: (portfolio: Portfolio) => void;
}

function PortfolioList({
  committee,
  onAdd,
  onEdit,
  onDelete,
}: PortfolioListProps) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center justify-between gap-xs">
        <h3 className="text-caption text-muted-foreground">
          Portfolios
          {committee.portfolios.length > 0 && (
            <span className="tabular-nums"> ({committee.portfolios.length})</span>
          )}
        </h3>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden />
          Add portfolio
        </Button>
      </div>

      {committee.portfolios.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border bg-surface-soft px-md py-md text-body-md text-body dark:bg-muted/30 dark:text-muted-foreground">
          No portfolios yet. Delegates can&rsquo;t pick a delegation in{" "}
          {committee.name} until at least one exists.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-sm border border-border">
          {committee.portfolios.map((portfolio) => (
            <li
              key={portfolio.id}
              className="flex flex-wrap items-center gap-sm bg-surface-soft px-md py-sm transition-colors duration-150 hover:bg-surface-strong/60 dark:bg-card dark:hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-label-md text-ink">
                {portfolio.name}
              </span>

              {portfolio.type && (
                <Badge variant="outline" className="shrink-0">
                  {portfolio.type}
                </Badge>
              )}

              <span
                className={cn(
                  "shrink-0 text-body-md tabular-nums",
                  portfolio.availability === 0
                    ? "text-destructive-text"
                    : "text-muted-foreground",
                )}
              >
                {portfolio.availability === 0
                  ? "Closed"
                  : `${portfolio.availability} ${portfolio.availability === 1 ? "seat" : "seats"}`}
              </span>

              <div className="flex shrink-0 items-center gap-xxs">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onEdit(portfolio)}
                  aria-label={`Edit ${portfolio.name}`}
                >
                  <PencilIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(portfolio)}
                  className="text-destructive-text! hover:bg-destructive/10"
                  aria-label={`Delete ${portfolio.name}`}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyBoard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl text-center dark:bg-card">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-surface-strong text-muted-foreground dark:bg-muted"
      >
        <LayersIcon strokeWidth={1.5} className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-xs">
        <p className="font-display text-title-sm text-ink">
          No committees yet
        </p>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          A conference needs at least one committee before delegates can
          register. Start with its name and capacity — the agenda and portfolio
          list can follow.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <UsersRoundIcon aria-hidden />
        Create first committee
      </Button>
    </div>
  );
}
