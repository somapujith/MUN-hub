import type { Role, SupportCategory } from "@/types";

export type SupportPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportStatus =
  | "NEW"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING"
  | "RESOLVED"
  | "CLOSED";

export interface CreateSupportTicketInput {
  category: SupportCategory;
  priority?: SupportPriority;
  subject: string;
  description: string;
  relatedRegistrationId?: string;
  relatedMunId?: string;
}

export interface SupportTicket {
  id: string;
  createdBy: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  subject: string;
  description: string;
  assignedTo: string | null;
  relatedRegistrationId: string | null;
  relatedMunId: string | null;
  resolutionNotes: string | null;
  /** Denormalized for conversation-list sorting/unread — see lib/db/schema.ts's support_tickets comment. */
  lastMessageAt: string | null;
  lastMessageSenderId: string | null;
  requesterReadAt: string | null;
  adminReadAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One support_messages row — the chat thread behind a SupportTicket. */
export interface SupportMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: Role;
  body: string;
  createdAt: string;
}

/** POST /support/conversations body — the floating widget's quick-start entry (no category picker). */
export interface StartConversationInput {
  body: string;
  category?: SupportCategory;
}

/** GET /support/conversations/:ticketId response shape. */
export interface ConversationDetail {
  ticket: SupportTicket;
  messages: SupportMessage[];
}

/**
 * Shape returned by `GET /admin/support/tickets`
 * (lib/actions/support.ts#listTicketsWithRequester) — every `SupportTicket`
 * field plus who filed it, for the admin queue.
 */
export interface AdminTicketListItem extends SupportTicket {
  requesterName: string;
  requesterRole: Role;
}

export interface ListAdminTicketsParams {
  status?: SupportStatus;
}

/**
 * Mirrors `ALLOWED_TICKET_TRANSITIONS` in lib/actions/support.ts — kept in
 * sync by hand since the server is the source of truth (it re-validates
 * regardless). Used only to decide which action buttons render.
 */
export const ALLOWED_TICKET_TRANSITIONS: Record<SupportStatus, SupportStatus[]> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS", "WAITING"],
  IN_PROGRESS: ["WAITING", "RESOLVED"],
  WAITING: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};
