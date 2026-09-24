import type {
  ModuleVerificationState,
  MunModule,
  MunStatus,
  RegistrationStatus,
  VerificationSeverity,
} from "@/types/enums";
import type { GoLiveQueueRow, SlaState, SubmissionStatus } from "@/types/go-live";
import type { MaskedPaymentSettings, PaymentVerificationState } from "@/types/payment-settlement";
import type { ApplicationStatus } from "@/types/admin-review";
import type { Committee, Portfolio } from "@/types/committee";
import type { RegistrationProduct } from "@/types/registration-product";
import type { ExecutiveBoardMember } from "@/types/executive-board";
import type { FormField } from "@/types/registration-form";
import type { MunDocument } from "@/types/mun-documents";
import type { ScheduleItem } from "@/types/mun-schedule";
import type { MunContact } from "@/types/mun-contact";
import type { AccommodationOption, AccommodationOptionField } from "@/types/accommodation";
import type { MunMediaItem } from "@/types/mun-branding";

/**
 * Conferences console — mirrors lib/actions/admin-muns.ts. Dates arrive as
 * ISO strings over JSON.
 */

export interface AdminMunListParams {
  q?: string;
  status?: MunStatus;
  /** Exact match — the drill-down from the Organizers console's per-organizer MUN count/link. */
  organizerId?: string;
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

// -----------------------------------------------------------------------------
// GET /admin/muns/:munId/content — the actual submitted field content behind
// AdminMunDetail's status-only `modules` array. Mirrors
// lib/lifecycle/validation.ts's `MunValidationContext` (as returned verbatim
// by lib/actions/admin-review.ts#getAdminMunModuleContent) field for field.
// Dates arrive as ISO strings over JSON, same convention as the rest of this
// file. Reuses this codebase's existing per-module organizer-facing types
// (Committee, Portfolio, RegistrationProduct, etc.) wherever their shape is
// an exact match for the corresponding DB row; where `loadValidationContext`
// selects a wider or narrower column set than an existing type, a dedicated
// type is defined below instead of silently mismatching the wire shape.
// -----------------------------------------------------------------------------

/**
 * Full `muns` row as loaded by `loadValidationContext` — every column,
 * unlike `AdminMunDetail.mun` above (a trimmed projection) and
 * `MunSetupDetails` (web/src/types/mun-config.ts, which omits
 * `conferenceType`/`targetParticipantType`).
 */
export interface AdminMunValidationRow {
  id: string;
  organizerId: string;
  name: string;
  slug: string;
  edition: string | null;
  theme: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  conferenceType: string | null;
  targetParticipantType: string | null;
  addressLine1: string | null;
  addressState: string | null;
  postalCode: string | null;
  mapUrl: string | null;
  registrationOpensAt: string | null;
  registrationDeadline: string | null;
  /** PROVIDED | NOT_PROVIDED | null (organizer hasn't answered). */
  accommodationProvided: string | null;
  status: MunStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full `organizer_applications` row, as loaded by `loadValidationContext`. */
export interface AdminMunValidationApplication {
  id: string;
  organizerId: string;
  munId: string | null;
  status: ApplicationStatus;
  reviewNotes: string | null;
  expectedDelegateCount: number | null;
  previousEditions: string | null;
  websiteUrl: string | null;
  submittedAt: string;
}

/**
 * Full `mun_module_verifications` row, both axes, every column — distinct
 * from `AdminMunModuleRow` above (registry-merged, one row per tracked
 * module key even when no DB row exists yet) and from
 * `web/src/types/module-verification.ts`'s narrower `ModuleVerificationRow`
 * (`reviewModule`'s return value).
 */
export interface AdminMunValidationModuleRow {
  id: string;
  munId: string;
  moduleName: MunModule;
  state: ModuleVerificationState;
  organizerConfirmedAt: string | null;
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  completionStatus: ModuleCompletionStatus;
  isRequired: boolean;
  completionPercentage: number;
  blockingIssueCount: number;
  lastComputedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full `verification_issues` row — `loadValidationContext` loads only unresolved rows (`resolved: false`). */
export interface AdminMunValidationIssue {
  id: string;
  munId: string;
  moduleName: MunModule;
  severity: VerificationSeverity;
  reason: string;
  previousValue: string | null;
  newValue: string | null;
  resolved: boolean;
  raisedBy: string;
  /** Machine-readable identifiers on AUTOMATED-source rows; null on REVIEWER-raised ones. */
  code: string | null;
  fieldKey: string | null;
  /** "REVIEWER" | "AUTOMATED". */
  source: string;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * `mun_payment_settings`, ciphertext columns excluded — the exact column
 * list `loadValidationContext` selects, a superset of
 * `web/src/types/payment-settlement.ts`'s `MaskedPaymentSettings` (that one
 * is `getPaymentSettings`'s narrower projection; this also carries
 * `refundPolicy`, `verifiedBy`, `createdAt`, `updatedAt`).
 */
export interface AdminMunValidationPaymentSettings extends MaskedPaymentSettings {
  refundPolicy: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full `mun_media` row, including `storageKey` — `web/src/types/mun-branding.ts`'s
 * `MunMediaItem` (the organizer-facing media list) deliberately omits it;
 * `loadValidationContext` does a plain `select()` so it travels here too.
 * Harmless to staff (an internal object key, not a secret).
 */
export interface AdminMunValidationMedia extends MunMediaItem {
  storageKey: string;
}

/** Mirrors lib/lifecycle/validation.ts's `MunValidationContext` field for field. */
export interface AdminMunValidationContext {
  now: string;
  stage: "SUBMIT" | "PUBLISH";
  mun: AdminMunValidationRow;
  organizerApplication: AdminMunValidationApplication | null;
  committees: Committee[];
  portfolios: Portfolio[];
  registrationProducts: RegistrationProduct[];
  ebMembers: ExecutiveBoardMember[];
  formFields: FormField[];
  paymentSettings: AdminMunValidationPaymentSettings | null;
  /** Whether the organizer has completed the account-level UPI payout step. */
  organizerPaymentLinked: boolean;
  documents: MunDocument[];
  scheduleItems: ScheduleItem[];
  contact: MunContact | null;
  media: AdminMunValidationMedia[];
  accommodationOptions: AccommodationOption[];
  accommodationOptionFields: AccommodationOptionField[];
  moduleRows: AdminMunValidationModuleRow[];
  unresolvedIssues: AdminMunValidationIssue[];
}

/**
 * `GET /admin/muns/:munId/content`
 * (lib/actions/admin-review.ts#getAdminMunModuleContent) — everything the
 * organizer submitted across all 15 tracked modules, in one call. Staff only
 * (OPERATIONS/ADMIN/SUPER_ADMIN).
 */
export interface AdminMunModuleContent {
  munId: string;
  munName: string;
  context: AdminMunValidationContext;
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

/**
 * `POST /muns/:munId/lifecycle/:action`. The client and its types live in
 * @/api/mun-lifecycle (shared with the organizer settings page); these are
 * aliases so there is only one definition to keep in step with the server.
 */
export type {
  LifecycleAction as MunLifecycleAction,
  LifecycleActionResult as MunLifecycleResult,
} from "@/api/mun-lifecycle";
