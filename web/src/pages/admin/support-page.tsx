import * as React from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  LifeBuoyIcon,
  Link2Icon,
  Loader2Icon,
  LockIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SearchIcon,
  SendIcon,
  Unlink2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import {
  assignSupportTicketToSelf,
  getAdminUnreadConversationCount,
  getTelegramLinkStatus,
  listStaffSupportTickets,
  startTelegramLink,
  unlinkTelegram,
  updateSupportTicketStatus,
} from "@/api/support";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MessageComposer, composerFieldClassName } from "@/components/support/message-composer";
import { MessageThread } from "@/components/support/message-thread";
import {
  PRIORITY_LABELS,
  REQUESTER_CATEGORY_OPTIONS,
  categoryLabel,
  formatDateTime,
  formatRelativeTime,
  priorityTone,
  statusLabel,
  statusTone,
} from "@/components/support/support-labels";
import {
  SUPPORT_POLL_MS,
  invalidateSupportSummaries,
  patchTicketInLists,
  useConversation,
  useMarkReadWhenViewed,
  useSendMessage,
} from "@/components/support/use-support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import {
  ALLOWED_TICKET_TRANSITIONS,
  SUPPORT_LIMITS,
  type ConversationDetail,
  type ListStaffTicketsParams,
  type StaffReplyStatus,
  type StaffSupportTicket,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from "@/types/support";

const PAGE_SIZE = 25;

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "OPEN", label: "Open (not resolved)" },
  { value: "ALL", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WAITING", label: "Waiting on requester" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const CATEGORY_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All categories" },
  ...REQUESTER_CATEGORY_OPTIONS,
  { value: "REFUND", label: categoryLabel("REFUND") },
];

const PRIORITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Any priority" },
  ...(Object.entries(PRIORITY_LABELS) as Array<[SupportPriority, string]>).map(([value, label]) => ({ value, label })),
];

const ASSIGNEE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Anyone" },
  { value: "me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
];

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "Delegate",
  ORGANIZER: "Organizer",
  OPERATIONS: "Staff",
  ADMIN: "Staff",
  SUPER_ADMIN: "Staff",
};

const selectClassName =
  "h-10 w-full rounded-sm border border-input bg-background px-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-card";

function oneOf<T extends string>(value: string | null, allowed: readonly { value: string }[]): T | undefined {
  return value && allowed.some((option) => option.value === value) ? (value as T) : undefined;
}

/** Queue filters live in the URL so a view can be shared and survives reloads. */
function useQueueState() {
  const [params, setParams] = useSearchParams();
  const status = oneOf<string>(params.get("status"), STATUS_FILTERS) ?? "OPEN";
  const category = oneOf<SupportCategory>(params.get("category"), CATEGORY_FILTERS);
  const priority = oneOf<SupportPriority>(params.get("priority"), PRIORITY_FILTERS);
  const assignee = oneOf<"me" | "unassigned">(params.get("assignee"), ASSIGNEE_FILTERS);
  const q = (params.get("q") ?? "").slice(0, SUPPORT_LIMITS.search);
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const selectedId = params.get("ticket");

  // Builds on the live URL, not on the `params` this component last rendered
  // with: two filter changes in quick succession (before the router
  // re-renders) would otherwise each start from the same stale params and the
  // second would undo the first.
  const update = React.useCallback(
    (changes: Record<string, string | null>, { resetPage = true } = {}) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (resetPage && !("page" in changes)) next.delete("page");
      setParams(next, { replace: !("ticket" in changes) });
    },
    [setParams],
  );

  const apiParams: ListStaffTicketsParams = {
    status: status === "ALL" ? undefined : (status as ListStaffTicketsParams["status"]),
    category,
    priority,
    assignee,
    q: q.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const filtered = status !== "OPEN" || Boolean(category || priority || assignee || q);
  return { status, category, priority, assignee, q, page, selectedId, update, apiParams, filtered };
}

