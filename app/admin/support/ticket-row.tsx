"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import {
  CheckIcon,
  Loader2Icon,
  MessageCircleIcon,
  SendIcon,
  UserPlusIcon,
} from "lucide-react";
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
import type { AdminTicketListItem, SupportMessageRow } from "@/lib/actions/support";
import {
  assignTicketToSelfAction,
  markTicketInProgressAction,
  resolveTicketAction,
} from "./actions";
import {
  getConversationAction,
  markConversationReadAction,
  sendMessageAction,
} from "@/app/support/chat-actions";

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

const CLOSED_STATUSES: AdminTicketListItem["status"][] = ["RESOLVED", "CLOSED"];

function statusVariant(status: AdminTicketListItem["status"]): "secondary" | "info" | "warning" | "success" {
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
 *
 * `ticket` is the requester-joined `AdminTicketListItem` (adds
 * `requesterName`/`requesterRole`) so the row can show who filed it and give
 * access to the self-contained chat thread below (`<ConversationThread>`).
 */
export function TicketRow({
  ticket,
}: {
  ticket: AdminTicketListItem;
}) {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [chatOpen, setChatOpen] = React.useState(false);
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
          <p className="text-body-sm text-muted-foreground">
            Filed by <span className="font-medium text-ink">{ticket.requesterName}</span>{" "}
            <Badge variant={ticket.requesterRole === "STUDENT" ? "secondary" : "outline"}>
              {ticket.requesterRole}
            </Badge>
          </p>
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
              Buttons are gated by ALLOWED_TICKET_TRANSITIONS in
              lib/actions/support.ts, not just "is it assigned": ASSIGNED can
              only move to IN_PROGRESS or WAITING, never straight to
              RESOLVED, so "Resolve" must also check the current status —
              gating it on `!isUnassigned` alone left it clickable (and
              throwing "Invalid ticket transition") on a freshly-assigned
              ticket that hasn't moved to IN_PROGRESS/WAITING yet.
            */}
            {!isUnassigned && ticket.status !== "IN_PROGRESS" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={handleMarkInProgress}>
                {pendingProgress ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                In progress
              </Button>
            )}
            {(ticket.status === "IN_PROGRESS" || ticket.status === "WAITING") && (
              <Button size="sm" disabled={pending} onClick={() => setOpen(true)}>
                <CheckIcon aria-hidden />
                Resolve
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setChatOpen((prev) => !prev)}
        >
          <MessageCircleIcon aria-hidden />
          {chatOpen ? "Hide conversation" : "View conversation"}
        </Button>

        {chatOpen && <ConversationThread ticket={ticket} />}
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

const POLL_INTERVAL_MS = 5000;

/**
 * Self-contained chat thread for one ticket, rendered inline when the row's
 * "View conversation" toggle is open. Deliberately does not import from
 * `components/support/**` (a separate widget for the student/organizer side
 * is being built concurrently by another agent) — some duplication between
 * the two chat UIs is expected here.
 *
 * Requester messages (`senderId === ticket.createdBy`) render left/muted;
 * any other sender is staff and renders right/primary-tinted — read
 * receipts are shared across all admins by design, so there's no
 * per-reviewer distinction among staff senders.
 */
function ConversationThread({ ticket }: { ticket: AdminTicketListItem }) {
  const [messages, setMessages] = React.useState<SupportMessageRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [pendingSend, startSend] = React.useTransition();
  const markedReadRef = React.useRef(false);
  const isClosed = ticket.status === "CLOSED";

  const refresh = React.useCallback(async () => {
    const result = await getConversationAction(ticket.id);
    if (result.ok) {
      setMessages(result.data.messages);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [ticket.id]);

  React.useEffect(() => {
    let cancelled = false;

    refresh();

    // Clear the admin-side unread indicator once, the first time this
    // thread is opened for this ticket — not on every poll tick.
    if (!markedReadRef.current) {
      markedReadRef.current = true;
      markConversationReadAction(ticket.id);
    }

    const interval = setInterval(() => {
      if (!cancelled) refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticket.id, refresh]);

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed) return;

    startSend(async () => {
      const result = await sendMessageAction(ticket.id, trimmed);
      if (!result.ok) {
        toast.error("Could not send message", { description: result.error });
        return;
      }
      setDraft("");
      await refresh();
    });
  }

  return (
    <div className="flex flex-col gap-sm rounded-md border border-border bg-surface-soft/40 p-sm">
      {messages === null ? (
        loadError ? (
          <p className="text-body-sm text-destructive">{loadError}</p>
        ) : (
          <p className="flex items-center gap-xs text-body-sm text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            Loading conversation…
          </p>
        )
      ) : messages.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <div className="flex max-h-72 flex-col gap-xs overflow-y-auto">
          {messages.map((message) => {
            const fromRequester = message.senderId === ticket.createdBy;
            return (
              <div
                key={message.id}
                className={cn("flex flex-col gap-0.5", fromRequester ? "items-start" : "items-end")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-md px-sm py-xs text-body-sm",
                    fromRequester ? "bg-surface-soft text-ink" : "bg-primary text-primary-foreground"
                  )}
                >
                  {message.body}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {fromRequester ? ticket.requesterName : "Staff"} ·{" "}
                  {new Date(message.createdAt).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {isClosed ? (
        <p className="text-body-sm text-muted-foreground">This conversation is closed.</p>
      ) : (
        <div className="flex items-end gap-xs">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pendingSend}
            className={fieldClassName}
            placeholder="Reply to the requester…"
          />
          <Button size="sm" disabled={pendingSend || !draft.trim()} onClick={handleSend}>
            {pendingSend ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <SendIcon aria-hidden />
            )}
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
