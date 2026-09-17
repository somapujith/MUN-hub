import { resolveZoneUrl } from "@/lib/host-routing";
import type {
  RequesterCategory,
  SupportCategory,
  SupportPriority,
  SupportStatus,
} from "@/types/support";

export type BadgeTone = "secondary" | "info" | "warning" | "success" | "destructive" | "outline";

/** Categories offered when filing a ticket, in display order. */
export const REQUESTER_CATEGORY_OPTIONS: { value: RequesterCategory; label: string }[] = [
  { value: "GENERAL", label: "General question" },
  { value: "REGISTRATION", label: "Registration" },
  { value: "PAYMENT", label: "Payment" },
  { value: "MUN_INFO", label: "Conference info" },
  { value: "ACCOUNT", label: "Account" },
  { value: "CERTIFICATE", label: "Certificate" },
  { value: "ORGANIZER", label: "Organizer tools" },
  { value: "TECHNICAL", label: "Technical issue" },
  { value: "SAFETY_POLICY", label: "Safety / policy" },
];

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  ...Object.fromEntries(REQUESTER_CATEGORY_OPTIONS.map((o) => [o.value, o.label])),
  // Legacy tickets only — never offered.
  REFUND: "Refund (legacy)",
} as Record<SupportCategory, string>;

export function categoryLabel(category: SupportCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export const PRIORITY_LABELS: Record<SupportPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export function priorityTone(priority: SupportPriority): BadgeTone {
  if (priority === "URGENT") return "destructive";
  if (priority === "HIGH") return "warning";
  return "secondary";
}

/**
 * Status wording differs by audience only for WAITING: the requester is told
 * the team is waiting on them, staff see who the ticket is waiting on.
 */
export function statusLabel(status: SupportStatus, audience: "requester" | "staff"): string {
  switch (status) {
    case "NEW":
      return audience === "staff" ? "New" : "Received";
    case "ASSIGNED":
      return audience === "staff" ? "Assigned" : "With our team";
    case "IN_PROGRESS":
      return "In progress";
    case "WAITING":
      return audience === "staff" ? "Waiting on requester" : "Waiting on you";
    case "RESOLVED":
      return "Resolved";
    case "CLOSED":
      return "Closed";
  }
}

export function statusTone(status: SupportStatus, audience: "requester" | "staff"): BadgeTone {
  switch (status) {
    case "NEW":
      return audience === "staff" ? "warning" : "info";
    case "ASSIGNED":
    case "IN_PROGRESS":
      return "info";
    case "WAITING":
      return audience === "staff" ? "secondary" : "warning";
    case "RESOLVED":
      return "success";
    case "CLOSED":
      return "outline";
  }
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "just now", "5 min. ago", "yesterday", then a date. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "just now";
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return RELATIVE.format(Math.round(diffSec / 3600), "hour");
  if (abs < 7 * 86_400) return RELATIVE.format(Math.round(diffSec / 86_400), "day");
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The support inbox for a requester role, as a URL that is navigable from the
 * current host: organizers' inbox lives on the organizer host, delegates' on
 * the student host (the same origin in local dev).
 */
export function inboxUrlForRole(role: string, ticketId?: string): string {
  const path = role === "ORGANIZER" ? "/organizer/support" : "/dashboard/support";
  const withTicket = ticketId ? `${path}?ticket=${encodeURIComponent(ticketId)}` : path;
  return resolveZoneUrl(role === "ORGANIZER" ? "organizer" : "student", withTicket);
}
