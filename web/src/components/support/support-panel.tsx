import * as React from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  LifeBuoyIcon,
  LockIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/api/query-keys";
import { getOrganizerWorkspaceOverview } from "@/api/organizer-dashboard";
import { listMyConversations, startConversation } from "@/api/support";
import { useSession } from "@/hooks/use-session";
import { MessageComposer } from "@/components/support/message-composer";
import { MessageThread } from "@/components/support/message-thread";
import {
  categoryLabel,
  formatRelativeTime,
  statusLabel,
  statusTone,
} from "@/components/support/support-labels";
import {
  SUPPORT_POLL_MS,
  invalidateSupportSummaries,
  useConversation,
  useMarkReadWhenViewed,
  useSendMessage,
} from "@/components/support/use-support";
import type { ConversationDetail, SupportTicket } from "@/types/support";

/**
 * The requester side of the support desk: a conversation list with a
 * "new message" composer, and the selected thread.
 *
 * - `variant="popover"` (inside the chat widget): one column, list or thread.
 *   The selection is local state.
 * - `variant="page"` (/dashboard/support, /organizer/support): list and
 *   thread side by side from `lg`, one at a time below it. The selection is
 *   the `?ticket=` search param, so a ticket can be linked to directly (the
 *   /support/new form lands there).
 */
export interface SupportPanelProps {
  variant?: "popover" | "page";
}

const PAGE_SIZE = 20;
const MAX_LIST = 100;

