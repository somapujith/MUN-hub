import type { ExecutiveBoardRole } from "@/types/executive-board";
import type { MunDocumentKind } from "@/types/mun-documents";
import type { ScheduleItemKind } from "@/types/mun-schedule";

/** Display labels for the enum values the public MUN page renders. */

export const EB_ROLE_LABELS: Record<Exclude<ExecutiveBoardRole, "CUSTOM">, string> = {
  CHAIR: "Chair",
  VICE_CHAIR: "Vice-Chair",
  DIRECTOR: "Director",
  RAPPORTEUR: "Rapporteur",
};

export function ebRoleLabel(role: ExecutiveBoardRole, customRole: string | null): string {
  if (role === "CUSTOM") return customRole?.trim() || "Executive Board";
  return EB_ROLE_LABELS[role];
}

export const DOCUMENT_KIND_LABELS: Record<MunDocumentKind, string> = {
  RULES: "Rules of procedure",
  CODE_OF_CONDUCT: "Code of conduct",
  // Registration fees are non-refundable on MUN Hub; the organizer's document
  // of this kind is their fee policy, so it isn't labelled a refund policy.
  REFUND_POLICY: "Fee policy",
  BROCHURE: "Brochure",
  HANDBOOK: "Handbook",
  DELEGATE_GUIDE: "Delegate guide",
  POSITION_PAPER: "Position paper guidelines",
  OTHER: "Document",
};

export const SCHEDULE_KIND_LABELS: Record<ScheduleItemKind, string> = {
  OPENING_CEREMONY: "Opening ceremony",
  COMMITTEE_SESSION: "Committee session",
  BREAK: "Break",
  LUNCH: "Lunch",
  CRISIS: "Crisis",
  CLOSING_CEREMONY: "Closing ceremony",
  AWARDS: "Awards",
  OTHER: "Event",
};

/**
 * Free-text organizer fields that may hold either prose ("Crisis-heavy
 * conference") or an enum-ish token ("HIGH_SCHOOL"). Tokens are humanized;
 * prose is left as typed.
 */
export function humanizeToken(value: string): string {
  if (!/^[A-Z0-9_]+$/.test(value)) return value;
  const words = value.toLowerCase().split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
