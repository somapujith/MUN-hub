import type { MunStatus } from "@/lib/db/schema-enums";

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
  | "rocket"
  | "alert-triangle"
  | "x-circle"
  | "check"
  | "globe"
  | "ticket"
  | "lock"
  | "radio"
  | "flag";

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
  VERIFICATION: { label: "In verification", tone: "info", icon: "shield-check" },
  ONBOARDING: { label: "Onboarding", tone: "info", icon: "rocket" },

  CHANGES_REQUESTED: { label: "Changes requested", tone: "warning", icon: "alert-triangle" },

  REJECTED: { label: "Rejected", tone: "destructive", icon: "x-circle" },

  APPROVED: { label: "Approved", tone: "success", icon: "check" },
  PUBLISHED: { label: "Published", tone: "success", icon: "globe" },
  REGISTRATION_OPEN: { label: "Registration open", tone: "success", icon: "ticket" },

  REGISTRATION_CLOSED: { label: "Registration closed", tone: "secondary", icon: "lock" },
  CONFERENCE_ACTIVE: { label: "Conference active", tone: "secondary", icon: "radio" },
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