/**
 * Per-staff Telegram link: click "Link Telegram" to get the bot's deep link,
 * send /start there, and the webhook (server/routes/webhooks.ts) completes
 * it — this card just polls the status until that happens. Unlinking is
 * immediate. Every linked staff member gets pinged on a new ticket or a
 * requester reply (lib/actions/telegram.ts).
 */
function TelegramLinkCard() {
  const queryClient = useQueryClient();
  const [deepLink, setDeepLink] = React.useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.adminTelegramLink(),
    queryFn: getTelegramLinkStatus,
    // Only worth polling while a link is pending — otherwise this is a
    // one-off check on page load.
    refetchInterval: (query) => (query.state.data?.pending ? 3000 : false),
  });

  const linkMutation = useMutation({
    mutationFn: startTelegramLink,
    onSuccess: ({ deepLink }) => {
      setDeepLink(deepLink);
      window.open(deepLink, "_blank", "noopener,noreferrer");
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminTelegramLink() });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't start the Telegram link"),
  });

  const unlinkMutation = useMutation({
    mutationFn: unlinkTelegram,
    onSuccess: () => {
      setDeepLink(null);
      queryClient.setQueryData(queryKeys.adminTelegramLink(), { linked: false, pending: false });
      toast.success("Telegram unlinked");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't unlink Telegram"),
  });

  const status = statusQuery.data;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-xs text-body-md">
          <SendIcon className="size-4 text-muted-foreground" aria-hidden />
          Telegram notifications
        </CardTitle>
        <CardDescription>Get a Telegram message when a new ticket comes in or a requester replies.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-sm">
        {statusQuery.isLoading ? (
          <span className="text-body-md text-muted-foreground">Checking...</span>
        ) : statusQuery.isError ? (
          <span className="text-body-md text-destructive">{statusQuery.error.message}</span>
        ) : status?.linked ? (
          <>
            <Badge variant="success">Linked</Badge>
            <Button
              size="sm"
              variant="outline"
              disabled={unlinkMutation.isPending}
              onClick={() => unlinkMutation.mutate()}
            >
              {unlinkMutation.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <Unlink2Icon aria-hidden />
              )}
              Unlink
            </Button>
          </>
        ) : (
          <>
            {status?.pending && deepLink ? (
              <>
                <Badge variant="warning">Waiting for /start in Telegram</Badge>
                <Button size="sm" variant="outline" render={<a href={deepLink} target="_blank" rel="noopener noreferrer" />}>
                  <ExternalLinkIcon aria-hidden />
                  Reopen Telegram
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={linkMutation.isPending} onClick={() => linkMutation.mutate()}>
                {linkMutation.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <Link2Icon aria-hidden />}
                Link Telegram
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminSupportPage() {
  const state = useQueueState();
  const { data: session } = useSession();
  const [searchDraft, setSearchDraft] = React.useState(state.q);

  // Debounce typing into the URL (and so into the query).
  const { update, q } = state;
  React.useEffect(() => {
    if (searchDraft.trim() === q.trim()) return;
    const timer = window.setTimeout(() => update({ q: searchDraft.trim() || null }), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, q, update]);

  const queueQuery = useQuery({
    queryKey: queryKeys.adminSupportTickets({ ...state.apiParams }),
    queryFn: () => listStaffSupportTickets(state.apiParams),
    placeholderData: (previous) => previous,
    refetchInterval: SUPPORT_POLL_MS.staffQueue,
    refetchIntervalInBackground: false,
  });

  const unreadQuery = useQuery({
    queryKey: queryKeys.adminUnreadConversationCount(),
    queryFn: getAdminUnreadConversationCount,
    refetchInterval: SUPPORT_POLL_MS.staffQueue,
    refetchIntervalInBackground: false,
  });

  const tickets = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const firstShown = total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(state.page * PAGE_SIZE, total);
  const awaiting = unreadQuery.data?.count ?? 0;

  return (
    <AdminPageFrame
      title="Support"
      description="Conversations from delegates and organizers, most recent activity first. Take a ticket, reply, and resolve it with a note the requester can read."
    >
      <TelegramLinkCard />

      <div className="flex flex-col gap-sm">
        <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <div className="flex flex-col gap-xs sm:col-span-2 lg:col-span-1">
            <Label htmlFor="support-search">Search</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-sm size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="support-search"
                type="search"
                value={searchDraft}
                maxLength={SUPPORT_LIMITS.search}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Subject, requester, email or ticket id"
                className="h-10 pl-xl"
              />
            </div>
          </div>
          <FilterSelect id="support-status-filter" label="Status" value={state.status} options={STATUS_FILTERS} onChange={(value) => state.update({ status: value === "OPEN" ? null : value })} />
          <FilterSelect id="support-category-filter" label="Category" value={state.category ?? ""} options={CATEGORY_FILTERS} onChange={(value) => state.update({ category: value })} />
          <FilterSelect id="support-priority-filter" label="Priority" value={state.priority ?? ""} options={PRIORITY_FILTERS} onChange={(value) => state.update({ priority: value })} />
          <FilterSelect id="support-assignee-filter" label="Assigned" value={state.assignee ?? ""} options={ASSIGNEE_FILTERS} onChange={(value) => state.update({ assignee: value })} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm text-body-md text-muted-foreground" aria-live="polite">
          <span>
            {queueQuery.isPending ? "Loading tickets…" : `${total.toLocaleString()} ${total === 1 ? "ticket" : "tickets"}`}
            {awaiting > 0 && (
              <>
                {" · "}
                <span className="font-medium text-ink">{awaiting.toLocaleString()} awaiting a reply</span>
              </>
            )}
          </span>
          {state.filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft("");
                state.update({ status: null, category: null, priority: null, assignee: null, q: null });
              }}
            >
              <XIcon aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <div className="grid h-[75vh] min-h-[520px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section
          aria-label="Ticket queue"
          className={`min-h-0 min-w-0 flex-col border-border lg:border-r ${state.selectedId ? "hidden lg:flex" : "flex"}`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {queueQuery.isPending ? (
              <div className="flex flex-col gap-xs p-md" aria-busy="true">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : queueQuery.isError && tickets.length === 0 ? (
              <PaneError message={queueQuery.error.message} onRetry={() => void queueQuery.refetch()} />
            ) : tickets.length === 0 ? (
              <div className="flex flex-col items-center gap-sm px-lg py-xxl text-center">
                <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
                <p className="font-display text-title-sm text-ink">No tickets</p>
                <p className="max-w-xs text-body-md text-muted-foreground">
                  {state.filtered ? "Nothing matches these filters." : "No open tickets right now."}
                </p>
              </div>
            ) : (
              <ul className={`divide-y divide-border ${queueQuery.isPlaceholderData ? "opacity-60" : ""}`}>
                {tickets.map((ticket) => (
                  <QueueRow
                    key={ticket.id}
                    ticket={ticket}
                    selected={ticket.id === state.selectedId}
                    myUserId={session?.userId ?? null}
                    onSelect={() => state.update({ ticket: ticket.id }, { resetPage: false })}
                  />
                ))}
              </ul>
            )}
          </div>
          {total > PAGE_SIZE && (
            <nav aria-label="Queue pages" className="flex items-center justify-between gap-sm border-t border-border px-md py-xs">
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {firstShown}–{lastShown} of {total.toLocaleString()}
              </span>
              <span className="flex gap-xxs">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={state.page <= 1}
                  onClick={() => state.update({ page: state.page > 2 ? String(state.page - 1) : null })}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={lastShown >= total}
                  onClick={() => state.update({ page: String(state.page + 1) })}
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
              </span>
            </nav>
          )}
        </section>

        <section
          aria-label="Selected ticket"
          className={`min-h-0 min-w-0 flex-col ${state.selectedId ? "flex" : "hidden lg:flex"}`}
        >
          {state.selectedId ? (
            <StaffTicketDetail
              key={state.selectedId}
              ticketId={state.selectedId}
              myUserId={session?.userId ?? null}
              onBack={() => state.update({ ticket: null }, { resetPage: false })}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-sm p-xl text-center">
              <LifeBuoyIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="text-body-md text-muted-foreground">Select a ticket to read and reply.</p>
            </div>
          )}
        </section>
      </div>
    </AdminPageFrame>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClassName} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function assigneeText(ticket: StaffSupportTicket, myUserId: string | null): string {
  if (!ticket.assignedTo) return "Unassigned";
  if (ticket.assignedTo === myUserId) return "Assigned to you";
  return `Assigned to ${ticket.assigneeName ?? "a teammate"}`;
}

function QueueRow({
  ticket,
  selected,
  myUserId,
  onSelect,
}: {
  ticket: StaffSupportTicket;
  selected: boolean;
  myUserId: string | null;
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
        <span className="truncate text-[12px] text-muted-foreground">
          {ticket.requesterName} · {ROLE_LABELS[ticket.requesterRole] ?? ticket.requesterRole} · {categoryLabel(ticket.category)}
        </span>
        <span className="flex flex-wrap items-center gap-xxs">
          <Badge variant={statusTone(ticket.status, "staff")}>{statusLabel(ticket.status, "staff")}</Badge>
          {(ticket.priority === "HIGH" || ticket.priority === "URGENT") && (
            <Badge variant={priorityTone(ticket.priority)}>{PRIORITY_LABELS[ticket.priority]}</Badge>
          )}
          <span className="text-[12px] text-muted-foreground">{assigneeText(ticket, myUserId)}</span>
          {ticket.unread && <span className="sr-only">Unread message from the requester</span>}
        </span>
      </button>
    </li>
  );
}

type StatusTarget = Exclude<SupportStatus, "NEW" | "ASSIGNED">;

const STATUS_TOASTS: Record<StatusTarget, string> = {
  IN_PROGRESS: "Ticket marked in progress",
  WAITING: "Marked as waiting on the requester",
  RESOLVED: "Ticket resolved",
  CLOSED: "Conversation closed",
};

function StaffTicketDetail({
  ticketId,
  myUserId,
  onBack,
}: {
  ticketId: string;
  myUserId: string | null;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const conversationQuery = useConversation(ticketId);
  const conversation = conversationQuery.data;
  useMarkReadWhenViewed(conversation);
  const { send, pending, sending } = useSendMessage(ticketId);

  const [draft, setDraft] = React.useState("");
  const [nextStatus, setNextStatus] = React.useState<StaffReplyStatus>("WAITING");
  const [dialog, setDialog] = React.useState<"resolve" | "close" | null>(null);
  const [notes, setNotes] = React.useState("");

  const ticket = conversation?.viewer === "STAFF" ? conversation.ticket : null;

  function applyTicket(updated: StaffSupportTicket) {
    queryClient.setQueryData<ConversationDetail>(queryKeys.conversation(ticketId), (old) =>
      old ? ({ ...old, ticket: { ...old.ticket, ...updated } } as ConversationDetail) : old,
    );
    patchTicketInLists(queryClient, updated);
    invalidateSupportSummaries(queryClient);
  }

  function closeDialog() {
    if (statusMutation.isPending) return;
    setDialog(null);
    setNotes("");
  }

  function handleConflict(error: Error) {
    toast.error(error.message);
    void conversationQuery.refetch();
  }

  const assignMutation = useMutation({
    mutationFn: () => assignSupportTicketToSelf(ticketId),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Ticket assigned to you");
    },
    onError: handleConflict,
  });

  const statusMutation = useMutation({
    mutationFn: ({ status, resolutionNotes }: { status: StatusTarget; resolutionNotes?: string }) =>
      updateSupportTicketStatus(ticketId, status, resolutionNotes),
    onSuccess: (updated, { status }) => {
      applyTicket(updated);
      setDialog(null);
      setNotes("");
      toast.success(STATUS_TOASTS[status]);
    },
    onError: handleConflict,
  });

  async function handleSend() {
    const text = draft.trim();
    if (!text || !ticket) return;
    setDraft("");
    try {
      await send(text, ticket.status === "RESOLVED" ? undefined : nextStatus);
    } catch (error) {
      setDraft((current) => current || text);
      toast.error(error instanceof Error ? error.message : "Your reply wasn't sent. Try again.");
    }
  }

  const busy = assignMutation.isPending || statusMutation.isPending;
  const allowed = ticket ? ALLOWED_TICKET_TRANSITIONS[ticket.status] : [];
  const isOpen = ticket ? ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" : false;
  const mine = ticket?.assignedTo !== null && ticket?.assignedTo === myUserId;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex flex-col gap-sm border-b border-border px-md py-sm">
        <div className="flex items-start gap-xs">
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to queue" className="lg:hidden">
            <ArrowLeftIcon aria-hidden />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-xxs pt-1">
            <h2 className="text-title-sm font-medium [overflow-wrap:anywhere] text-ink">{ticket?.subject ?? "Ticket"}</h2>
            {ticket && (
              <>
                <span className="flex flex-wrap items-center gap-xxs">
                  <Badge variant={statusTone(ticket.status, "staff")}>{statusLabel(ticket.status, "staff")}</Badge>
                  <Badge variant={priorityTone(ticket.priority)}>{PRIORITY_LABELS[ticket.priority]} priority</Badge>
                  <Badge variant="outline">{categoryLabel(ticket.category)}</Badge>
                </span>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-sm gap-y-0.5 pt-xxs text-[13px]">
                  <dt className="text-muted-foreground">Requester</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere] text-ink">
                    {ticket.requesterName} ({ROLE_LABELS[ticket.requesterRole] ?? ticket.requesterRole}) ·{" "}
                    <a href={`mailto:${ticket.requesterEmail}`} className="text-link underline-offset-4 hover:underline">
                      {ticket.requesterEmail}
                    </a>
                  </dd>
                  {ticket.relatedMunName && (
                    <>
                      <dt className="text-muted-foreground">Conference</dt>
                      <dd className="min-w-0 truncate text-ink">{ticket.relatedMunName}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd className="text-ink">{assigneeText(ticket, myUserId)}</dd>
                  <dt className="text-muted-foreground">Opened</dt>
                  <dd className="text-ink">
                    <time dateTime={ticket.createdAt}>{formatDateTime(ticket.createdAt)}</time>
                  </dd>
                  <dt className="text-muted-foreground">Ticket</dt>
                  <dd className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">{ticket.id}</dd>
                </dl>
              </>
            )}
          </div>
        </div>

        {ticket && (
          <div className="flex flex-wrap items-center gap-xs" role="group" aria-label="Ticket actions">
            {isOpen && !mine && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => assignMutation.mutate()}>
                {assignMutation.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <UserPlusIcon aria-hidden />}
                {ticket.assignedTo ? "Take over" : "Assign to me"}
              </Button>
            )}
            {ticket.status !== "RESOLVED" && allowed.includes("IN_PROGRESS") && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => statusMutation.mutate({ status: "IN_PROGRESS" })}>
                Mark in progress
              </Button>
            )}
            {allowed.includes("WAITING") && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => statusMutation.mutate({ status: "WAITING" })}>
                Waiting on requester
              </Button>
            )}
            {allowed.includes("RESOLVED") && (
              <Button size="sm" disabled={busy} onClick={() => setDialog("resolve")}>
                <CheckIcon aria-hidden />
                Resolve
              </Button>
            )}
            {ticket.status === "RESOLVED" && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => statusMutation.mutate({ status: "IN_PROGRESS" })}>
                  <RotateCcwIcon aria-hidden />
                  Reopen
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog("close")}>
                  <LockIcon aria-hidden />
                  Close conversation
                </Button>
              </>
            )}
            {ticket.status === "NEW" && (
              <span className="text-[12px] text-muted-foreground">Assign it (or reply) to start working on it.</span>
            )}
          </div>
        )}
      </div>

      {conversationQuery.isPending ? (
        <div className="flex flex-1 flex-col gap-sm p-md" aria-busy="true">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="ml-auto h-12 w-1/2" />
        </div>
      ) : !conversation || !ticket ? (
        <PaneError
          message={conversationQuery.error?.message ?? "Couldn't load this ticket."}
          onRetry={() => void conversationQuery.refetch()}
        />
      ) : (
        <>
          {(ticket.status === "RESOLVED" || ticket.status === "CLOSED") && ticket.resolutionNotes && (
            <div className="flex gap-xs border-b border-border bg-success/10 px-md py-xs text-body-md text-ink">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                <span className="font-medium">Resolution: </span>
                {ticket.resolutionNotes}
              </p>
            </div>
          )}
          {conversationQuery.isError && (
            <p role="status" className="flex items-center gap-xs border-b border-border bg-warning/10 px-md py-xs text-[12px] text-warning-text">
              <AlertCircleIcon className="size-3.5" aria-hidden />
              Reconnecting… new messages may be delayed.
            </p>
          )}
          <MessageThread
            conversationKey={ticket.id}
            messages={conversation.messages}
            pending={pending}
            viewer="STAFF"
            requesterName={ticket.requesterName}
            viewerUserId={myUserId}
            fallback={{ body: ticket.description, createdAt: ticket.createdAt }}
          />
          <div className="border-t border-border p-md">
            {ticket.status === "CLOSED" ? (
              <p className="flex items-center gap-xs text-body-md text-muted-foreground">
                <LockIcon className="size-4" aria-hidden />
                This conversation is closed.
              </p>
            ) : (
              <MessageComposer
                id={`staff-reply-${ticket.id}`}
                label="Reply to this conversation…"
                placeholder="Reply to this conversation…"
                value={draft}
                onChange={setDraft}
                onSubmit={() => void handleSend()}
                sending={sending}
                submitStyle="text"
                rows={3}
                extra={
                  ticket.status === "RESOLVED" ? (
                    <span className="text-[12px] text-muted-foreground">Stays resolved</span>
                  ) : (
                    <>
                      <label htmlFor={`staff-next-${ticket.id}`} className="sr-only">
                        After sending
                      </label>
                      <select
                        id={`staff-next-${ticket.id}`}
                        value={nextStatus}
                        onChange={(event) => setNextStatus(event.target.value as StaffReplyStatus)}
                        className="h-9 rounded-sm border border-input bg-background px-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-card"
                      >
                        <option value="WAITING">Then wait on requester</option>
                        <option value="IN_PROGRESS">Then keep in progress</option>
                      </select>
                    </>
                  )
                }
              />
            )}
          </div>
        </>
      )}

      <Dialog open={dialog === "resolve"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve this ticket?</DialogTitle>
            <DialogDescription>
              The requester sees this note in their conversation. It is also recorded in the admin action log. If
              they reply, the ticket reopens.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-md"
            onSubmit={(event) => {
              event.preventDefault();
              if (notes.trim()) statusMutation.mutate({ status: "RESOLVED", resolutionNotes: notes.trim() });
            }}
          >
            <div className="flex flex-col gap-xs">
              <Label htmlFor="resolution-notes">Resolution notes</Label>
              <textarea
                id="resolution-notes"
                rows={4}
                value={notes}
                maxLength={SUPPORT_LIMITS.resolutionNotes}
                onChange={(event) => setNotes(event.target.value)}
                readOnly={statusMutation.isPending}
                className={`${composerFieldClassName} resize-y`}
                placeholder="What was done to resolve this? Required."
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" disabled={statusMutation.isPending} onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={statusMutation.isPending || !notes.trim()}>
                {statusMutation.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
                {statusMutation.isPending ? "Saving…" : "Confirm resolve"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "close"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Close this conversation?</DialogTitle>
            <DialogDescription>
              A closed conversation takes no more messages and can&apos;t be reopened. If the requester needs more help,
              they start a new conversation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={statusMutation.isPending} onClick={closeDialog}>
              Cancel
            </Button>
            <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ status: "CLOSED" })}>
              {statusMutation.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <LockIcon aria-hidden />}
              Close conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaneError({ message, onRetry }: { message: string; onRetry: () => void }) {
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
