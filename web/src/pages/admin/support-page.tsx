import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  LifeBuoyIcon,
  Loader2Icon,
  MessageCircleIcon,
  SendIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  assignSupportTicketToSelf,
  getConversation,
  listAdminSupportTickets,
  markConversationRead,
  sendConversationMessage,
  updateSupportTicketStatus,
} from "@/api/support";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminTicketListItem, SupportStatus } from "@/types/support";

const STATUS_FILTERS: Array<{ value: SupportStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WAITING", label: "Waiting" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const CLOSED_STATUSES: SupportStatus[] = ["RESOLVED", "CLOSED"];

function statusVariant(status: SupportStatus): "secondary" | "info" | "warning" | "success" {
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

const selectClassName =
  "h-10 rounded-sm border border-input bg-background px-md text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

const textareaClassName =
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground";

export function AdminSupportPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<SupportStatus | "">("");
  const [resolveTarget, setResolveTarget] = useState<AdminTicketListItem | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [expandedTicketIds, setExpandedTicketIds] = useState<Record<string, boolean>>({});

  const toggleConversation = (ticketId: string) =>
    setExpandedTicketIds((prev) => ({ ...prev, [ticketId]: !prev[ticketId] }));

  const params = statusFilter ? { status: statusFilter } : {};
  const ticketsQuery = useQuery({
    queryKey: queryKeys.adminSupportTickets(params),
    queryFn: () => listAdminSupportTickets(params),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "support-tickets"] });

  const assignMutation = useMutation({
    mutationFn: assignSupportTicketToSelf,
    onSuccess: async () => {
      await refresh();
      toast.success("Ticket assigned to you");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to assign ticket"),
  });

  const inProgressMutation = useMutation({
    mutationFn: (ticketId: string) => updateSupportTicketStatus(ticketId, "IN_PROGRESS"),
    onSuccess: async () => {
      await refresh();
      toast.success("Ticket marked in progress");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to update ticket"),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ ticketId, notes }: { ticketId: string; notes: string }) =>
      updateSupportTicketStatus(ticketId, "RESOLVED", notes),
    onSuccess: async () => {
      await refresh();
      setResolveTarget(null);
      setResolutionNotes("");
      toast.success("Ticket resolved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to resolve ticket"),
  });

  const tickets = ticketsQuery.data ?? [];
  const openCount = tickets.filter((t) => !CLOSED_STATUSES.includes(t.status)).length;

  const handleResolveSubmit = () => {
    const trimmed = resolutionNotes.trim();
    if (!resolveTarget || !trimmed) return;
    resolveMutation.mutate({ ticketId: resolveTarget.id, notes: trimmed });
  };

  return (
    <AdminPageFrame
      title="Support"
      description="Newest first. Assign a ticket to yourself, move it to in progress, or resolve it with notes for the requester."
    >
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <Label htmlFor="support-status-filter">Status</Label>
          <select
            id="support-status-filter"
            className={selectClassName}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as SupportStatus | "")}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {tickets.length > 0 && (
          <dl className="flex items-center gap-lg">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                Showing
              </dt>
              <dd className="font-display text-title-lg tabular-nums text-ink">{tickets.length}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">Open</dt>
              <dd className="font-display text-title-lg tabular-nums text-ink">{openCount}</dd>
            </div>
          </dl>
        )}
      </div>

      {ticketsQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : ticketsQuery.isError ? (
        <p className="text-body-md text-destructive">
          {ticketsQuery.error instanceof Error ? ticketsQuery.error.message : "Unable to load tickets right now."}
        </p>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">No support tickets.</p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            {statusFilter ? "Nothing matches this filter." : "Nothing has been filed yet."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          {tickets.map((ticket) => {
            const isClosed = CLOSED_STATUSES.includes(ticket.status);
            const isUnassigned = !ticket.assignedTo;
            const isAssigning = assignMutation.isPending && assignMutation.variables === ticket.id;
            const isProgressing = inProgressMutation.isPending && inProgressMutation.variables === ticket.id;

            return (
              <div key={ticket.id} className="flex flex-col gap-sm p-md text-body-md">
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isAssigning}
                          onClick={() => assignMutation.mutate(ticket.id)}
                        >
                          {isAssigning ? (
                            <Loader2Icon className="animate-spin" aria-hidden />
                          ) : (
                            <UserPlusIcon aria-hidden />
                          )}
                          Assign to me
                        </Button>
                      )}
                      {/*
                        Gated by ALLOWED_TICKET_TRANSITIONS, not just "is it
                        assigned": ASSIGNED can only move to IN_PROGRESS or
                        WAITING, never straight to RESOLVED — so "Resolve"
                        must also check the current status.
                      */}
                      {!isUnassigned && ticket.status !== "IN_PROGRESS" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isProgressing}
                          onClick={() => inProgressMutation.mutate(ticket.id)}
                        >
                          {isProgressing ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                          In progress
                        </Button>
                      )}
                      {(ticket.status === "IN_PROGRESS" || ticket.status === "WAITING") && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setResolveTarget(ticket);
                            setResolutionNotes("");
                          }}
                        >
                          <CheckIcon aria-hidden />
                          Resolve
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleConversation(ticket.id)}
                  >
                    <MessageCircleIcon aria-hidden />
                    {expandedTicketIds[ticket.id] ? "Hide conversation" : "View conversation"}
                  </Button>
                  <ConversationThread ticket={ticket} isExpanded={!!expandedTicketIds[ticket.id]} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={resolveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResolveTarget(null);
            setResolutionNotes("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve this ticket?</DialogTitle>
            <DialogDescription>
              Resolution notes are recorded on the ticket and in the admin action log.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleResolveSubmit();
            }}
            className="flex flex-col gap-md"
          >
            <div className="flex flex-col gap-xs">
              <Label htmlFor="resolution-notes">Resolution notes</Label>
              <textarea
                id="resolution-notes"
                rows={3}
                value={resolutionNotes}
                onChange={(event) => setResolutionNotes(event.target.value)}
                disabled={resolveMutation.isPending}
                className={textareaClassName}
                placeholder="What was done to resolve this? Required."
                autoFocus
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resolveMutation.isPending}
                onClick={() => setResolveTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={resolveMutation.isPending || !resolutionNotes.trim()}>
                {resolveMutation.isPending ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <CheckIcon aria-hidden />
                )}
                {resolveMutation.isPending ? "Saving…" : "Confirm resolve"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminPageFrame>
  );
}

