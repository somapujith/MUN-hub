import type { MunStatus } from "@/types/enums";

/** One check within a module's automated validation result. */
export interface ValidationCheck {
  key: string;
  label: string;
  passed: boolean;
  severity: "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";
  message?: string;
}

/** One tracked module's progress — element of `MunGoLiveProgress.modules`. */
export interface ModuleProgressSummary {
  key: string;
  label: string;
  isRequired: boolean;
  completionStatus: string;
  completionPercentage: number;
  /** Reviewer-facing axis: NOT_SUBMITTED/PENDING_REVIEW/VERIFIED/CHANGES_REQUESTED/REJECTED. */
  verificationState: string;
  blockingIssueCount: number;
  checks: ValidationCheck[];
}

/**
 * Shape returned by `GET /muns/:munId/progress`
 * (lib/actions/go-live-dashboard.ts#getMunProgress).
 */
export interface MunGoLiveProgress {
  munId: string;
  lifecycleStatus: MunStatus;
  /** PRD Gate-2 display label for `lifecycleStatus` (see PRD_STATE_ALIASES). */
  lifecycleStatusLabel: string;
  overallPercentage: number;
  requiredTotal: number;
  requiredComplete: number;
  blockingIssueCount: number;
  modules: ModuleProgressSummary[];
  submission: null;
}

/**
 * Shape returned by `GET /muns/:munId/review-feedback`
 * (lib/actions/go-live-dashboard.ts#getMunReviewFeedback). Everything MUN Hub
 * reviewers told the organizer, across Gate 1 and Gate 2. Never internal notes.
 */
export interface MunReviewFeedback {
  application: {
    status: "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
    reviewNotes: string | null;
    submittedAt: string;
  } | null;
  submission: {
    status: SubmissionStatus;
    versionNumber: number;
    submittedAt: string | null;
    decidedAt: string | null;
  } | null;
  reviewerNotes: { id: string; status: string; notes: string; createdAt: string }[];
  issues: {
    id: string;
    moduleName: string;
    moduleLabel: string;
    severity: ValidationCheck["severity"];
    reason: string;
    resolved: boolean;
    createdAt: string;
  }[];
}

type Row = Record<string, unknown>;

/**
 * Shape returned by `GET /muns/:munId/confirmation-preview`
 * (lib/actions/go-live-dashboard.ts#getConfirmationPreview): the Gate-3
 * snapshot plus the attestation text the organizer agrees to. Only the fields
 * the summary reads are typed; payment ciphertext is never included.
 */
export interface ConfirmationPreview {
  attestation: string;
  snapshot: {
    mun: {
      name: string;
      edition: string | null;
      startDate: string | null;
      endDate: string | null;
      venue: string | null;
      city: string | null;
      country: string | null;
      registrationOpensAt: string | null;
      registrationDeadline: string | null;
      accommodationProvided: "PROVIDED" | "NOT_PROVIDED" | null;
    } | null;
    committees: Row[];
    portfolios: Row[];
    registrationProducts: { id: string; name: string; price: number; capacity: number }[];
    media: { kind: string }[];
    executiveBoard: Row[];
    formFields: Row[];
    paymentSettings: { accountHolderName: string | null; bankName: string | null; accountNumberLast4: string | null } | null;
    documents: { kind: string; title: string }[];
    scheduleItems: Row[];
    contact: { officialEmail: string | null; phone: string | null } | null;
    accommodationOptions: Row[];
  };
}

/**
 * Shape returned by `POST /muns/:munId/actions/submit-for-review`
 * (lib/lifecycle/go-live.ts#submitMunForReview). HTTP 200 either way — a
 * failed automated validation run is a normal result, not a thrown error.
 */
export interface SubmitMunForReviewResult {
  passed: boolean;
  blockers: ValidationCheck[];
  submissionId?: string;
}

// -----------------------------------------------------------------------------
// Admin go-live queue (Gate 2 publish queue) — GET /admin/go-live-queue and
// the publish/enqueue actions. Distinct from the organizer-facing progress
// types above. See lib/lifecycle/go-live.ts's getGoLiveQueue/publishFromQueue/
// enqueueForGoLive and lib/lifecycle/sla.ts's SlaState.
// -----------------------------------------------------------------------------

/** Mirrors lib/lifecycle/sla.ts's SlaState exactly — never the display-guess values a mock version of this page once used. */
export type SlaState = "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "PAUSED" | "COMPLETED";

/** Mirrors lib/db/schema-enums.ts's submissionStatusEnum. */
export type SubmissionStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "QUEUED"
  | "PUBLISHED"
  | "WITHDRAWN";

export interface GoLiveQueueRow {
  munId: string;
  munName: string;
  munStatus: MunStatus;
  submissionId: string;
  submissionStatus: SubmissionStatus;
  submittedAt: string | null;
  slaDeadline: string;
  slaState: SlaState;
  queuedAt: string | null;
}

export interface GoLiveQueueParams {
  limit?: number;
  offset?: number;
}

/** Shape returned by `GET /admin/go-live-queue` (lib/lifecycle/go-live.ts#getGoLiveQueue). */
export interface GoLiveQueueResult {
  results: GoLiveQueueRow[];
  total: number;
}

/** Trimmed `mun_submissions` row — only the fields the admin queue UI reads. */
export interface MunSubmissionRow {
  id: string;
  munId: string;
  status: SubmissionStatus;
  versionNumber: number;
  progressPercentage: number;
  submittedAt: string | null;
  queuedAt: string | null;
  publishedAt: string | null;
  slaDeadline: string;
  slaState: SlaState;
  munVersionId: string | null;
}

/**
 * Shape returned by `POST /muns/:munId/actions/publish`
 * (lib/lifecycle/go-live.ts#publishFromQueue). `replay: true` means this call
 * changed nothing — an earlier call with the same idempotency key (or an
 * already-published mun) already did the work.
 */
export interface PublishFromQueueResult {
  mun: { id: string; name: string; slug: string; status: MunStatus };
  submission: MunSubmissionRow;
  munVersionId: string | null;
  replay: boolean;
}
