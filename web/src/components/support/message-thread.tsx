import * as React from "react";
import { ArrowDownIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelativeTime } from "@/components/support/support-labels";
import type { PendingMessage } from "@/components/support/use-support";
import type { SupportMessage } from "@/types/support";

interface MessageThreadProps {
  messages: SupportMessage[];
  pending: PendingMessage[];
  /** Whose side of the conversation this screen is — their bubbles sit on the right. */
  viewer: "REQUESTER" | "STAFF";
  /** Staff view: the requester's display name. */
  requesterName?: string;
  /** Staff view: the signed-in staff member, whose own messages read "You". */
  viewerUserId?: string | null;
  /** Legacy tickets with no messages: show the ticket description as the opening message. */
  fallback?: { body: string; createdAt: string };
  /** Changes when a different conversation is shown — resets scroll and announcements. */
  conversationKey: string;
}

const NEAR_BOTTOM_PX = 96;

function authorLabel(
  message: SupportMessage,
  viewer: MessageThreadProps["viewer"],
  requesterName?: string,
  viewerUserId?: string | null,
): string {
  if (viewer === "REQUESTER") return message.author === "REQUESTER" ? "You" : "MUN Hub support";
  if (message.author === "REQUESTER") return requesterName ?? "Requester";
  if (viewerUserId && message.senderId === viewerUserId) return "You";
  return message.senderName ?? "Support team";
}

/**
 * The message list for one conversation, shared by the requester inbox, the
 * chat widget and the staff queue.
 *
 * - Sticks to the latest message while the reader is at the bottom; if they
 *   have scrolled up to read history, new messages don't yank the view and a
 *   "New messages" button appears instead.
 * - New messages from the other side are announced through a polite live
 *   region (just the new message, never the whole history on load).
 * - The scroll area is focusable so it can be scrolled from the keyboard.
 */
export function MessageThread({
  messages,
  pending,
  viewer,
  requesterName,
  viewerUserId,
  fallback,
  conversationKey,
}: MessageThreadProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const atBottomRef = React.useRef(true);
  const seenIdsRef = React.useRef<Set<string> | null>(null);
  const [hasUnseenBelow, setHasUnseenBelow] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setHasUnseenBelow(false);
  }, []);

  // A different conversation: start at its latest message, forget what was seen.
  React.useLayoutEffect(() => {
    seenIdsRef.current = null;
    atBottomRef.current = true;
    setHasUnseenBelow(false);
    setAnnouncement("");
  }, [conversationKey]);

  const lastId = messages.at(-1)?.id;
  const count = messages.length + pending.length;

  React.useLayoutEffect(() => {
    const seen = seenIdsRef.current;
    const fresh = seen ? messages.filter((m) => !seen.has(m.id)) : [];
    seenIdsRef.current = new Set(messages.map((m) => m.id));

    const incoming = fresh.filter((m) => m.author !== viewer);
    if (incoming.length > 0) {
      const latest = incoming[incoming.length - 1];
      const preview = latest.body.length > 140 ? `${latest.body.slice(0, 140)}…` : latest.body;
      setAnnouncement(`New message from ${authorLabel(latest, viewer, requesterName)}: ${preview}`);
    }

    // First paint, my own message (pending or just confirmed), or reader already at the bottom.
    const mineJustSent = pending.length > 0 || fresh.some((m) => m.author === viewer);
    if (!seen || mineJustSent || atBottomRef.current) {
      scrollToBottom();
    } else if (incoming.length > 0) {
      setHasUnseenBelow(true);
    }
    // `count`/`lastId` capture every change to what is rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, lastId, conversationKey]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setHasUnseenBelow(false);
  }

  const showFallback = messages.length === 0 && fallback !== undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        tabIndex={0}
        role="region"
        aria-label="Messages"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-md py-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ol className="flex flex-col gap-md">
          {showFallback && (
            <MessageBubble
              mine={viewer === "REQUESTER"}
              label={viewer === "REQUESTER" ? "You" : (requesterName ?? "Requester")}
              body={fallback.body}
              createdAt={fallback.createdAt}
            />
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              mine={message.author === viewer}
              label={authorLabel(message, viewer, requesterName, viewerUserId)}
              body={message.body}
              createdAt={message.createdAt}
            />
          ))}
          {pending.map((message) => (
            <MessageBubble
              key={message.tempId}
              mine
              label="You"
              body={message.body}
              createdAt={message.createdAt}
              sending
            />
          ))}
        </ol>
      </div>

      {hasUnseenBelow && (
        <div className="pointer-events-none absolute inset-x-0 bottom-sm flex justify-center">
          <Button size="xs" variant="outline" className="pointer-events-auto shadow-sm" onClick={() => scrollToBottom("smooth")}>
            <ArrowDownIcon aria-hidden />
            New messages
          </Button>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

function MessageBubble({
  mine,
  label,
  body,
  createdAt,
  sending = false,
}: {
  mine: boolean;
  label: string;
  body: string;
  createdAt: string;
  sending?: boolean;
}) {
  // Plain template strings, not cn(): cn() drops a custom text-* size token
  // when a text colour follows it.
  const align = mine ? "items-end" : "items-start";
  const bubble = mine
    ? "rounded-md rounded-br-xs bg-primary text-primary-foreground"
    : "rounded-md rounded-bl-xs border border-border bg-surface-soft text-ink";

  return (
    <li className={`flex flex-col gap-xxs ${align}`} aria-busy={sending || undefined}>
      <span className="px-xxs text-[12px] font-medium text-muted-foreground">{label}</span>
      <div
        className={`max-w-[85%] px-sm py-xs text-body-md leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere] ${bubble} ${sending ? "opacity-70" : ""}`}
      >
        {body}
      </div>
      <span className="flex items-center gap-xxs px-xxs text-[12px] text-muted-foreground">
        {sending ? (
          <>
            <Loader2Icon className="size-3 animate-spin" aria-hidden />
            Sending…
          </>
        ) : (
          <time dateTime={createdAt} title={formatDateTime(createdAt)}>
            {formatRelativeTime(createdAt)}
          </time>
        )}
      </span>
    </li>
  );
}
