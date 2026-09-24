import { pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', [
  'STUDENT',
  'ORGANIZER',
  'OPERATIONS',
  'ADMIN',
  'SUPER_ADMIN',
])

export const munStatusEnum = pgEnum('mun_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'ONBOARDING',
  'ACTION_REQUIRED',
  'READY_FOR_SUBMISSION',
  'AUTOMATED_VALIDATION',
  'CONTENT_SUBMITTED',
  'ORGANIZER_CONFIRMATION',
  'VERIFICATION',
  'VERIFIED',
  'GO_LIVE_QUEUE',
  'PUBLISHING',
  'PUBLISHED',
  'UNPUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CONFERENCE_ACTIVE',
  'RESULTS_PENDING',
  'RESULTS_UNDER_REVIEW',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
  'SUSPENDED',
])

export const registrationStatusEnum = pgEnum('registration_status', [
  'PENDING',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'CANCELLED',
  'REFUNDED',
  'ATTENDED',
  'NO_SHOW',
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'CREATED',
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
])

export const applicationStatusEnum = pgEnum('application_status', [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
])

export const munModuleEnum = pgEnum('mun_module', [
  // legacy (retained, remapped to PRD keys via data migration — see drizzle/0010)
  'mun_details',
  'committees',
  'portfolios',
  'registration_products',
  // PRD Section 38 module keys (15 tracked modules)
  'BASIC_INFO',
  'DATES_VENUE',
  'BRANDING',
  'COMMITTEES',
  'PORTFOLIOS',
  'EXECUTIVE_BOARD',
  'REGISTRATION_TYPES',
  'REGISTRATION_FORM',
  'PRICING_CAPACITY',
  'PAYMENT_SETTLEMENT',
  'RULES_DOCUMENTS',
  'SCHEDULE',
  'ACCOMMODATION',
  'CONTACT',
  'FINAL_REVIEW',
])

export const moduleVerificationStateEnum = pgEnum('module_verification_state', [
  'NOT_SUBMITTED',
  'PENDING_REVIEW',
  'VERIFIED',
  'CHANGES_REQUESTED',
  'REJECTED',
])

export const moduleCompletionEnum = pgEnum('module_completion_status', [
  'NOT_STARTED',
  'IN_PROGRESS',
  'ACTION_REQUIRED',
  'COMPLETE',
  'LOCKED',
])

export const verificationSeverityEnum = pgEnum('verification_severity', [
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
])

export const accommodationFieldTypeEnum = pgEnum('accommodation_field_type', [
  'TEXT',
  'NUMBER',
  'DATE',
  'DROPDOWN',
  'CHECKBOX',
])

