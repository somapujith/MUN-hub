import type { MunStatus } from "@/types/enums";

export type { MunStatus };

export type StatusTone = "muted" | "info" | "warning" | "destructive" | "success" | "secondary";

// Second channel beyond color — tone groups 5 states each into 3 buckets (info/success/secondary),
// so a dot/icon per status is needed for at-a-glance scanning in dense views like the admin queue.
export type StatusIcon =
  | "pencil"
  | "archive"
  | "upload"
  | "eye"
  | "file-check"
  | "shield-check"
  | "shield"
  | "rocket"
  | "alert-triangle"
  | "x-circle"
  | "check"
  | "globe"
  | "ticket"
  | "lock"
  | "radio"
  | "flag"
  | "hourglass"
  | "clipboard-check"
  | "ban";

interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon: StatusIcon;
}

const STATUS_META: Record<MunStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "muted", icon: "pencil" },
  ARCHIVED: { label: "Archived", tone: "muted", icon: "archive" },

  SUBMITTED: { label: "Submitted", tone: "info", icon: "upload" },
  UNDER_REVIEW: { label: "Under review", tone: "info", icon: "eye" },
  CONTENT_SUBMITTED: { label: "Content submitted", tone: "info", icon: "file-check" },
  ORGANIZER_CONFIRMATION: { label: "Awaiting organizer confirmation", tone: "info", icon: "clipboard-check" },
  VERIFICATION: { label: "In verification", tone: "info", icon: "shield-check" },
  ONBOARDING: { label: "Onboarding", tone: "info", icon: "rocket" },

  // Placeholder entries (mechanical, added only to keep this
  // Record<MunStatus, ...> exhaustive after Task 1 of the onboarding/go-live
  // pipeline plan added 6 new MunStatus values) — need real UI/copy review
  // from whoever owns UI next, not a design pass from backend. See
  // docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
  // Section 1.5 for what these states mean.
  ACTION_REQUIRED: { label: "Action required", tone: "warning", icon: "alert-triangle" },
  READY_FOR_SUBMISSION: { label: "Ready for submission", tone: "info", icon: "check" },
  AUTOMATED_VALIDATION: { label: "Automated validation", tone: "info", icon: "hourglass" },
  GO_LIVE_QUEUE: { label: "Go-live queue", tone: "info", icon: "rocket" },
  PUBLISHING: { label: "Publishing", tone: "info", icon: "upload" },
  UNPUBLISHED: { label: "Unpublished", tone: "muted", icon: "archive" },

  CHANGES_REQUESTED: { label: "Changes requested", tone: "warning", icon: "alert-triangle" },

  REJECTED: { label: "Rejected", tone: "destructive", icon: "x-circle" },
  CANCELLED: { label: "Cancelled", tone: "destructive", icon: "ban" },
  // Placeholder entry (mechanical, added only to keep this Record<MunStatus, ...>
  // exhaustive after Task 4 added SUSPENDED) — needs real UI/copy review from
  // whoever owns UI next, not a design pass from backend.
  SUSPENDED: { label: "Suspended", tone: "destructive", icon: "ban" },

  APPROVED: { label: "Approved", tone: "success", icon: "check" },
  VERIFIED: { label: "Verified", tone: "success", icon: "shield" },
  // Label is "Live" per spec Section 1.3 — PUBLISHED is the enum value that
  // stays; LIVE is a display label only, never a separate MunStatus value.
  PUBLISHED: { label: "Live", tone: "success", icon: "globe" },
  REGISTRATION_OPEN: { label: "Registration open", tone: "success", icon: "ticket" },

  REGISTRATION_CLOSED: { label: "Registration closed", tone: "secondary", icon: "lock" },
  CONFERENCE_ACTIVE: { label: "Conference active", tone: "secondary", icon: "radio" },
  RESULTS_PENDING: { label: "Results pending", tone: "secondary", icon: "hourglass" },
  RESULTS_UNDER_REVIEW: { label: "Results under review", tone: "info", icon: "eye" },
  COMPLETED: { label: "Completed", tone: "secondary", icon: "flag" },
};

export function getStatusMeta(status: MunStatus): StatusMeta {
  return STATUS_META[status];
}

const TONE_CLASSNAMES: Record<StatusTone, string> = {
  muted: "bg-muted text-muted-foreground border-transparent",
  info: "bg-info/15 text-info-text border-info/30",
  warning: "bg-warning/15 text-warning-text border-warning/30",
  destructive: "bg-destructive/15 text-destructive-text border-destructive/30",
  success: "bg-success/15 text-success-text border-success/30",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
};

export function getStatusClassName(tone: StatusTone): string {
  return TONE_CLASSNAMES[tone];
}
