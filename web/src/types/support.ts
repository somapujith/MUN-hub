import type { Role } from "@/types/enums";

/**
 * Wire types for the support desk (server/routes/support.ts over
 * lib/actions/support.ts). Dates arrive as ISO strings.
 */

/** Every value of the database enum. REFUND only appears on legacy tickets. */
export type SupportCategory =
  | "GENERAL"
  | "REGISTRATION"
  | "PAYMENT"
  | "REFUND"
  | "MUN_INFO"
  | "ACCOUNT"
  | "CERTIFICATE"
  | "ORGANIZER"
  | "TECHNICAL"
  | "SAFETY_POLICY";

/** What a requester may file under — there are no refunds in this product. */
export type RequesterCategory = Exclude<SupportCategory, "REFUND">;

export type SupportPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportStatus = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";

/** What a staff reply leaves the ticket as. */
export type StaffReplyStatus = "WAITING" | "IN_PROGRESS";

/** The requester's view of their own ticket. */
export interface SupportTicket {
  id: string;
  createdBy: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  subject: string;
  description: string;
  relatedMunId: string | null;
  relatedRegistrationId: string | null;
  resolutionNotes: string | null;
  lastMessageAt: string | null;
  lastActivityAt: string;
  lastMessageFromStaff: boolean;
  /** Has a message the viewer hasn't opened yet. */
  unread: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The staff view: the requester view plus ownership and requester details. */
export interface StaffSupportTicket extends SupportTicket {
  assignedTo: string | null;
  assigneeName: string | null;
  requesterName: string;
  requesterEmail: string;
  requesterRole: Role;
  relatedMunName: string | null;
  requesterReadAt: string | null;
  adminReadAt: string | null;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  author: "REQUESTER" | "STAFF";
  /** Null for staff messages shown to the requester. */
  senderId: string | null;
  /** Sender's name — staff viewers only. */
  senderName: string | null;
  senderRole: Role;
  body: string;
  createdAt: string;
}

export type ConversationDetail =
  | { viewer: "REQUESTER"; ticket: SupportTicket; messages: SupportMessage[] }
  | { viewer: "STAFF"; ticket: StaffSupportTicket; messages: SupportMessage[] };

export interface SupportPage<T> {
  results: T[];
  total: number;
}

export interface CreateSupportTicketInput {
  category: RequesterCategory;
  priority?: SupportPriority;
  subject: string;
  description: string;
  relatedRegistrationId?: string;
  relatedMunId?: string;
}

export interface StartConversationInput {
  body: string;
  category?: RequesterCategory;
  relatedMunId?: string;
}

export interface SendMessageResult {
  message: SupportMessage;
  ticket: SupportTicket | StaffSupportTicket;
}

export type StaffStatusFilter = SupportStatus | "OPEN";

export interface ListStaffTicketsParams {
  status?: StaffStatusFilter;
  category?: SupportCategory;
  priority?: SupportPriority;
  assignee?: "me" | "unassigned";
  q?: string;
  limit?: number;
  offset?: number;
}

/** Mirrors lib/actions/support.ts#SUPPORT_LIMITS — the server enforces the same bounds. */
export const SUPPORT_LIMITS = {
  subject: 150,
  body: 5000,
  resolutionNotes: 2000,
  search: 100,
} as const;

/**
 * Mirrors ALLOWED_TICKET_TRANSITIONS in lib/actions/support.ts. The server
 * re-checks every change; this only decides which buttons render.
 */
export const ALLOWED_TICKET_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS", "WAITING"],
  IN_PROGRESS: ["WAITING", "RESOLVED"],
  WAITING: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
};
