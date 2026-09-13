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