export const adminActionEnum = pgEnum('admin_action', [
  'ORGANIZER_SUSPENDED',
  'ORGANIZER_REINSTATED',
  'MUN_UNPUBLISHED',
  'MUN_SUSPENDED',
  'TICKET_ASSIGNED',
  'TICKET_RESOLVED',
  'USER_SUSPENDED',
  // Onboarding go-live pipeline (Task 7) — admin flips a module's
  // isRequired flag per PRD Section 6 ("optional modules may be configured
  // by MUNHub"). See lib/lifecycle/module-verification.ts's
  // setModuleRequirement.
  'MODULE_REQUIREMENT_CHANGED',
  // Onboarding go-live pipeline (Task 11) — Gate 2 content-review decisions
  // (lib/lifecycle/go-live.ts's reviewSubmission) and the publish action
  // (publishFromQueue). MUN_APPROVED/MUN_REJECTED/MUN_CHANGES_REQUESTED are
  // Gate 2 (mun_submissions content review) — do NOT confuse with Gate 1's
  // reviewMunApplication, which is untouched by this task and keeps using
  // its own transitionMun audit trail via verificationLogs, not
  // admin_actions.
  'MUN_PUBLISHED',
  'MUN_APPROVED',
  'MUN_REJECTED',
  // Gate 2's CHANGES_REQUESTED decision on a mun_submissions row
  // (reviewSubmission) — deliberately distinct from MODULE_REVIEWED below.
  // An earlier draft of this enum reused MODULE_REVIEWED for this case,
  // which was wrong: it collided with MODULE_REVIEWED's own reserved
  // per-module meaning within the very same commit (a mun-level Gate 2
  // decision is not a per-module review). Added post-review to fix that
  // self-contradiction.
  'MUN_CHANGES_REQUESTED',
  // MODULE_REVIEWED: reserved for a future per-module-review admin-actions
  // audit trail distinct from the verification_issues rows reviewModule
  // already writes (module-verification.ts). Genuinely unused by this task
  // — reviewSubmission's mun-level CHANGES_REQUESTED decision uses the
  // dedicated MUN_CHANGES_REQUESTED value above instead, so this value
  // stays reserved for Task 7's future per-module admin_actions row exactly
  // as originally intended, with no semantic collision.
  'MODULE_REVIEWED',
  // Replaces the TICKET_RESOLVED placeholder documented in
  // lib/actions/payment-settlement.ts's setPaymentVerificationState — see
  // that file's updated comment.
  'PAYMENT_DETAILS_CHANGED',
  // Migration 0035. Before these existed, each write below stored the closest
  // existing value (PAYMENT_DETAILS_CHANGED / USER_SUSPENDED /
  // ORGANIZER_REINSTATED) with the precise name in `metadata.event` or
  // `metadata.kind`; rows written before 0035 keep that shape, and the audit
  // feeds still prefer `metadata.event` when present.
  // Admin resolved a payment exception (lib/payments/exceptions.ts).
  'PAYMENT_EXCEPTION_RESOLVED',
  // Staff console writes (lib/actions/admin-staff.ts, lib/actions/staff-mfa.ts).
  'STAFF_CREATED',
  'STAFF_ROLE_CHANGED',
  'STAFF_SUSPENDED',
  'STAFF_REINSTATED',
  'STAFF_SET_PASSWORD_LINK_ISSUED',
  'STAFF_MFA_RESET',
  // Break-glass SUPER_ADMIN creation (scripts/create-admin.ts).
  'SUPER_ADMIN_BOOTSTRAPPED',
  // A staff read that returned delegates' personal data (lib/actions/admin-pii-read.ts).
  'PII_READ',
  // A delegate deleted (anonymized) their own account; the actor is that
  // account (lib/actions/account-deletion.ts).
  'ACCOUNT_DELETED',
  // Gate 2 reviewer self-assignment on a mun_submissions row
  // (lib/lifecycle/go-live.ts's claimSubmission) — mirrors TICKET_ASSIGNED
  // above, but for the go-live queue's submissions rather than support
  // tickets. Written only when the reviewer actually changes (reclaiming a
  // submission you already hold is a no-op, same as assignTicket).
  'SUBMISSION_CLAIMED',
  // Admin Registrations console (lib/actions/admin-review.ts) — per-
  // registration actions distinct from the whole-conference CANCELLED
  // transition (lib/lifecycle/registration-lifecycle.ts, which uses
  // verification_logs, not admin_actions, for its own audit trail).
  'REGISTRATION_CANCELLED',
  'REGISTRATION_FLAGGED_DUPLICATE',
  'REGISTRATION_DUPLICATE_FLAG_CLEARED',
  'REGISTRATION_CONFIRMATION_RESENT',
  // Admin manually triggered a single-payment Cashfree reconcile check
  // (lib/payments/admin-reconcile.ts#reconcilePaymentAsAdmin) — the on-demand
  // counterpart to the 5-minute reconcileCashfreeOrders cron job. Written
  // once per trigger regardless of outcome (still pending, confirmed, failed,
  // exception, ...); the outcome itself lives in `metadata`.
  'PAYMENT_RECONCILE_TRIGGERED',
])

export const supportCategoryEnum = pgEnum('support_category', [
  'REGISTRATION',
  'PAYMENT',
  'REFUND',
  'MUN_INFO',
  'ACCOUNT',
  'CERTIFICATE',
  'ORGANIZER',
  'TECHNICAL',
  'SAFETY_POLICY',
  // Quick-start chats from the floating support widget skip the category
  // picker entirely (matches Intercom/Zendesk-style launchers) — this is
  // their default category rather than forcing a choice up front.
  'GENERAL',
])

export const supportPriorityEnum = pgEnum('support_priority', [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
])

export const supportStatusEnum = pgEnum('support_status', [
  'NEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING',
  'RESOLVED',
  'CLOSED',
])

// ---------------------------------------------------------------------------
// Onboarding go-live pipeline — Task 4 net-new module table enums.
// See docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
// Section 2.3.
// ---------------------------------------------------------------------------

export const munMediaKindEnum = pgEnum('mun_media_kind', [
  'LOGO',
  'COVER',
  'GALLERY',
  'SPONSOR',
  'ORGANIZER_LOGO',
])

export const ebRoleEnum = pgEnum('eb_role', [
  'CHAIR',
  'VICE_CHAIR',
  'DIRECTOR',
  'RAPPORTEUR',
  'CUSTOM',
])

