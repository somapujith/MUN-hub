import { db } from '@/lib/db/client'
import {
  accommodationOptions,
  achievements,
  committees,
  muns,
  organizerApplications,
  organizerProfiles,
  passwordResetTokens,
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
import { hashPassword } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import type { RegistrationStatus, Role } from '@/lib/db/schema-enums'

/**
 * Test-only fixtures for the data-export and account-deletion tests
 * (lib/actions/*.test.ts, server/integration/account-privacy.integration.test.ts).
 * Not imported by application code.
 */

export const DELEGATE_PASSWORD = 'delegate-password-1'
const DAY_MS = 24 * 60 * 60 * 1000

function suffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function makeAccount(role: Role, password: string | null = DELEGATE_PASSWORD) {
  const [user] = await db
    .insert(users)
    .values({
      name: `Privacy ${role}`,
      email: `privacy-${role.toLowerCase()}-${suffix()}@test.com`,
      role,
      phone: '9876500001',
      institution: 'Privacy Test College',
      username: `privacy-${suffix()}`,
      passwordHash: password === null ? null : await hashPassword(password),
    })
    .returning()
  return user
}

async function makeMun(organizerId: string, name: string, startDate: Date, endDate: Date) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name, slug: `privacy-mun-${suffix()}`, startDate, endDate, city: 'Hyderabad' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: `${name} Delegate Pass`, price: 150000, capacity: 50 })
    .returning()
  return { mun, product }
}

async function register(
  userId: string,
  munId: string,
  productId: string,
  status: RegistrationStatus,
  extra: Partial<typeof registrations.$inferInsert> = {},
) {
  const [registration] = await db
    .insert(registrations)
    .values({
      userId,
      munId,
      registrationProductId: productId,
      status,
      formResponses: { emergency_contact_name: 'Parent Name', dietary: 'Vegetarian' },
      ...extra,
    })
    .returning()
  return registration
}

/**
 * A delegate with a full history: profile, consents, a confirmed seat at an
 * upcoming conference (with committee, portfolio, accommodation and a paid
 * payment), a confirmed seat at a finished conference, a cancelled
 * registration, an unpaid hold, a support ticket answered by staff, a live
 * session and a reset token.
 */
