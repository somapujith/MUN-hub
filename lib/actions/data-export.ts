import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  accommodationOptions,
  achievements,
  committees,
  muns,
  organizerApplications,
  organizerProfiles,
  payments,
  portfolios,
  registrationProducts,
  registrations,
  studentProfiles,
  supportMessages,
  supportTickets,
  userConsents,
  users,
} from '@/lib/db/schema'
import type {
  ApplicationStatus,
  PaymentStatus,
  RegistrationStatus,
  Role,
  SupportCategory,
  SupportStatus,
} from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'

type ConsentType = (typeof userConsents.$inferSelect)['consentType']

/**
 * "Download my data" — everything MUN Hub holds about the signed-in user, as
 * one JSON document (docs/prd/MUNHub_User_Workflow_PRD.md privacy
 * requirements; audit finding "no deletion/export").
 *
 * Covers every table that holds the person's own data: account, student
 * profile, consents, registrations, payments, awards, support tickets, and —
 * for organizers, who see the same download button — their organizer profile
 * and the applications they submitted.
 *
 * Scope rules:
 * - Only rows that belong to the caller (`session.userId`), never a
 *   client-supplied id.
 * - Selects list their columns explicitly, so a column added to a table later
 *   never leaks into the export by accident. The one exception is
 *   student_profiles, whose every column is the delegate's own data.
 * - Other people's identities are left out: support replies say which role
 *   answered, not which staff member; payment-exception resolver ids and
 *   internal resolution notes are omitted; the organizer's net payout share
 *   is the organizer's business data, not the delegate's.
 * - Password hashes, session tokens and reset tokens are never exported.
 */

export const DATA_EXPORT_FORMAT = 'munhub-account-export'
export const DATA_EXPORT_VERSION = 1

export interface DataExportAccount {
  id: string
  name: string
  email: string
  phone: string | null
  username: string | null
  institution: string | null
  profileImage: string | null
  role: Role
  emailNotificationsEnabled: boolean
  createdAt: Date
}

export type DataExportStudentProfile = Omit<typeof studentProfiles.$inferSelect, 'id' | 'userId'>

export interface DataExportConsent {
  consentType: ConsentType
  policyVersion: string
  acceptedAt: Date
}

export interface DataExportRegistration {
  id: string
  mun: {
    name: string
    slug: string
    startDate: Date | null
    endDate: Date | null
    city: string | null
  }
  /** The registration product ("pass") the delegate bought. */
  pass: {
    name: string
    price: number
    currency: string
  }
  committee: string | null
  portfolio: string | null
  accommodation: { name: string; answers: unknown } | null
  /** Answers to the MUN's registration form, keyed by field key. */
  formResponses: unknown
  status: RegistrationStatus
  createdAt: Date
  updatedAt: Date
}

export interface DataExportPayment {
  id: string
  registrationId: string
  munName: string
  amount: number
  currency: string
  platformFeeAmount: number | null
  platformFeeTaxAmount: number | null
  status: PaymentStatus
  provider: string
  providerOrderId: string
  providerPaymentId: string | null
  exception: { reason: string; raisedAt: Date | null; resolvedAt: Date | null } | null
  createdAt: Date
  updatedAt: Date
}

export interface DataExportSupportMessage {
  /** True when the account holder wrote the message; false for a MUN Hub reply. */
  fromYou: boolean
  senderRole: Role
  body: string
  createdAt: Date
}

export interface DataExportSupportTicket {
  id: string
  category: SupportCategory
  status: SupportStatus
  subject: string
  description: string
  relatedRegistrationId: string | null
  relatedMunId: string | null
  resolutionNotes: string | null
  createdAt: Date
  updatedAt: Date
  messages: DataExportSupportMessage[]
}

/** An award recorded against the account by an organizer (lib/actions/results.ts). */
export interface DataExportAchievement {
  munName: string
  committee: string | null
  portfolio: string | null
  award: string | null
  createdAt: Date
}

/**
 * The organizer's own onboarding answers. Organizers see the same "Download
 * my data" button as delegates, so their profile has to be in here too.
 * `firstMunId` is left out: an internal row id, not the person's data.
 */
