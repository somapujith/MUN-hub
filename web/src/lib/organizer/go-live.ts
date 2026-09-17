import type { MunModule, MunStatus } from "@/types/enums";
import type { MunReviewFeedback } from "@/types/go-live";

/**
 * Mirrors lib/lifecycle/module-completion.ts's UNDER_ACTIVE_REVIEW_STATUSES.
 * While a MUN is in one of these, organizers can't change high-impact
 * sections. UI hint only; the API enforces the lock.
 */
export const UNDER_REVIEW_STATUSES: readonly MunStatus[] = [
  "CONTENT_SUBMITTED",
  "AUTOMATED_VALIDATION",
  "ORGANIZER_CONFIRMATION",
  "VERIFICATION",
];

export function isUnderReview(status: MunStatus): boolean {
  return UNDER_REVIEW_STATUSES.includes(status);
}

/**
 * Sections whose whole page stays editable during review: the modules with an
 * empty HIGH_IMPACT_FIELDS list. BRANDING shares the documents page with
 * RULES_DOCUMENTS, which is locked, so only the registration form qualifies.
 */
export const EDITABLE_DURING_REVIEW_SEGMENTS: readonly string[] = ["form"];

/** Statuses where the next step is the organizer's own Gate-3 confirmation. */
export const AWAITING_CONFIRMATION_STATUSES: readonly MunStatus[] = [
  "CONTENT_SUBMITTED",
  "AUTOMATED_VALIDATION",
  "ORGANIZER_CONFIRMATION",
];

/** Where the organizer fixes each tracked module (a segment from nav-config). */
export const MODULE_SECTION: Partial<Record<MunModule, string>> = {
  BASIC_INFO: "setup",
  DATES_VENUE: "setup",
  BRANDING: "documents",
  COMMITTEES: "committees",
  PORTFOLIOS: "committees",
  EXECUTIVE_BOARD: "executive-board",
  CONTACT: "settings",
  REGISTRATION_TYPES: "products",
  REGISTRATION_FORM: "form",
  PRICING_CAPACITY: "products",
  PAYMENT_SETTLEMENT: "finance",
  RULES_DOCUMENTS: "documents",
  SCHEDULE: "conference-day",
  ACCOMMODATION: "accommodation",
  FINAL_REVIEW: "setup",
};

export const VERIFICATION_STATE_LABEL: Record<string, string> = {
  NOT_SUBMITTED: "Not sent for review",
  PENDING_REVIEW: "Waiting for MUN Hub",
  VERIFIED: "Verified",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Rejected",
};

export const COMPLETION_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  ACTION_REQUIRED: "Needs work",
  COMPLETE: "Complete",
  LOCKED: "Locked for review",
};

/**
 * Staff notes, minus the Gate-1 decision note: the application decision also
 * writes it to the log, and it's already shown with the application.
 */
export function contentReviewNotes(feedback: MunReviewFeedback) {
  const applicationNotes = feedback.application?.reviewNotes?.trim();
  return feedback.reviewerNotes.filter((note) => note.notes.trim() !== applicationNotes);
}

/** True when there's anything a reviewer told the organizer. */
export function hasReviewFeedback(feedback: MunReviewFeedback | undefined): feedback is MunReviewFeedback {
  if (!feedback) return false;
  return Boolean(
    feedback.application?.reviewNotes?.trim() ||
      contentReviewNotes(feedback).length > 0 ||
      feedback.issues.some((issue) => !issue.resolved),
  );
}

/** A module the organizer can send for review from the checklist. */
export function canSendModuleForReview(module: {
  key: string;
  completionStatus: string;
  verificationState: string;
}): boolean {
  if (module.key === "FINAL_REVIEW" || module.completionStatus !== "COMPLETE") return false;
  return module.verificationState === "NOT_SUBMITTED" || module.verificationState === "CHANGES_REQUESTED";
}
