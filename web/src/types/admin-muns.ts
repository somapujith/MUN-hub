import type {
  ModuleVerificationState,
  MunModule,
  MunStatus,
  RegistrationStatus,
} from "@/types/enums";
import type { GoLiveQueueRow, SlaState, SubmissionStatus } from "@/types/go-live";
import type { PaymentVerificationState } from "@/types/payment-settlement";

/**
 * Conferences console — mirrors lib/actions/admin-muns.ts. Dates arrive as
 * ISO strings over JSON.
 */

export interface AdminMunListParams {
  q?: string;
  status?: MunStatus;
  limit?: number;
  offset?: number;
}

export interface AdminMunListRow {
  id: string;
  name: string;
  slug: string;
  status: MunStatus;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  country: string | null;
  createdAt: string;
  organizerId: string;
  organizerName: string;
  organizerEmail: string;
  /** CONFIRMED + ATTENDED + NO_SHOW. */
  seatedRegistrations: number;
  /** PENDING + PAYMENT_PENDING. */
  pendingRegistrations: number;
}

export interface AdminMunListResult {
  results: AdminMunListRow[];
  total: number;
}

export type ModuleCompletionStatus = "NOT_STARTED" | "IN_PROGRESS" | "ACTION_REQUIRED" | "COMPLETE" | "LOCKED";

export interface AdminMunModuleRow {
  moduleName: MunModule;
  label: string;
  isRequired: boolean;
  state: ModuleVerificationState;
  completionStatus: ModuleCompletionStatus;
  completionPercentage: number;
  blockingIssueCount: number;
  lastReviewedAt: string | null;
  lastReviewedByName: string | null;
}

export interface AdminMunSubmissionSummary {
  id: string;
  status: SubmissionStatus;
  /** False once the submission is PUBLISHED, REJECTED or WITHDRAWN. */
  active: boolean;
  versionNumber: number;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  decidedAt: string | null;
  queuedAt: string | null;
  publishedAt: string | null;
  slaDeadline: string;
  slaState: SlaState;
  reviewerId: string | null;
  reviewerName: string | null;
  rejectionReason: string | null;
}

export interface AdminPaymentSettingsSummary {
  verificationState: PaymentVerificationState;
  verifiedAt: string | null;
  verifiedByName: string | null;
  updatedAt: string;
}

export interface AdminMunHistoryEntry {
  id: string;
  source: "lifecycle" | "admin_action";
  action: string;
  actorId: string;
  actorName: string | null;
  notes: string | null;
  internalNotes: string | null;
  createdAt: string;
}

export interface AdminMunDetail {
  mun: {
    id: string;
    name: string;
    slug: string;
    edition: string | null;
    status: MunStatus;
    city: string | null;
    country: string | null;
    venue: string | null;
    startDate: string | null;
    endDate: string | null;
    registrationOpensAt: string | null;
    registrationDeadline: string | null;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  organizer: { id: string; name: string; email: string; suspended: boolean };
  application: { status: string; submittedAt: string; reviewNotes: string | null } | null;
  registrationCounts: Record<RegistrationStatus, number>;
  modules: AdminMunModuleRow[];
  submission: AdminMunSubmissionSummary | null;
  paymentSettings: AdminPaymentSettingsSummary | null;
  history: AdminMunHistoryEntry[];
}

/** `GET /admin/go-live-queue/details` row — the queue row plus what the page acts on. */
export interface GoLiveQueueDetailRow extends GoLiveQueueRow {
  organizerName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  paymentVerificationState: PaymentVerificationState | null;
}

export interface GoLiveQueueDetailResult {
  results: GoLiveQueueDetailRow[];
  total: number;
}

/** Gate 2 content-review decision on a MUN's active submission. Never Gate 1. */
export type SubmissionReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export interface ReviewSubmissionInput {
  decision: SubmissionReviewDecision;
  notes?: string;
  /** Required by the server for REJECTED. */
  reason?: string;
}

/** Contract of `POST /muns/:munId/lifecycle/:action` (built by the lifecycle lane). */
export type MunLifecycleAction =
  | "open-registration"
  | "close-registration"
  | "start-conference"
  | "complete"
  | "archive"
  | "cancel";

export interface MunLifecycleResult {
  munId: string;
  status: MunStatus;
}