export async function makeDelegateWithHistory() {
  const now = Date.now()
  const delegate = await makeAccount('STUDENT')
  const organizer = await makeAccount('ORGANIZER', null)
  const admin = await makeAccount('ADMIN', null)

  await db.insert(studentProfiles).values({
    userId: delegate.id,
    dateOfBirth: new Date('2008-04-01T00:00:00Z'),
    gradeOrYear: 'Grade 12',
    residentialAddress: '1 Test Street, Hyderabad',
    emergencyContactName: 'Parent Name',
    emergencyContactPhone: '9876500002',
    emergencyContactRelation: 'Parent',
    gender: 'Female',
  })
  await db.insert(userConsents).values([
    { userId: delegate.id, consentType: 'TERMS_OF_SERVICE', policyVersion: '2026-09-17' },
    { userId: delegate.id, consentType: 'PRIVACY_POLICY', policyVersion: '2026-09-17' },
  ])

  const upcoming = await makeMun(
    organizer.id,
    'Upcoming Privacy MUN',
    new Date(now + 10 * DAY_MS),
    new Date(now + 12 * DAY_MS),
  )
  const finished = await makeMun(
    organizer.id,
    'Finished Privacy MUN',
    new Date(now - 30 * DAY_MS),
    new Date(now - 28 * DAY_MS),
  )

  const [committee] = await db
    .insert(committees)
    .values({ munId: upcoming.mun.id, name: 'UNSC', capacity: 20 })
    .returning()
  const [portfolio] = await db
    .insert(portfolios)
    .values({ committeeId: committee.id, name: 'France' })
    .returning()
  const [accommodation] = await db
    .insert(accommodationOptions)
    .values({ munId: upcoming.mun.id, name: 'Twin sharing', price: 50000, capacity: 10 })
    .returning()

  const upcomingConfirmed = await register(delegate.id, upcoming.mun.id, upcoming.product.id, 'CONFIRMED', {
    committeeId: committee.id,
    portfolioId: portfolio.id,
    accommodationOptionId: accommodation.id,
    accommodationAnswers: { roommate: 'Friend Name' },
  })
  const finishedConfirmed = await register(delegate.id, finished.mun.id, finished.product.id, 'CONFIRMED')
  const cancelled = await register(delegate.id, upcoming.mun.id, upcoming.product.id, 'CANCELLED')
  const unpaidHold = await register(delegate.id, upcoming.mun.id, upcoming.product.id, 'PAYMENT_PENDING', {
    expiresAt: new Date(now + 10 * 60 * 1000),
  })

  const [paidPayment] = await db
    .insert(payments)
    .values({
      registrationId: upcomingConfirmed.id,
      providerOrderId: `order_privacy_${suffix()}`,
      providerPaymentId: `pay_privacy_${suffix()}`,
      amount: 200000,
      platformFeeAmount: 6000,
      platformFeeTaxAmount: 1080,
      organizerNetAmount: 192920,
      status: 'PAID',
    })
    .returning()
  const [pendingPayment] = await db
    .insert(payments)
    .values({
      registrationId: unpaidHold.id,
      providerOrderId: `order_privacy_${suffix()}`,
      amount: 150000,
      status: 'CREATED',
    })
    .returning()

  const [achievement] = await db
    .insert(achievements)
    .values({
      userId: delegate.id,
      munId: finished.mun.id,
      registrationId: finishedConfirmed.id,
      committee: 'UNSC',
      portfolio: 'France',
      award: 'Best Delegate',
    })
    .returning()

  // The organizer sees the same "Download my data" button, so their profile
  // and application have to be exportable too.
  await db.insert(organizerProfiles).values({
    userId: organizer.id,
    firstName: 'Privacy',
    lastName: 'Organizer',
    contactPhone: '9876500003',
    accountHolderName: 'Privacy Organizer',
    bankName: 'Test Bank',
    bankAccountLast4: '4321',
    ifscCode: 'TEST0001234',
    upiId: 'privacy@freecharge',
    upiPhone: '9876500003',
    agreementVersion: 'test',
    completedAt: new Date(now),
  })
  const [application] = await db
    .insert(organizerApplications)
    .values({
      organizerId: organizer.id,
      munId: upcoming.mun.id,
      status: 'APPROVED',
      reviewNotes: 'Looks good',
      expectedDelegateCount: 200,
      websiteUrl: 'https://privacy-mun.test',
    })
    .returning()

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      createdBy: delegate.id,
      category: 'PAYMENT',
      subject: 'Payment question',
      description: 'Was I charged twice?',
      relatedRegistrationId: upcomingConfirmed.id,
    })
    .returning()
  await db.insert(supportMessages).values([
    {
      ticketId: ticket.id,
      senderId: delegate.id,
      senderRole: 'STUDENT',
      body: 'Was I charged twice?',
      createdAt: new Date(now - 60_000),
    },
    { ticketId: ticket.id, senderId: admin.id, senderRole: 'ADMIN', body: 'No, only once.', createdAt: new Date(now) },
  ])

  const session = await createSession(delegate.id)
  await db.insert(passwordResetTokens).values({
    userId: delegate.id,
    token: `privacy-reset-${suffix()}`,
    expiresAt: new Date(now + 60 * 60 * 1000),
  })

  return {
    delegate,
    organizer,
    admin,
    upcoming,
    finished,
    committee,
    portfolio,
    accommodation,
    registrations: { upcomingConfirmed, finishedConfirmed, cancelled, unpaidHold },
    payments: { paidPayment, pendingPayment },
    achievement,
    application,
    ticket,
    sessionToken: session.token,
  }
}
