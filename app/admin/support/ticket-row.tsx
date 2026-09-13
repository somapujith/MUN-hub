"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { SupportTicketRow } from "@/lib/actions/support";
import {
  assignTicketToSelfAction,
  markTicketInProgressAction,
  resolveTicketAction,
} from "./actions";

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

const CLOSED_STATUSES: SupportTicketRow["status"][] = ["RESOLVED", "CLOSED"];

function statusVariant(status: SupportTicketRow["status"]): "secondary" | "info" | "warning" | "success" {
  switch (status) {
    case "NEW":
      return "warning";
    case "ASSIGNED":
    case "IN_PROGRESS":
      return "info";
    case "WAITING":
      return "secondary";
    case "RESOLVED":
    case "CLOSED":
      return "success";
    default:
      return "secondary";
  }
}

/**
 * One support_tickets row in the admin queue. Resolution notes use
 * `useState`-controlled input (never an uncontrolled textarea) so the
 * confirm button's disabled-on-empty gate stays accurate — a Task 3 review
 * caught an uncontrolled textarea breaking exactly this kind of gate in
 * `app/admin/organizers/suspend-dialog.tsx`; this component carries forward
 * the same fix.
 */
export function TicketRow({
  ticket,
}: {
  ticket: SupportTicketRow;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [pendingAssign, startAssign] = React.useTransition();
  const [pendingProgress, startProgress] = React.useTransition();
  const [pendingResolve, startResolve] = React.useTransition();

  const pending = pendingAssign || pendingProgress || pendingResolve;
  const isClosed = CLOSED_STATUSES.includes(ticket.status);
  const isUnassigned = !ticket.assignedTo;

  function handleAssignToSelf() {
    startAssign(async () => {
      const result = await assignTicketToSelfAction(ticket.id);
      if (!result.ok) {
        toast.error("Could not assign ticket", { description: result.error });
        return;
      }
      toast.success("Ticket assigned to you");
    });
  }

  function handleMarkInProgress() {
    startProgress(async () => {
      const result = await markTicketInProgressAction(ticket.id);
      if (!result.ok) {
        toast.error("Could not update ticket", { description: result.error });
        return;
      }
      toast.success("Ticket marked in progress");
    });
  }

  function handleResolve() {
    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      // Belt-and-suspenders — the confirm button is already disabled in
      // this case, but never trust the client boundary alone.
      toast.error("Resolution notes are required to resolve a ticket.");
      return;
    }

    startResolve(async () => {
      const result = await resolveTicketAction(ticket.id, trimmedNotes);
      if (!result.ok) {
        toast.error("Could not resolve ticket", { description: result.error });
        return;
      }
      setOpen(false);
      setNotes("");
      toast.success("Ticket resolved");
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dialog can also be dismissed via backdrop/Escape, not just Cancel —
      // clear the draft either way so a stale note never reappears.
      setNotes("");
    }
  }

  return (
    <div className="flex flex-col gap-sm p-md text-body-md">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-xs">
            <p className="font-display text-title-sm font-medium text-ink">{ticket.subject}</p>
            <Badge variant="outline">{ticket.category}</Badge>
            <Badge variant={ticket.priority === "URGENT" || ticket.priority === "HIGH" ? "destructive" : "secondary"}>
              {ticket.priority}
            </Badge>
            <Badge variant={statusVariant(ticket.status)}>{ticket.status}</Badge>
          </div>
          <p className="text-muted-foreground">{ticket.description}</p>
          {ticket.resolutionNotes && (
            <p className="text-body-sm text-muted-foreground">
              <span className="font-medium text-ink">Resolution: </span>
              {ticket.resolutionNotes}
            </p>
          )}
        </div>

        {!isClosed && (
          <div className="flex shrink-0 items-center gap-xs">
            {isUnassigned && (
              <Button size="sm" variant="outline" disabled={pending} onClick={handleAssignToSelf}>
                {pendingAssign ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <UserPlusIcon aria-hidden />
                )}
                Assign to me
              </Button>
            )}
            {/*
              A NEW ticket's only legal next state is ASSIGNED
              (ALLOWED_TICKET_TRANSITIONS in lib/actions/support.ts) — "In
              progress" and "Resolve" only apply once a ticket has been
              assigned, otherwise updateTicketStatus throws "Invalid ticket
              transition". Gate both behind `!isUnassigned` so the UI never
              offers an action the backend state machine will reject.
            */}
            {!isUnassigned && ticket.status !== "IN_PROGRESS" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={handleMarkInProgress}>
                {pendingProgress ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                In progress
              </Button>
            )}
            {!isUnassigned && (
              <Button size="sm" disabled={pending} onClick={() => setOpen(true)}>
                <CheckIcon aria-hidden />
                Resolve
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve this ticket?</DialogTitle>
            <DialogDescription>
              Resolution notes are recorded on the ticket and in the admin action log.
            </DialogDescription>
          </DialogHeader>

          <form action={handleResolve} className="flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <Label htmlFor={`resolution-notes-${ticket.id}`}>Resolution notes</Label>
              <textarea
                id={`resolution-notes-${ticket.id}`}
                name="resolutionNotes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={pendingResolve}
                className={fieldClassName}
                placeholder="What was done to resolve this? Required."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingResolve}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pendingResolve || !notes.trim()}>
                {pendingResolve ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <CheckIcon aria-hidden />
                )}
                {pendingResolve ? "Saving…" : "Confirm resolve"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