export interface DataExportOrganizerProfile {
  firstName: string | null
  lastName: string | null
  contactPhone: string | null
  munName: string | null
  munCity: string | null
  munStartDate: Date | null
  expectedDelegateCount: number | null
  munDescription: string | null
  previousEditions: string | null
  websiteUrl: string | null
  accountHolderName: string | null
  bankName: string | null
  /** Last 4 digits only — the full account number is write-only, never exported. */
  bankAccountLast4: string | null
  ifscCode: string | null
  upiId: string | null
  upiPhone: string | null
  agreementVersion: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * An application this organizer submitted to host a MUN. `reviewNotes` is the
 * feedback already shown to them in the app; the reviewer's identity is not
 * part of the export.
 */
export interface DataExportOrganizerApplication {
  munName: string | null
  status: ApplicationStatus
  reviewNotes: string | null
  expectedDelegateCount: number | null
  previousEditions: string | null
  websiteUrl: string | null
  submittedAt: Date
}

export interface AccountDataExport {
  format: typeof DATA_EXPORT_FORMAT
  version: typeof DATA_EXPORT_VERSION
  exportedAt: Date
  account: DataExportAccount
  studentProfile: DataExportStudentProfile | null
  consents: DataExportConsent[]
  registrations: DataExportRegistration[]
  payments: DataExportPayment[]
  achievements: DataExportAchievement[]
  supportTickets: DataExportSupportTicket[]
  organizerProfile: DataExportOrganizerProfile | null
  organizerApplications: DataExportOrganizerApplication[]
}

/**
 * Builds the signed-in user's data export. Throws `Error('Account not
 * found')` if the session's user no longer exists.
 */
export async function exportAccountData(session: Session, now: Date = new Date()): Promise<AccountDataExport> {
  const userId = session.userId

  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      username: users.username,
      institution: users.institution,
      profileImage: users.profileImage,
      role: users.role,
      emailNotificationsEnabled: users.emailNotificationsEnabled,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!account) {
    throw new Error('Account not found')
  }

  const [
    studentProfile,
    consents,
    registrationRows,
    paymentRows,
    achievementRows,
    organizerProfile,
    organizerApplicationRows,
    ticketRows,
  ] = await Promise.all([
    loadStudentProfile(userId),
    db
      .select({
        consentType: userConsents.consentType,
        policyVersion: userConsents.policyVersion,
        acceptedAt: userConsents.acceptedAt,
      })
      .from(userConsents)
      .where(eq(userConsents.userId, userId))
      .orderBy(asc(userConsents.acceptedAt)),
    loadRegistrations(userId),
    loadPayments(userId),
    loadAchievements(userId),
    loadOrganizerProfile(userId),
    loadOrganizerApplications(userId),
    db
      .select({
        id: supportTickets.id,
        category: supportTickets.category,
        status: supportTickets.status,
        subject: supportTickets.subject,
        description: supportTickets.description,
        relatedRegistrationId: supportTickets.relatedRegistrationId,
        relatedMunId: supportTickets.relatedMunId,
        resolutionNotes: supportTickets.resolutionNotes,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
      })
      .from(supportTickets)
      .where(eq(supportTickets.createdBy, userId))
      .orderBy(desc(supportTickets.createdAt)),
  ])

  const messageRows =
    ticketRows.length === 0
      ? []
      : await db
          .select({
            ticketId: supportMessages.ticketId,
            senderId: supportMessages.senderId,
            senderRole: supportMessages.senderRole,
            body: supportMessages.body,
            createdAt: supportMessages.createdAt,
          })
          .from(supportMessages)
          .where(
            inArray(
              supportMessages.ticketId,
              ticketRows.map((ticket) => ticket.id),
            ),
          )
          .orderBy(asc(supportMessages.createdAt))

  const messagesByTicket = new Map<string, DataExportSupportMessage[]>()
  for (const message of messageRows) {
    const list = messagesByTicket.get(message.ticketId) ?? []
    list.push({
      fromYou: message.senderId === userId,
      senderRole: message.senderRole,
      body: message.body,
      createdAt: message.createdAt,
    })
    messagesByTicket.set(message.ticketId, list)
  }

  return {
    format: DATA_EXPORT_FORMAT,
    version: DATA_EXPORT_VERSION,
    exportedAt: now,
    account,
    studentProfile,
    consents,
    registrations: registrationRows,
    payments: paymentRows,
    achievements: achievementRows,
    supportTickets: ticketRows.map((ticket) => ({ ...ticket, messages: messagesByTicket.get(ticket.id) ?? [] })),
    organizerProfile,
    organizerApplications: organizerApplicationRows,
  }
}

/** Awards recorded against this account (lib/actions/results.ts). */
async function loadAchievements(userId: string): Promise<DataExportAchievement[]> {
  return db
    .select({
      munName: muns.name,
      committee: achievements.committee,
      portfolio: achievements.portfolio,
      award: achievements.award,
      createdAt: achievements.createdAt,
    })
    .from(achievements)
    .innerJoin(muns, eq(achievements.munId, muns.id))
    .where(eq(achievements.userId, userId))
    .orderBy(desc(achievements.createdAt))
}