export function SupportPanel({ variant = "popover" }: SupportPanelProps) {
  const isPage = variant === "page";
  const [searchParams, setSearchParams] = useSearchParams();
  const [localSelected, setLocalSelected] = React.useState<string | null>(null);
  const selectedId = isPage ? searchParams.get("ticket") : localSelected;
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  // Page variant only: forces the right pane to show the "new message"
  // composer on a narrow screen even though nothing is selected (below `lg`
  // the right pane is otherwise hidden whenever `selectedId` is null, so the
  // list has room). Irrelevant once selecting a ticket sets `selectedId`.
  const [composing, setComposing] = React.useState(false);
  const { data: session } = useSession();

  const select = React.useCallback(
    (ticketId: string | null) => {
      if (ticketId) setComposing(false);
      if (!isPage) {
        setLocalSelected(ticketId);
        return;
      }
      // From the live URL, not the last-rendered params (see the staff queue).
      const next = new URLSearchParams(window.location.search);
      if (ticketId) next.set("ticket", ticketId);
      else next.delete("ticket");
      setSearchParams(next);
    },
    [isPage, setSearchParams],
  );

  const startComposing = React.useCallback(() => {
    select(null);
    setComposing(true);
  }, [select]);

  // In the widget the list is hidden while a thread is open, so it doesn't poll then.
  const listVisible = isPage || selectedId === null;
  const listQuery = useQuery({
    queryKey: queryKeys.myConversations({ limit }),
    queryFn: () => listMyConversations({ limit }),
    enabled: listVisible,
    placeholderData: (previous) => previous,
    refetchInterval: SUPPORT_POLL_MS.list,
    refetchIntervalInBackground: false,
  });

  const isOrganizer = session?.role === "ORGANIZER";
  const workspaceQuery = useQuery({
    queryKey: queryKeys.organizerWorkspace(),
    queryFn: getOrganizerWorkspaceOverview,
    enabled: isOrganizer,
  });
  const munOptions = React.useMemo(
    () => (workspaceQuery.data?.muns ?? []).map((mun) => ({ id: mun.id, name: mun.name })),
    [workspaceQuery.data],
  );
  const munName = React.useCallback(
    (munId: string | null) => (munId ? (munOptions.find((m) => m.id === munId)?.name ?? null) : null),
    [munOptions],
  );

  const tickets = listQuery.data?.results ?? [];
  const total = listQuery.data?.total ?? 0;

  const list = (
    <section
      aria-label="Your conversations"
      className={`min-h-0 flex-col ${isPage ? "border-border lg:border-r" : ""} ${
        isPage && (selectedId || composing) ? "hidden lg:flex" : "flex"
      } ${isPage ? "" : "flex-1"}`}
    >
      {isPage ? (
        <div className="flex items-center justify-between gap-sm border-b border-border px-md py-sm">
          <h2 className="text-body-md font-semibold text-ink">Conversations</h2>
          <Button variant="outline" size="sm" onClick={startComposing}>
            <PlusIcon aria-hidden />
            New
          </Button>
        </div>
      ) : (
        <NewConversation munOptions={munOptions} onStarted={select} autoFocus />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {listQuery.isPending ? (
          <div className="flex flex-col gap-xs p-md" aria-busy="true" aria-label="Loading conversations">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : listQuery.isError && tickets.length === 0 ? (
          <LoadError message={listQuery.error.message} onRetry={() => void listQuery.refetch()} />
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-sm px-lg py-xl text-center">
            <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
            <p className="font-display text-title-sm text-ink">No conversations yet</p>
            <p className="max-w-xs text-body-md text-muted-foreground">
              Send us a message and our team will reply here.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {tickets.map((ticket) => (
                <ConversationListItem
                  key={ticket.id}
                  ticket={ticket}
                  selected={ticket.id === selectedId}
                  munName={munName(ticket.relatedMunId)}
                  onSelect={() => select(ticket.id)}
                />
              ))}
            </ul>
            {total > tickets.length && limit < MAX_LIST && (
              <div className="p-md">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={listQuery.isFetching}
                  onClick={() => setLimit((current) => Math.min(current + PAGE_SIZE, MAX_LIST))}
                >
                  Show older conversations
                </Button>
              </div>
            )}
            {total > tickets.length && limit >= MAX_LIST && (
              <p className="p-md text-[12px] text-muted-foreground">
                Showing your {MAX_LIST} most recent conversations.
              </p>
            )}
          </>
        )}
      </div>
      <div className="border-t border-border px-md py-sm">
        <Link to="/support/new" className="text-[13px] text-link underline-offset-4 hover:underline">
          Need to pick a category? Use the full support form
        </Link>
      </div>
    </section>
  );

  const thread = selectedId ? (
    <RequesterThread
      key={selectedId}
      ticketId={selectedId}
      munName={munName}
      onBack={() => select(null)}
      backVisibility={isPage ? "mobile" : "always"}
    />
  ) : (
    <NewConversationPane munOptions={munOptions} onStarted={select} onBack={() => setComposing(false)} />
  );

  if (!isPage) {
    return <div className="flex min-h-0 w-full flex-1 flex-col">{selectedId ? thread : list}</div>;
  }

  return (
    <div className="grid h-[72vh] min-h-[480px] w-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card lg:grid-cols-[22rem_minmax(0,1fr)]">
      {list}
      <div className={`min-h-0 min-w-0 flex-col ${selectedId || composing ? "flex" : "hidden lg:flex"}`}>{thread}</div>
    </div>
  );
}

function ConversationListItem({
  ticket,
  selected,
  munName,
  onSelect,
}: {
  ticket: SupportTicket;
  selected: boolean;
  munName: string | null;
  onSelect: () => void;
}) {
  const base =
    "flex w-full flex-col gap-xxs px-md py-sm text-left transition-colors outline-none hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className={`${base} ${selected ? "bg-surface-soft" : ""}`}>
        <span className="flex items-center justify-between gap-sm">
          <span className="flex min-w-0 items-center gap-xs">
            {ticket.unread && <span className="size-2 shrink-0 rounded-full bg-link" aria-hidden />}
            <span className={`truncate text-body-md text-ink ${ticket.unread ? "font-semibold" : "font-medium"}`}>
              {ticket.subject}
            </span>
          </span>
          <time dateTime={ticket.lastActivityAt} className="shrink-0 text-[12px] text-muted-foreground">
            {formatRelativeTime(ticket.lastActivityAt)}
          </time>
        </span>
        <span className="flex flex-wrap items-center gap-xs">
          <Badge variant={statusTone(ticket.status, "requester")}>{statusLabel(ticket.status, "requester")}</Badge>
          <span className="truncate text-[12px] text-muted-foreground">
            {munName ? `${munName} · ` : ""}
            {categoryLabel(ticket.category)}
          </span>
          {ticket.unread && <span className="sr-only">New reply from support</span>}
        </span>
      </button>
    </li>
  );
}

function NewConversation({
  munOptions,
  onStarted,
  autoFocus,
  wrapperClassName = "border-b border-border p-md",
}: {
  munOptions: { id: string; name: string }[];
  onStarted: (ticketId: string) => void;
  autoFocus: boolean;
  wrapperClassName?: string;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = React.useState("");
  const [munId, setMunId] = React.useState("");

  const mutation = useMutation({
    mutationFn: startConversation,
    onSuccess: (result) => {
      setBody("");
      queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(result.ticket.id), {
        viewer: "REQUESTER",
        ticket: result.ticket,
        messages: [result.message],
      });
      invalidateSupportSummaries(queryClient);
      onStarted(result.ticket.id);
    },
    onError: (error) => toast.error(error.message),
  });

  const munPicker =
    munOptions.length > 0 ? (
      <>
        <label htmlFor="support-new-mun" className="sr-only">
          Which conference is this about?
        </label>
        <select
          id="support-new-mun"
          value={munId}
          onChange={(event) => setMunId(event.target.value)}
          disabled={mutation.isPending}
          className="h-9 max-w-[14rem] min-w-0 rounded-sm border border-input bg-background px-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-card"
        >
          <option value="">Any conference</option>
          {munOptions.map((mun) => (
            <option key={mun.id} value={mun.id}>
              About {mun.name}
            </option>
          ))}
        </select>
      </>
    ) : null;

  return (
    <div className={wrapperClassName}>
      <MessageComposer
        id="support-new-message"
        label="Message our support team…"
        placeholder="Message our support team…"
        value={body}
        onChange={setBody}
        onSubmit={() => mutation.mutate({ body: body.trim(), relatedMunId: munId || undefined })}
        sending={mutation.isPending}
        submitStyle="text"
        extra={munPicker}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/**
 * The page variant's right pane when no conversation is selected: a
 * chat-shaped "start a new message" panel (header, empty state, composer
 * pinned at the bottom) so the ticket list on the left stays list-only.
 */
function NewConversationPane({
  munOptions,
  onStarted,
  onBack,
}: {
  munOptions: { id: string; name: string }[];
  onStarted: (ticketId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex items-center gap-xs border-b border-border px-md py-sm">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to conversations" className="lg:hidden">
          <ArrowLeftIcon aria-hidden />
        </Button>
        <h2 className="text-body-md font-semibold text-ink">New message</h2>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-sm p-xl text-center">
        <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
        <p className="max-w-xs text-body-md text-muted-foreground">
          Send a message below and our team will reply here.
        </p>
      </div>
      <NewConversation
        munOptions={munOptions}
        onStarted={onStarted}
        autoFocus={false}
        wrapperClassName="border-t border-border p-md"
      />
    </div>
  );
}

function RequesterThread({
  ticketId,
  munName,
  onBack,
  backVisibility,
}: {
  ticketId: string;
  munName: (munId: string | null) => string | null;
  onBack: () => void;
  backVisibility: "always" | "mobile";
}) {
  const conversationQuery = useConversation(ticketId);
  const conversation = conversationQuery.data;
  useMarkReadWhenViewed(conversation);
  const { send, pending, sending } = useSendMessage(ticketId);
  const [draft, setDraft] = React.useState("");

  const ticket = conversation?.ticket;
  const about = ticket ? munName(ticket.relatedMunId) : null;

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await send(text);
    } catch (error) {
      setDraft((current) => current || text);
      toast.error(error instanceof Error ? error.message : "Your message wasn't sent. Try again.");
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex items-start gap-xs border-b border-border px-md py-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to conversations"
          className={backVisibility === "mobile" ? "lg:hidden" : undefined}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-xxs pt-1">
          <h2 className="truncate text-body-md font-semibold text-ink">{ticket?.subject ?? "Conversation"}</h2>
          {ticket && (
            <span className="flex flex-wrap items-center gap-xs">
              <Badge variant={statusTone(ticket.status, "requester")}>{statusLabel(ticket.status, "requester")}</Badge>
              <span className="text-[12px] text-muted-foreground">
                {about ? `${about} · ` : ""}
                {categoryLabel(ticket.category)}
              </span>
            </span>
          )}
        </div>
      </div>

      {conversationQuery.isPending ? (
        <div className="flex flex-1 flex-col gap-sm p-md" aria-busy="true" aria-label="Loading conversation">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="ml-auto h-12 w-1/2" />
        </div>
      ) : !conversation ? (
        <LoadError
          message={
            conversationQuery.error && "status" in conversationQuery.error &&
            (conversationQuery.error.status === 403 || conversationQuery.error.status === 404)
              ? "This conversation isn't available."
              : (conversationQuery.error?.message ?? "Couldn't load this conversation.")
          }
          onRetry={() => void conversationQuery.refetch()}
        />
      ) : (
        <>
          {conversationQuery.isError && (
            <p role="status" className="flex items-center gap-xs border-b border-border bg-warning/10 px-md py-xs text-[12px] text-warning-text">
              <AlertCircleIcon className="size-3.5" aria-hidden />
              Reconnecting… new messages may be delayed.
            </p>
          )}
          <MessageThread
            conversationKey={conversation.ticket.id}
            messages={conversation.messages}
            pending={pending}
            viewer="REQUESTER"
            fallback={{ body: conversation.ticket.description, createdAt: conversation.ticket.createdAt }}
          />
          <div className="border-t border-border p-md">
            {conversation.ticket.status === "CLOSED" ? (
              <p className="flex items-center gap-xs text-body-md text-muted-foreground">
                <LockIcon className="size-4" aria-hidden />
                This conversation is closed. Send a new message to start another one.
              </p>
            ) : (
              <div className="flex flex-col gap-sm">
                {conversation.ticket.status === "RESOLVED" && (
                  <div className="flex gap-xs rounded-sm border border-success/30 bg-success/10 px-sm py-xs text-body-md text-ink">
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <div className="flex flex-col gap-xxs">
                      <span className="font-medium">Marked resolved by our team</span>
                      {conversation.ticket.resolutionNotes && (
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {conversation.ticket.resolutionNotes}
                        </span>
                      )}
                      <span className="text-[12px] text-muted-foreground">Still need help? Reply and we'll reopen it.</span>
                    </div>
                  </div>
                )}
                <MessageComposer
                  id={`support-reply-${conversation.ticket.id}`}
                  label="Type a message…"
                  placeholder="Type a message…"
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => void handleSend()}
                  sending={sending}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-sm p-lg text-center">
      <AlertCircleIcon className="size-6 text-destructive" aria-hidden />
      <p className="max-w-xs text-body-md text-ink">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCwIcon aria-hidden />
        Try again
      </Button>
    </div>
  );
}
