import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  accommodationOptions,
  committees,
  muns,
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

export interface AccountDataExport {
  format: typeof DATA_EXPORT_FORMAT
  version: typeof DATA_EXPORT_VERSION
  exportedAt: Date
  account: DataExportAccount
  studentProfile: DataExportStudentProfile | null
  consents: DataExportConsent[]
  registrations: DataExportRegistration[]
  payments: DataExportPayment[]
  supportTickets: DataExportSupportTicket[]
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

  const [studentProfile, consents, registrationRows, paymentRows, ticketRows] = await Promise.all([
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
    supportTickets: ticketRows.map((ticket) => ({ ...ticket, messages: messagesByTicket.get(ticket.id) ?? [] })),
  }
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
