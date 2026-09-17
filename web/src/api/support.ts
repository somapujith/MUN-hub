import { queryClient } from "@/api/query-client";
import { queryKeys } from "@/api/query-keys";
import type {
  ConversationDetail,
  CreateSupportTicketInput,
  ListStaffTicketsParams,
  SendMessageResult,
  StaffReplyStatus,
  StaffSupportTicket,
  StartConversationInput,
  SupportMessage,
  SupportPage,
  SupportStatus,
  SupportTicket,
} from "@/types/support";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

/**
 * A failed support request. Carries the HTTP status so the shared query
 * client's retry rule (no retries below 500) applies, and so callers can tell
 * a lost session from a validation error.
 */
export class SupportApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SupportApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new SupportApiError("Can't reach MUN Hub right now. Check your connection and try again.", 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    if (response.status === 401) {
      // The session is gone (expired or signed out elsewhere). Re-ask the API
      // who is signed in, so the header, the route guards and the chat widget
      // all switch to signed-out instead of polling into 401s.
      void queryClient.invalidateQueries({ queryKey: queryKeys.session() });
    }
    const message =
      response.status === 401
        ? "Your session has ended. Sign in again to continue."
        : (body?.error?.message ?? `Request failed (${response.status})`);
    throw new SupportApiError(message, response.status, body?.error?.code);
  }
  return response.json() as Promise<T>;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// --- Requester --------------------------------------------------------------

/** Files a ticket from the full form; the description opens the thread. */
export function createSupportTicket(input: CreateSupportTicketInput) {
  return request<SupportTicket>("/support/tickets", { method: "POST", body: JSON.stringify(input) });
}

/** The caller's own conversations, most recent activity first. */
export function listMyConversations(params: { limit?: number; offset?: number } = {}) {
  return request<SupportPage<SupportTicket>>(`/support/conversations${query(params)}`);
}

/** Quick start from the chat composer: creates the ticket and its first message. */
export function startConversation(input: StartConversationInput) {
  return request<{ ticket: SupportTicket; message: SupportMessage }>("/support/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** One conversation and its thread — the requester's or, for staff, any. */
export function getConversation(ticketId: string) {
  return request<ConversationDetail>(`/support/conversations/${encodeURIComponent(ticketId)}`);
}

/** Posts a reply. `nextStatus` is staff-only (default: waiting on the requester). */
export function sendConversationMessage(ticketId: string, body: string, nextStatus?: StaffReplyStatus) {
  return request<SendMessageResult>(`/support/conversations/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST",
    body: JSON.stringify(nextStatus ? { body, nextStatus } : { body }),
  });
}

export function markConversationRead(ticketId: string) {
  return request<{ ok: true }>(`/support/conversations/${encodeURIComponent(ticketId)}/read`, { method: "POST" });
}

/** Conversations with an unread support-team reply — the widget badge. */
export function getUnreadConversationCount() {
  return request<{ count: number }>("/support/conversations/unread-count");
}

// --- Staff ------------------------------------------------------------------

export function listStaffSupportTickets(params: ListStaffTicketsParams = {}) {
  return request<SupportPage<StaffSupportTicket>>(`/admin/support/tickets${query({ ...params })}`);
}

/** Conversations whose latest requester message no staff member has opened. */
export function getAdminUnreadConversationCount() {
  return request<{ count: number }>("/admin/support/unread-count");
}

/** Assigns the ticket to the signed-in staff member (never anyone else). */
export function assignSupportTicketToSelf(ticketId: string) {
  return request<StaffSupportTicket>(`/admin/support/tickets/${encodeURIComponent(ticketId)}/assign`, {
    method: "POST",
  });
}

/** The server re-checks the transition; RESOLVED needs `resolutionNotes`. */
export function updateSupportTicketStatus(
  ticketId: string,
  status: Exclude<SupportStatus, "NEW" | "ASSIGNED">,
  resolutionNotes?: string,
) {
  return request<StaffSupportTicket>(`/admin/support/tickets/${encodeURIComponent(ticketId)}`, {
    method: "PATCH",
    body: JSON.stringify(resolutionNotes === undefined ? { status } : { status, resolutionNotes }),
  });
}
