"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { ArrowLeftIcon, Loader2Icon, LifeBuoyIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SupportTicketRow, SupportMessageRow } from "@/lib/actions/support";
import {
  startConversationAction,
  sendMessageAction,
  getConversationAction,
  markConversationReadAction,
  listMyConversationsAction,
} from "@/app/support/chat-actions";

/**
 * Core reusable chat UI for the "Support Desk" feature. Two mount points:
 * the floating `SupportWidget` (`variant="popover"`, inside a `Sheet`) and
 * the full-page `/dashboard/support` + `/organizer/support` routes
 * (`variant="page"`, built by other agents against this exact prop
 * contract — do not rename `role`/`variant`).
 *
 * `role` is accepted for API-contract stability (both mount sites already
 * know it and it reads naturally at call sites) but isn't branched on
 * internally: every ticket `listMyConversationsAction()` returns is one the
 * caller created, so `message.senderId === ticket.createdBy` is a complete
 * "is this my bubble" test without knowing the caller's own role or id.
 */
export interface SupportPanelProps {
  role: "STUDENT" | "ORGANIZER";
  variant?: "popover" | "page";
}

const LIST_POLL_MS = 20_000;
const THREAD_POLL_MS = 4_000;

function statusVariant(status: SupportTicketRow["status"]): "secondary" | "info" | "success" {
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

/** Mirrors the unread rule from the task spec: unread iff the last message
 * wasn't mine and either I've never read this ticket or it arrived after my
 * last read. */
function isTicketUnread(ticket: SupportTicketRow): boolean {
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

export function SupportPanel({ role: _role, variant = "popover" }: SupportPanelProps) {
  const [view, setView] = React.useState<"list" | "thread">("list");
  const [tickets, setTickets] = React.useState<SupportTicketRow[]>([]);
  const [ticketsLoaded, setTicketsLoaded] = React.useState(false);
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = React.useState<SupportTicketRow | null>(null);
  const [messages, setMessages] = React.useState<SupportMessageRow[]>([]);
  const [composerBody, setComposerBody] = React.useState("");
  const [replyBody, setReplyBody] = React.useState("");
  const [starting, startStarting] = React.useTransition();
  const [sending, startSending] = React.useTransition();

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastSeenActivityRef = React.useRef<string | null>(null);

  const refreshList = React.useCallback(async () => {
    const result = await listMyConversationsAction();
    if (!result.ok) {
      toast.error("Could not load conversations", { description: result.error });
      return;
    }
    setTickets(result.data);
    setTicketsLoaded(true);
  }, []);

  // Poll the conversation list every ~20s while it's the visible view.
  React.useEffect(() => {
    if (view !== "list") return;
    void refreshList();
    const interval = setInterval(refreshList, LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [view, refreshList]);

  const openThread = React.useCallback(async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setSelectedTicket(null);
    setMessages([]);
    setReplyBody("");
    setView("thread");
    lastSeenActivityRef.current = null;

    const result = await getConversationAction(ticketId);
    if (!result.ok) {
      toast.error("Could not load conversation", { description: result.error });
      return;
    }
    setSelectedTicket(result.data.ticket);
    setMessages(result.data.messages);
    lastSeenActivityRef.current = result.data.ticket.lastMessageAt
      ? new Date(result.data.ticket.lastMessageAt).toISOString()
      : "read";
    void markConversationReadAction(ticketId);
  }, []);

  // Poll the open thread every ~4s and re-mark-read whenever new activity
  // (a newer `lastMessageAt`) shows up, which is what clears the unread dot.
  React.useEffect(() => {
    if (view !== "thread" || !selectedTicketId) return;
    const ticketId = selectedTicketId;
    const interval = setInterval(async () => {
      const result = await getConversationAction(ticketId);
      if (!result.ok) return;
      setSelectedTicket(result.data.ticket);
      setMessages(result.data.messages);
      const latest = result.data.ticket.lastMessageAt
        ? new Date(result.data.ticket.lastMessageAt).toISOString()
        : null;
      if (latest && latest !== lastSeenActivityRef.current) {
        lastSeenActivityRef.current = latest;
        void markConversationReadAction(ticketId);
      }
    }, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [view, selectedTicketId]);

  // Auto-scroll to bottom on new messages.
  React.useEffect(() => {
    if (view !== "thread") return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, view]);

  function handleBack() {
    setView("list");
    setSelectedTicketId(null);
    setSelectedTicket(null);
    setMessages([]);
    setReplyBody("");
  }

  function handleStartConversation() {
    const body = composerBody.trim();
    if (!body || starting) return;
    startStarting(async () => {
      const result = await startConversationAction(body);
      if (!result.ok) {
        toast.error("Could not send message", { description: result.error });
        return;
      }
      setComposerBody("");
      void refreshList();
      setSelectedTicketId(result.data.ticket.id);
      setSelectedTicket(result.data.ticket);
      setMessages([result.data.message]);
      lastSeenActivityRef.current = result.data.ticket.lastMessageAt
        ? new Date(result.data.ticket.lastMessageAt).toISOString()
        : "read";
      setView("thread");
    });
  }

  function handleSendReply() {
    if (!selectedTicketId) return;
    const body = replyBody.trim();
    if (!body || sending) return;
    startSending(async () => {
      const result = await sendMessageAction(selectedTicketId, body);
      if (!result.ok) {
        toast.error("Could not send message", { description: result.error });
        return;
      }
      setMessages((prev) => [...prev, result.data]);
      setReplyBody("");
      lastSeenActivityRef.current = new Date(result.data.createdAt).toISOString();
    });
  }

  function handleReplyKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendReply();
    }
  }

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
              disabled={starting}
              className={fieldClassName}
            />
            <Button
              size="sm"
              className="self-end"
              disabled={starting || !composerBody.trim()}
              onClick={handleStartConversation}
            >
              {starting ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
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
                        onClick={() => void openThread(ticket.id)}
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
                  disabled={sending}
                  className={cn(fieldClassName, "flex-1")}
                />
                <Button
                  size="icon-sm"
                  disabled={sending || !replyBody.trim()}
                  onClick={handleSendReply}
                  aria-label="Send message"
                >
                  {sending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