async function loadOrganizerProfile(userId: string): Promise<DataExportOrganizerProfile | null> {
  const [row] = await db
    .select({
      firstName: organizerProfiles.firstName,
      lastName: organizerProfiles.lastName,
      contactPhone: organizerProfiles.contactPhone,
      munName: organizerProfiles.munName,
      munCity: organizerProfiles.munCity,
      munStartDate: organizerProfiles.munStartDate,
      expectedDelegateCount: organizerProfiles.expectedDelegateCount,
      munDescription: organizerProfiles.munDescription,
      previousEditions: organizerProfiles.previousEditions,
      websiteUrl: organizerProfiles.websiteUrl,
      accountHolderName: organizerProfiles.accountHolderName,
      bankName: organizerProfiles.bankName,
      // bankAccountNumberCiphertext is deliberately NOT selected — write-only,
      // same as firstMunId is deliberately left out below (not the person's data).
      bankAccountLast4: organizerProfiles.bankAccountLast4,
      ifscCode: organizerProfiles.ifscCode,
      upiId: organizerProfiles.upiId,
      upiPhone: organizerProfiles.upiPhone,
      agreementVersion: organizerProfiles.agreementVersion,
      completedAt: organizerProfiles.completedAt,
      createdAt: organizerProfiles.createdAt,
      updatedAt: organizerProfiles.updatedAt,
    })
    .from(organizerProfiles)
    .where(eq(organizerProfiles.userId, userId))
    .limit(1)
  return row ?? null
}

async function loadOrganizerApplications(userId: string): Promise<DataExportOrganizerApplication[]> {
  return db
    .select({
      munName: muns.name,
      status: organizerApplications.status,
      reviewNotes: organizerApplications.reviewNotes,
      expectedDelegateCount: organizerApplications.expectedDelegateCount,
      previousEditions: organizerApplications.previousEditions,
      websiteUrl: organizerApplications.websiteUrl,
      submittedAt: organizerApplications.submittedAt,
    })
    .from(organizerApplications)
    // Left join: munId is nullable, and an application without a mun row is
    // still the organizer's own data.
    .leftJoin(muns, eq(organizerApplications.munId, muns.id))
    .where(eq(organizerApplications.organizerId, userId))
    .orderBy(desc(organizerApplications.submittedAt))
}

async function loadStudentProfile(userId: string): Promise<DataExportStudentProfile | null> {
  const [row] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1)
  if (!row) return null
  // Row ids are internal; the profile belongs to the account above.
  const profile: Partial<typeof row> = { ...row }
  delete profile.id
  delete profile.userId
  return profile as DataExportStudentProfile
}

async function loadRegistrations(userId: string): Promise<DataExportRegistration[]> {
  const rows = await db
    .select({
      id: registrations.id,
      munName: muns.name,
      munSlug: muns.slug,
      munStartDate: muns.startDate,
      munEndDate: muns.endDate,
      munCity: muns.city,
      passName: registrationProducts.name,
      passPrice: registrationProducts.price,
      passCurrency: registrationProducts.currency,
      committeeName: committees.name,
      portfolioName: portfolios.name,
      accommodationName: accommodationOptions.name,
      accommodationAnswers: registrations.accommodationAnswers,
      formResponses: registrations.formResponses,
      status: registrations.status,
      createdAt: registrations.createdAt,
      updatedAt: registrations.updatedAt,
    })
    .from(registrations)
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .innerJoin(registrationProducts, eq(registrations.registrationProductId, registrationProducts.id))
    .leftJoin(committees, eq(registrations.committeeId, committees.id))
    .leftJoin(portfolios, eq(registrations.portfolioId, portfolios.id))
    .leftJoin(accommodationOptions, eq(registrations.accommodationOptionId, accommodationOptions.id))
    .where(eq(registrations.userId, userId))
    .orderBy(desc(registrations.createdAt))

  return rows.map((row) => ({
    id: row.id,
    mun: {
      name: row.munName,
      slug: row.munSlug,
      startDate: row.munStartDate,
      endDate: row.munEndDate,
      city: row.munCity,
    },
    pass: { name: row.passName, price: row.passPrice, currency: row.passCurrency },
    committee: row.committeeName,
    portfolio: row.portfolioName,
    accommodation:
      row.accommodationName === null ? null : { name: row.accommodationName, answers: row.accommodationAnswers ?? null },
    formResponses: row.formResponses ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

async function loadPayments(userId: string): Promise<DataExportPayment[]> {
  const rows = await db
    .select({
      id: payments.id,
      registrationId: payments.registrationId,
      munName: muns.name,
      amount: payments.amount,
      currency: payments.currency,
      platformFeeAmount: payments.platformFeeAmount,
      platformFeeTaxAmount: payments.platformFeeTaxAmount,
      status: payments.status,
      provider: payments.provider,
      providerOrderId: payments.providerOrderId,
      providerPaymentId: payments.providerPaymentId,
      exceptionReason: payments.exceptionReason,
      exceptionRaisedAt: payments.exceptionRaisedAt,
      exceptionResolvedAt: payments.exceptionResolvedAt,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(registrations, eq(payments.registrationId, registrations.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(eq(registrations.userId, userId))
    .orderBy(desc(payments.createdAt))

  return rows.map(({ exceptionReason, exceptionRaisedAt, exceptionResolvedAt, ...payment }) => ({
    ...payment,
    exception:
      exceptionReason === null
        ? null
        : { reason: exceptionReason, raisedAt: exceptionRaisedAt, resolvedAt: exceptionResolvedAt },
  }))
}
