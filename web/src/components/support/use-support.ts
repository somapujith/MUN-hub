import * as React from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { getConversation, markConversationRead, sendConversationMessage } from "@/api/support";
import type {
  ConversationDetail,
  StaffReplyStatus,
  SupportPage,
  SupportTicket,
} from "@/types/support";

/**
 * Polling cadence. Every support query polls only while it is mounted and
 * enabled (the widget is open, a thread is selected) and only while the tab is
 * visible — TanStack Query pauses `refetchInterval` for hidden tabs when
 * `refetchIntervalInBackground` is false, and refetches on focus instead.
 */
export const SUPPORT_POLL_MS = {
  /** The widget badge, while the widget is closed. */
  badge: 60_000,
  /** A conversation list that is on screen. */
  list: 15_000,
  /** The open thread. */
  thread: 5_000,
  /** The staff queue. */
  staffQueue: 30_000,
} as const;

const LIST_PREFIXES = [
  ["support", "conversation-list"],
  ["admin", "support-tickets"],
] as const;

type TicketPatch = Partial<SupportTicket> & { id: string };

/** Applies a ticket change to every cached conversation list (requester and staff). */
export function patchTicketInLists(queryClient: QueryClient, patch: TicketPatch): void {
  for (const prefix of LIST_PREFIXES) {
    queryClient.setQueriesData<SupportPage<SupportTicket>>({ queryKey: prefix }, (page) =>
      page
        ? { ...page, results: page.results.map((t) => (t.id === patch.id ? { ...t, ...patch } : t)) }
        : page,
    );
  }
}

/** Refreshes lists and badges after something changed on the server. */
export function invalidateSupportSummaries(queryClient: QueryClient): void {
  for (const prefix of LIST_PREFIXES) void queryClient.invalidateQueries({ queryKey: prefix });
  void queryClient.invalidateQueries({ queryKey: queryKeys.unreadConversationCount() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminUnreadConversationCount() });
}

/**
 * One thread, polled while `enabled`. Whatever the thread poll learns about
 * the ticket (a new status, new activity) is copied into the cached lists, so
 * the list next to the thread never contradicts it until its own slower poll.
 */
export function useConversation(ticketId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.conversation(ticketId ?? "none"),
    queryFn: () => getConversation(ticketId as string),
    enabled: enabled && ticketId !== null,
    staleTime: 2_000,
    refetchInterval: SUPPORT_POLL_MS.thread,
    refetchIntervalInBackground: false,
  });

  const ticket = query.data?.ticket;
  const version = ticket ? `${ticket.id}:${ticket.updatedAt}:${ticket.status}:${ticket.lastMessageAt ?? ""}` : null;
  React.useEffect(() => {
    if (ticket) patchTicketInLists(queryClient, ticket);
    // `version` captures every field worth copying.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, queryClient]);

  return query;
}

/**
 * Marks the thread read once it is on screen with something unread in it, and
 * again only when a newer message arrives. Clears the unread flag in every
 * cached list and refreshes the badges, so indicators drop immediately rather
 * than on the next poll.
 */
export function useMarkReadWhenViewed(conversation: ConversationDetail | undefined): void {
  const queryClient = useQueryClient();
  const handled = React.useRef<string | null>(null);
  const ticketId = conversation?.ticket.id;
  const unread = conversation?.ticket.unread ?? false;
  const marker = `${ticketId}:${conversation?.ticket.lastMessageAt ?? ""}`;

  React.useEffect(() => {
    if (!ticketId || !unread || handled.current === marker) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    handled.current = marker;

    markConversationRead(ticketId)
      .then(() => {
        queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(ticketId), (old) =>
          old ? ({ ...old, ticket: { ...old.ticket, unread: false } } as ConversationDetail) : old,
        );
        patchTicketInLists(queryClient, { id: ticketId, unread: false });
        void queryClient.invalidateQueries({ queryKey: queryKeys.unreadConversationCount() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminUnreadConversationCount() });
      })
      .catch(() => {
        // Try again on the next poll.
        handled.current = null;
      });
  }, [ticketId, unread, marker, queryClient]);
}

export interface PendingMessage {
  tempId: string;
  body: string;
  createdAt: string;
}

let tempCounter = 0;

/**
 * Sends a reply with an optimistic bubble. The pending bubble lives in local
 * state rather than in the query cache, so a poll that lands mid-send can't
 * drop it or duplicate it; on success the real message is merged into the
 * cache (deduplicated by id) and the bubble removed, on failure the bubble is
 * removed and the promise rejects so the caller can restore the draft.
 *
 * Mount it once per conversation (key the thread component by ticket id) so
 * pending bubbles never carry over to another thread.
 */
export function useSendMessage(ticketId: string | null) {
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<PendingMessage[]>([]);

  const mutation = useMutation({
    mutationFn: (vars: { ticketId: string; body: string; nextStatus?: StaffReplyStatus; tempId: string }) =>
      sendConversationMessage(vars.ticketId, vars.body, vars.nextStatus),
    onMutate: (vars) => {
      setPending((current) => [...current, { tempId: vars.tempId, body: vars.body, createdAt: new Date().toISOString() }]);
    },
    onSuccess: (result, vars) => {
      queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(vars.ticketId), (old) => {
        if (!old) return old;
        const messages = old.messages.some((m) => m.id === result.message.id)
          ? old.messages
          : [...old.messages, result.message].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return { ...old, ticket: { ...old.ticket, ...result.ticket }, messages } as ConversationDetail;
      });
      patchTicketInLists(queryClient, result.ticket);
      invalidateSupportSummaries(queryClient);
    },
    onSettled: (_result, _error, vars) => {
      setPending((current) => current.filter((m) => m.tempId !== vars.tempId));
    },
  });

  const send = React.useCallback(
    (body: string, nextStatus?: StaffReplyStatus) => {
      if (!ticketId) return Promise.reject(new Error("No conversation selected"));
      tempCounter += 1;
      return mutation.mutateAsync({ ticketId, body, nextStatus, tempId: `pending-${tempCounter}` });
    },
    [mutation, ticketId],
  );

  return { send, pending, sending: mutation.isPending };
}