export const formFieldTypeEnum = pgEnum('form_field_type', [
  'SHORT_TEXT',
  'LONG_TEXT',
  'EMAIL',
  'PHONE',
  'NUMBER',
  'DROPDOWN',
  'MULTIPLE_CHOICE',
  'CHECKBOX',
  'DATE',
  'FILE_UPLOAD',
  'INSTITUTION',
  'ACADEMIC_YEAR',
  'MUN_EXPERIENCE',
  'COMMITTEE_PREFERENCE',
  'PORTFOLIO_PREFERENCE',
  'EMERGENCY_CONTACT',
])

export const munDocumentKindEnum = pgEnum('mun_document_kind', [
  'RULES',
  'CODE_OF_CONDUCT',
  'REFUND_POLICY',
  'BROCHURE',
  'HANDBOOK',
  'DELEGATE_GUIDE',
  'POSITION_PAPER',
  'OTHER',
])

export const scheduleItemKindEnum = pgEnum('schedule_item_kind', [
  'OPENING_CEREMONY',
  'COMMITTEE_SESSION',
  'BREAK',
  'LUNCH',
  'CRISIS',
  'CLOSING_CEREMONY',
  'AWARDS',
  'OTHER',
])

export const paymentVerificationEnum = pgEnum('payment_verification_state', [
  'NOT_SUBMITTED',
  'PENDING',
  'VERIFIED',
  'FAILED',
])

// docs/prd/MUNHub_User_Workflow_PRD.md §15 — required consent at signup
// (Terms/Privacy), plus an optional guardian acknowledgement for minors.
export const consentTypeEnum = pgEnum('consent_type', [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'GUARDIAN_ACKNOWLEDGEMENT',
  // Accepted in the last step of organizer onboarding (lib/actions/organizer-onboarding.ts).
  'ORGANIZER_AGREEMENT',
])

// ---------------------------------------------------------------------------
// Onboarding go-live pipeline — Task 10 mun_submissions enums. See
// docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
// Section 5.1 (submissionStatusEnum) and Section 5.2 (slaStateEnum, which
// mirrors lib/lifecycle/sla.ts's `SlaState` union — keep the two in sync).
// ---------------------------------------------------------------------------

export const submissionStatusEnum = pgEnum('submission_status', [
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'QUEUED',
  'PUBLISHED',
  'WITHDRAWN',
])

export const slaStateEnum = pgEnum('sla_state', [
  'ON_TRACK',
  'DUE_SOON',
  'OVERDUE',
  'PAUSED',
  'COMPLETED',
])

// ---------------------------------------------------------------------------
// Group/delegation registration (2026-09-17). See lib/db/schema.ts's
// registrationGroups/registrationGroupInvitations header comments.
// ---------------------------------------------------------------------------

export const registrationGroupInvitationStatusEnum = pgEnum('registration_group_invitation_status', [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'CANCELLED',
])

export type Role = (typeof roleEnum.enumValues)[number]
export type MunStatus = (typeof munStatusEnum.enumValues)[number]
export type RegistrationStatus = (typeof registrationStatusEnum.enumValues)[number]
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]
export type ApplicationStatus = (typeof applicationStatusEnum.enumValues)[number]
export type MunModule = (typeof munModuleEnum.enumValues)[number]
export type ModuleVerificationState = (typeof moduleVerificationStateEnum.enumValues)[number]
export type ModuleCompletionStatus = (typeof moduleCompletionEnum.enumValues)[number]
export type VerificationSeverity = (typeof verificationSeverityEnum.enumValues)[number]
export type AccommodationFieldType = (typeof accommodationFieldTypeEnum.enumValues)[number]
export type AdminAction = (typeof adminActionEnum.enumValues)[number]
export type SupportCategory = (typeof supportCategoryEnum.enumValues)[number]
export type SupportPriority = (typeof supportPriorityEnum.enumValues)[number]
export type SupportStatus = (typeof supportStatusEnum.enumValues)[number]
export type MunMediaKind = (typeof munMediaKindEnum.enumValues)[number]
export type EbRole = (typeof ebRoleEnum.enumValues)[number]
export type FormFieldType = (typeof formFieldTypeEnum.enumValues)[number]
export type MunDocumentKind = (typeof munDocumentKindEnum.enumValues)[number]
export type ScheduleItemKind = (typeof scheduleItemKindEnum.enumValues)[number]
export type PaymentVerificationState = (typeof paymentVerificationEnum.enumValues)[number]
export type SubmissionStatus = (typeof submissionStatusEnum.enumValues)[number]
export type SlaStateEnumValue = (typeof slaStateEnum.enumValues)[number]
export type RegistrationGroupInvitationStatus = (typeof registrationGroupInvitationStatusEnum.enumValues)[number]
