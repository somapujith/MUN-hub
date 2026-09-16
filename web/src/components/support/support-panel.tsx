import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { toast } from "sonner";
import { ArrowLeftIcon, Loader2Icon, LifeBuoyIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryKeys } from "@/api/query-keys";
import {
  getConversation,
  listMyConversations,
  markConversationRead,
  sendConversationMessage,
  startConversation,
} from "@/api/support";
import type { SupportTicket } from "@/types/support";

/**
 * Core reusable chat UI for the "Support Desk" feature. Two mount points:
 * the floating `SupportWidget` (`variant="popover"`, inside a `Sheet`) and
 * the full-page `/dashboard/support` + `/organizer/support` routes
 * (`variant="page"`, built by other agents against this exact prop
 * contract).
 *
 * No `role` prop — every ticket `listMyConversations()` returns is one the
 * caller created, so `message.senderId === ticket.createdBy` is a complete
 * "is this my bubble" test without knowing the caller's own role or id.
 */
export interface SupportPanelProps {
  variant?: "popover" | "page";
}

const LIST_POLL_MS = 20_000;
const THREAD_POLL_MS = 4_000;

function statusVariant(status: SupportTicket["status"]): "secondary" | "info" | "success" {
  switch (status) {
    case "NEW":
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

/** Unread iff the last message wasn't mine and either I've never read this
 * ticket or it arrived after my last read. */
function isTicketUnread(ticket: SupportTicket): boolean {
  if (!ticket.lastMessageSenderId || ticket.lastMessageSenderId === ticket.createdBy) {
    return false;
  }
  if (!ticket.requesterReadAt) return true;
  if (!ticket.lastMessageAt) return false;
  return new Date(ticket.lastMessageAt).getTime() > new Date(ticket.requesterReadAt).getTime();
}

function formatRelativeTime(date: Date | string): string {
  const target = typeof date === "string" ? new Date(date) : date;
  const diffSec = Math.round((Date.now() - target.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return target.toLocaleDateString();
}

const fieldClassName = cn(
  "w-full min-w-0 resize-none rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

export function SupportPanel({ variant = "popover" }: SupportPanelProps) {
  const queryClient = useQueryClient();
  const [view, setView] = React.useState<"list" | "thread">("list");
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null);
  const [composerBody, setComposerBody] = React.useState("");
  const [replyBody, setReplyBody] = React.useState("");

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastSeenActivityRef = React.useRef<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: queryKeys.myConversations(),
    queryFn: listMyConversations,
    refetchInterval: LIST_POLL_MS,
    enabled: view === "list",
  });

  const conversationQuery = useQuery({
    queryKey: selectedTicketId ? queryKeys.conversation(selectedTicketId) : ["support", "conversations", "none"],
    queryFn: () => getConversation(selectedTicketId as string),
    refetchInterval: THREAD_POLL_MS,
    enabled: view === "thread" && Boolean(selectedTicketId),
  });

  const readMutation = useMutation({
    mutationFn: (ticketId: string) => markConversationRead(ticketId),
  });

  // Mark-read once when the thread opens, and again whenever the poll
  // surfaces a newer `lastMessageAt` than what we last saw — this is what
  // clears the unread dot.
  React.useEffect(() => {
    if (view !== "thread" || !selectedTicketId) return;
    const ticket = conversationQuery.data?.ticket;
    if (!ticket) return;
    const latest = ticket.lastMessageAt ? new Date(ticket.lastMessageAt).toISOString() : "read";
    if (latest !== lastSeenActivityRef.current) {
      lastSeenActivityRef.current = latest;
      readMutation.mutate(selectedTicketId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedTicketId, conversationQuery.data?.ticket.lastMessageAt]);

  React.useEffect(() => {
    if (ticketsQuery.isError) {
      toast.error(
        ticketsQuery.error instanceof Error ? ticketsQuery.error.message : "Could not load conversations"
      );
    }
  }, [ticketsQuery.isError, ticketsQuery.error]);

  React.useEffect(() => {
    if (conversationQuery.isError) {
      toast.error(
        conversationQuery.error instanceof Error ? conversationQuery.error.message : "Could not load conversation"
      );
    }
  }, [conversationQuery.isError, conversationQuery.error]);

  // Auto-scroll to bottom on new messages.
  React.useEffect(() => {
    if (view !== "thread") return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversationQuery.data?.messages, view]);

  const startMutation = useMutation({
    mutationFn: (body: string) => startConversation({ body }),
    onSuccess: (result) => {
      setComposerBody("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.myConversations() });
      queryClient.setQueryData(queryKeys.conversation(result.ticket.id), {
        ticket: result.ticket,
        messages: [result.message],
      });
      lastSeenActivityRef.current = result.ticket.lastMessageAt
        ? new Date(result.ticket.lastMessageAt).toISOString()
        : "read";
      setSelectedTicketId(result.ticket.id);
      setView("thread");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send message"),
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendConversationMessage(selectedTicketId as string, body),
    onSuccess: () => {
      setReplyBody("");
      if (selectedTicketId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(selectedTicketId) });
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send message"),
  });

  function handleBack() {
    setView("list");
    setSelectedTicketId(null);
    setReplyBody("");
    lastSeenActivityRef.current = null;
  }

  function openThread(ticketId: string) {
    setSelectedTicketId(ticketId);
    setReplyBody("");
    lastSeenActivityRef.current = null;
    setView("thread");
  }

  function handleStartConversation() {
    const body = composerBody.trim();
    if (!body || startMutation.isPending) return;
    startMutation.mutate(body);
  }

  function handleSendReply() {
    if (!selectedTicketId) return;
    const body = replyBody.trim();
    if (!body || sendMutation.isPending) return;
    sendMutation.mutate(body);
  }

  function handleReplyKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendReply();
    }
  }

  const tickets = ticketsQuery.data ?? [];
  const ticketsLoaded = ticketsQuery.isSuccess;
  const selectedTicket = conversationQuery.data?.ticket ?? null;
  const messages = conversationQuery.data?.messages ?? [];
  const isClosed = selectedTicket?.status === "CLOSED";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        variant === "popover"
          ? "h-full"
          : "h-[70vh] min-h-[420px] rounded-md border border-border bg-card"
      )}
    >
      {view === "list" ? (
        <>
          <div className="flex flex-col gap-xs border-b border-border p-md">
            <textarea
              value={composerBody}
              onChange={(event) => setComposerBody(event.target.value)}
              placeholder="Message our support team…"
              rows={2}
              disabled={startMutation.isPending}
              className={fieldClassName}
            />
            <Button
              size="sm"
              className="self-end"
              disabled={startMutation.isPending || !composerBody.trim()}
              onClick={handleStartConversation}
            >
              {startMutation.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Send
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!ticketsLoaded ? (
              <div className="flex items-center justify-center p-lg text-body-sm text-muted-foreground">
                <Loader2Icon className="animate-spin" aria-hidden />
              </div>
            ) : tickets.length === 0 ? (
              <div className="flex flex-col items-center gap-sm px-lg py-xl text-center">
                <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
                <p className="font-display text-title-sm text-ink">No conversations yet</p>
                <p className="max-w-xs text-body-sm text-muted-foreground">
                  Send us a message and our team will get back to you.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {tickets.map((ticket) => {
                  const unread = isTicketUnread(ticket);
                  return (
                    <li key={ticket.id}>
                      <button
                        type="button"
                        onClick={() => openThread(ticket.id)}
                        className="flex w-full flex-col gap-1 px-md py-sm text-left transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-none"
                      >
                        <div className="flex items-center justify-between gap-sm">
                          <span className="flex min-w-0 items-center gap-xs">
                            {unread && (
                              <span
                                className="size-2 shrink-0 rounded-full bg-primary"
                                aria-hidden
                              />
                            )}
                            <span className="truncate text-body-md font-medium text-ink">
                              {ticket.subject}
                            </span>
                          </span>
                          <span className="shrink-0 text-body-sm text-muted-foreground">
                            {formatRelativeTime(ticket.lastMessageAt ?? ticket.createdAt)}
                          </span>
                        </div>
                        <Badge variant={statusVariant(ticket.status)} className="w-fit">
                          {ticket.status}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-xs border-b border-border p-md">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleBack}
              aria-label="Back to conversations"
            >
              <ArrowLeftIcon aria-hidden />
            </Button>
            <span className="min-w-0 flex-1 truncate text-body-md font-medium text-ink">
              {selectedTicket?.subject ?? "Conversation"}
            </span>
            {selectedTicket && (
              <Badge variant={statusVariant(selectedTicket.status)}>{selectedTicket.status}</Badge>
            )}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-md">
            <div className="flex flex-col gap-sm">
              {messages.map((message) => {
                const mine = selectedTicket ? message.senderId === selectedTicket.createdBy : false;
                return (
                  <div key={message.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                    {!mine && (
                      <span className="mb-0.5 px-1 text-body-sm text-muted-foreground">Support team</span>
                    )}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-md px-sm py-xs text-body-md break-words",
                        mine ? "bg-primary/10 text-ink" : "bg-surface-soft text-ink"
                      )}
                    >
                      {message.body}
                    </div>
                    <span className="mt-0.5 px-1 text-body-sm text-muted-foreground">
                      {formatRelativeTime(message.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border p-md">
            {isClosed ? (
              <p className="text-body-sm text-muted-foreground">This conversation is closed.</p>
            ) : (
              <div className="flex items-end gap-xs">
                <textarea
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  onKeyDown={handleReplyKeyDown}
                  placeholder="Type a message…"
                  rows={2}
                  disabled={sendMutation.isPending}
                  className={cn(fieldClassName, "flex-1")}
                />
                <Button
                  size="icon-sm"
                  disabled={sendMutation.isPending || !replyBody.trim()}
                  onClick={handleSendReply}
                  aria-label="Send message"
                >
                  {sendMutation.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <SendIcon aria-hidden />
                  )}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
