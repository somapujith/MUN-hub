import type { ModuleCompletionStatus } from "@/types/admin-muns";
import type { ModuleVerificationState } from "@/types/enums";
import type { SlaState, SubmissionStatus } from "@/types/go-live";
import type { PaymentVerificationState } from "@/types/payment-settlement";

export type BadgeTone = "success" | "warning" | "destructive" | "secondary" | "info" | "outline";

interface LabelMeta {
  label: string;
  variant: BadgeTone;
}

export const SLA_META: Record<SlaState, LabelMeta> = {
  ON_TRACK: { label: "On track", variant: "success" },
  DUE_SOON: { label: "Due soon", variant: "warning" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
  PAUSED: { label: "Paused", variant: "secondary" },
  COMPLETED: { label: "Completed", variant: "info" },
};

export const SUBMISSION_STATUS_META: Record<SubmissionStatus, LabelMeta> = {
  SUBMITTED: { label: "Submitted", variant: "info" },
  UNDER_REVIEW: { label: "Under review", variant: "info" },
  CHANGES_REQUESTED: { label: "Changes requested", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  QUEUED: { label: "Queued", variant: "secondary" },
  PUBLISHED: { label: "Published", variant: "success" },
  WITHDRAWN: { label: "Withdrawn", variant: "outline" },
};

/** `null` means the organizer hasn't submitted payout details yet. */
export function paymentVerificationMeta(state: PaymentVerificationState | null): LabelMeta {
  switch (state) {
    case "VERIFIED":
      return { label: "Account verified", variant: "success" };
    case "PENDING":
      return { label: "Verification pending", variant: "warning" };
    case "FAILED":
      return { label: "Verification failed", variant: "destructive" };
    default:
      return { label: "Details not submitted", variant: "outline" };
  }
}

export const MODULE_STATE_META: Record<ModuleVerificationState, LabelMeta> = {
  NOT_SUBMITTED: { label: "Not submitted", variant: "outline" },
  PENDING_REVIEW: { label: "Pending review", variant: "info" },
  VERIFIED: { label: "Verified", variant: "success" },
  CHANGES_REQUESTED: { label: "Changes requested", variant: "warning" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

export const MODULE_COMPLETION_META: Record<ModuleCompletionStatus, LabelMeta> = {
  NOT_STARTED: { label: "Not started", variant: "outline" },
  IN_PROGRESS: { label: "In progress", variant: "info" },
  ACTION_REQUIRED: { label: "Action required", variant: "warning" },
  COMPLETE: { label: "Complete", variant: "success" },
  LOCKED: { label: "Locked for review", variant: "secondary" },
};

/** `9 Oct 2026` (or an em dash for a missing/invalid date). */
export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** `9 Oct 2026, 14:05` (or an em dash). */
export function formatAdminDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** `9 – 11 Oct 2026` style range; falls back to whichever end exists. */
export function formatAdminDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (!start || !end) return formatAdminDate(start ?? end);
  const from = formatAdminDate(start);
  const to = formatAdminDate(end);
  return from === to ? from : `${from} – ${to}`;
}
