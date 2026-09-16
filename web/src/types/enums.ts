/** Frontend-local enum unions — mirror lib/db/schema-enums without drizzle. */

export type Role =
  | "STUDENT"
  | "ORGANIZER"
  | "OPERATIONS"
  | "ADMIN"
  | "SUPER_ADMIN";

export type MunStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED"
  | "ONBOARDING"
  | "ACTION_REQUIRED"
  | "READY_FOR_SUBMISSION"
  | "AUTOMATED_VALIDATION"
  | "CONTENT_SUBMITTED"
  | "ORGANIZER_CONFIRMATION"
  | "VERIFICATION"
  | "VERIFIED"
  | "GO_LIVE_QUEUE"
  | "PUBLISHING"
  | "PUBLISHED"
  | "UNPUBLISHED"
  | "REGISTRATION_OPEN"
  | "REGISTRATION_CLOSED"
  | "CONFERENCE_ACTIVE"
  | "RESULTS_PENDING"
  | "RESULTS_UNDER_REVIEW"
  | "COMPLETED"
  | "ARCHIVED"
  | "CANCELLED"
  | "SUSPENDED";

export type RegistrationStatus =
  | "PENDING"
  | "PAYMENT_PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "REFUNDED"
  | "ATTENDED"
  | "NO_SHOW";

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "REFUNDED";

/**
 * The 19 `mun_module_verifications.module_name` values (15 PRD Section 38
 * keys + 4 legacy pre-PRD keys retained for old data — see
 * lib/lifecycle/module-registry.ts's header comment). Gate 2 (content
 * review) vocabulary — never conflate with Gate 1 (organizer-application
 * review, plain `MunStatus` values) — see CLAUDE.md's "Gate-1 vs Gate-2
 * vocabulary" section.
 */
export type MunModule =
  | "mun_details"
  | "committees"
  | "portfolios"
  | "registration_products"
  | "BASIC_INFO"
  | "DATES_VENUE"
  | "BRANDING"
  | "COMMITTEES"
  | "PORTFOLIOS"
  | "EXECUTIVE_BOARD"
  | "REGISTRATION_TYPES"
  | "REGISTRATION_FORM"
  | "PRICING_CAPACITY"
  | "PAYMENT_SETTLEMENT"
  | "RULES_DOCUMENTS"
  | "SCHEDULE"
  | "ACCOMMODATION"
  | "CONTACT"
  | "FINAL_REVIEW";

/** Reviewer-facing verification state on one `mun_module_verifications` row — orthogonal to the organizer-facing `completionStatus` axis (not modeled on the frontend yet). */
export type ModuleVerificationState =
  | "NOT_SUBMITTED"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "CHANGES_REQUESTED"
  | "REJECTED";

export type VerificationSeverity = "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";