/**
 * Self-contained inline reply thread for one ticket row. Deliberately not
 * shared with components/support/** (the student/organizer floating widget,
 * owned by a different concurrent agent) — same conceptual chat UI, separate
 * implementation on purpose.
 */
function ConversationThread({
  ticket,
  isExpanded,
}: {
  ticket: AdminTicketListItem;
  isExpanded: boolean;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const hasMarkedRead = useRef(false);

  const conversationQuery = useQuery({
    queryKey: queryKeys.conversation(ticket.id),
    queryFn: () => getConversation(ticket.id),
    refetchInterval: 5_000,
    enabled: isExpanded,
  });

  useEffect(() => {
    if (isExpanded && conversationQuery.isSuccess && !hasMarkedRead.current) {
      hasMarkedRead.current = true;
      markConversationRead(ticket.id).catch(() => {
        // Best-effort — the unread indicator just won't clear until the next successful call.
      });
    }
  }, [isExpanded, conversationQuery.isSuccess, ticket.id]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendConversationMessage(ticket.id, body),
    onSuccess: async () => {
      setMessage("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversation(ticket.id) });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to send message"),
  });

  if (!isExpanded) return null;

  const isClosed = ticket.status === "CLOSED";
  const messages = conversationQuery.data?.messages ?? [];

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    sendMutation.mutate(trimmed);
  };

  return (
    <div className="mt-sm flex flex-col gap-sm rounded-md border border-border bg-surface-soft/50 p-sm">
      {conversationQuery.isLoading ? (
        <div className="flex flex-col gap-xs">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      ) : conversationQuery.isError ? (
        <p className="text-body-sm text-destructive">
          {conversationQuery.error instanceof Error
            ? conversationQuery.error.message
            : "Unable to load this conversation right now."}
        </p>
      ) : messages.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <div className="flex flex-col gap-xs">
          {messages.map((msg) => {
            const isRequester = msg.senderId === ticket.createdBy;
            return (
              <div key={msg.id} className={cn("flex flex-col", isRequester ? "items-start" : "items-end")}>
                <span className="mb-0.5 px-1 text-body-sm text-muted-foreground">
                  {isRequester ? ticket.requesterName : "Staff"}
                </span>
                <div
                  className={cn(
                    "max-w-[80%] rounded-md px-sm py-xs text-body-md break-words",
                    isRequester ? "bg-surface-strong text-ink" : "bg-primary/10 text-ink"
                  )}
                >
                  {msg.body}
                </div>
                <span className="mt-0.5 px-1 text-body-sm text-muted-foreground">
                  {new Date(msg.createdAt).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {isClosed ? (
        <p className="text-body-sm text-muted-foreground">This conversation is closed.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSend();
          }}
          className="flex items-end gap-xs"
        >
          <textarea
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={sendMutation.isPending}
            className={cn(textareaClassName, "flex-1")}
            placeholder="Reply to this conversation…"
          />
          <Button type="submit" size="sm" disabled={sendMutation.isPending || !message.trim()}>
            {sendMutation.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <SendIcon aria-hidden />
            )}
            {sendMutation.isPending ? "Sending…" : "Send"}
          </Button>
        </form>
      )}
    </div>
  );
}
