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
