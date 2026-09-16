import type {
  AdminTicketListItem,
  ConversationDetail,
  CreateSupportTicketInput,
  ListAdminTicketsParams,
  StartConversationInput,
  SupportMessage,
  SupportStatus,
  SupportTicket,
} from "@/types/support";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function createSupportTicket(input: CreateSupportTicketInput) {
  return request<SupportTicket>("/support/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Wraps lib/actions/support.ts#listTicketsWithRequester — OPERATIONS/ADMIN/SUPER_ADMIN only. */
export function listAdminSupportTickets(params: ListAdminTicketsParams = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  const qs = query.toString();
  return request<AdminTicketListItem[]>(`/admin/support/tickets${qs ? `?${qs}` : ""}`);
}

/** Wraps lib/actions/support.ts#assignTicket — always self-assigns the calling admin, never a client-supplied assignee. */
export function assignSupportTicketToSelf(ticketId: string) {
  return request<SupportTicket>(`/admin/support/tickets/${ticketId}/assign`, {
    method: "POST",
  });
}

/** Wraps lib/actions/support.ts#updateTicketStatus — server re-validates the transition against ALLOWED_TICKET_TRANSITIONS regardless of what the UI allowed. */
export function updateSupportTicketStatus(ticketId: string, status: SupportStatus, resolutionNotes?: string) {
  return request<SupportTicket>(`/admin/support/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, resolutionNotes }),
  });
}

// ---------------------------------------------------------------------------
// Chat thread (support widget) — same lib/actions/support.ts chat surface
// the Next.js app's app/support/chat-actions.ts wraps, exposed here as REST
// by server/routes/support.ts. Owner-or-admin authorization is enforced
// server-side, so these same functions serve the student/organizer widget
// AND the admin reply UI.
// ---------------------------------------------------------------------------

/** The caller's own conversations, newest activity first. */
export function listMyConversations() {
  return request<SupportTicket[]>("/support/conversations");
}

/** Quick-start entry point — creates the ticket (category defaults GENERAL) and its opening message in one call. */
export function startConversation(input: StartConversationInput) {
  return request<{ ticket: SupportTicket; message: SupportMessage }>("/support/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Full thread for one conversation — the requester or any admin-role user. */
export function getConversation(ticketId: string) {
  return request<ConversationDetail>(`/support/conversations/${ticketId}`);
}

export function sendConversationMessage(ticketId: string, body: string) {
  return request<SupportMessage>(`/support/conversations/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/** Marks a conversation read on the caller's side of it (requester or admin-shared). */
export function markConversationRead(ticketId: string) {
  return request<{ ok: true }>(`/support/conversations/${ticketId}/read`, {
    method: "POST",
  });
}

/** Unread-conversation count for the requester side — the floating widget's badge. */
export function getUnreadConversationCount() {
  return request<{ count: number }>("/support/conversations/unread-count");
}

/** Unread-conversation count for the admin side — OPERATIONS/ADMIN/SUPER_ADMIN only. */
export function getAdminUnreadConversationCount() {
  return request<{ count: number }>("/admin/support/unread-count");
}
