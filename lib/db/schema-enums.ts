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
  'CONTENT_SUBMITTED',
  'VERIFICATION',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CONFERENCE_ACTIVE',
  'COMPLETED',
  'ARCHIVED',
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

export type Role = (typeof roleEnum.enumValues)[number]
export type MunStatus = (typeof munStatusEnum.enumValues)[number]
export type RegistrationStatus = (typeof registrationStatusEnum.enumValues)[number]
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]
export type ApplicationStatus = (typeof applicationStatusEnum.enumValues)[number]
