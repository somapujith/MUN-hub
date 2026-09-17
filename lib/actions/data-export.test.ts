import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import type { Session } from '@/lib/auth/adapter'
import { DATA_EXPORT_FORMAT, DATA_EXPORT_VERSION, exportAccountData } from './data-export'
import { makeAccount, makeDelegateWithHistory } from './privacy-test-helpers'

describe('exportAccountData', () => {
  it("returns the delegate's account, profile, consents, registrations, payments and support tickets", async () => {
    const fixture = await makeDelegateWithHistory()
    const session: Session = { userId: fixture.delegate.id, role: 'STUDENT' }

    const data = await exportAccountData(session)

    expect(data.format).toBe(DATA_EXPORT_FORMAT)
    expect(data.version).toBe(DATA_EXPORT_VERSION)
    expect(data.exportedAt).toBeInstanceOf(Date)

    expect(data.account).toEqual({
      id: fixture.delegate.id,
      name: fixture.delegate.name,
      email: fixture.delegate.email,
      phone: '9876500001',
      username: fixture.delegate.username,
      institution: 'Privacy Test College',
      profileImage: null,
      role: 'STUDENT',
      emailNotificationsEnabled: true,
      createdAt: fixture.delegate.createdAt,
    })
    expect(data.account).not.toHaveProperty('passwordHash')

    expect(data.studentProfile).toMatchObject({
      gradeOrYear: 'Grade 12',
      emergencyContactName: 'Parent Name',
      emergencyContactRelation: 'Parent',
      gender: 'Female',
    })
    expect(data.studentProfile).not.toHaveProperty('id')
    expect(data.studentProfile).not.toHaveProperty('userId')

    expect(data.consents.map((consent) => consent.consentType).sort()).toEqual(['PRIVACY_POLICY', 'TERMS_OF_SERVICE'])
    expect(data.consents[0]).toEqual({
      consentType: expect.any(String),
      policyVersion: '2026-09-17',
      acceptedAt: expect.any(Date),
    })

    expect(data.registrations).toHaveLength(4)
    const confirmed = data.registrations.find((r) => r.id === fixture.registrations.upcomingConfirmed.id)
    expect(confirmed).toEqual({
      id: fixture.registrations.upcomingConfirmed.id,
      mun: {
        name: 'Upcoming Privacy MUN',
        slug: fixture.upcoming.mun.slug,
        startDate: fixture.upcoming.mun.startDate,
        endDate: fixture.upcoming.mun.endDate,
        city: 'Hyderabad',
      },
      pass: { name: 'Upcoming Privacy MUN Delegate Pass', price: 150000, currency: 'INR' },
      committee: 'UNSC',
      portfolio: 'France',
      accommodation: { name: 'Twin sharing', answers: { roommate: 'Friend Name' } },
      formResponses: { emergency_contact_name: 'Parent Name', dietary: 'Vegetarian' },
      status: 'CONFIRMED',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    const finished = data.registrations.find((r) => r.id === fixture.registrations.finishedConfirmed.id)
    expect(finished).toMatchObject({ committee: null, portfolio: null, accommodation: null })

    expect(data.payments).toHaveLength(2)
    const paid = data.payments.find((p) => p.id === fixture.payments.paidPayment.id)
    expect(paid).toEqual({
      id: fixture.payments.paidPayment.id,
      registrationId: fixture.registrations.upcomingConfirmed.id,
      munName: 'Upcoming Privacy MUN',
      amount: 200000,
      currency: 'INR',
      platformFeeAmount: 6000,
      platformFeeTaxAmount: 1080,
      status: 'PAID',
      provider: 'mock_razorpay',
      providerOrderId: fixture.payments.paidPayment.providerOrderId,
      providerPaymentId: fixture.payments.paidPayment.providerPaymentId,
      exception: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    // The organizer's payout share is not the delegate's data.
    expect(paid).not.toHaveProperty('organizerNetAmount')

    expect(data.supportTickets).toHaveLength(1)
    expect(data.supportTickets[0]).toMatchObject({
      id: fixture.ticket.id,
      category: 'PAYMENT',
      subject: 'Payment question',
      description: 'Was I charged twice?',
      relatedRegistrationId: fixture.registrations.upcomingConfirmed.id,
    })
    // Staff replies are included, but not which staff member wrote them.
    expect(data.supportTickets[0].messages).toEqual([
      { fromYou: true, senderRole: 'STUDENT', body: 'Was I charged twice?', createdAt: expect.any(Date) },
      { fromYou: false, senderRole: 'ADMIN', body: 'No, only once.', createdAt: expect.any(Date) },
    ])

    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain(fixture.admin.id)
    expect(serialized).not.toContain(fixture.sessionToken)
  })

  // An award is personal data recorded against the account by an organizer,
  // so a data-access request has to return it.
  it("includes the delegate's awards", async () => {
    const fixture = await makeDelegateWithHistory()

    const data = await exportAccountData({ userId: fixture.delegate.id, role: 'STUDENT' })

    expect(data.achievements).toEqual([
      {
        munName: 'Finished Privacy MUN',
        committee: 'UNSC',
        portfolio: 'France',
        award: 'Best Delegate',
        createdAt: expect.any(Date),
      },
    ])
  })

  // Organizers see the same "Download my data" button as delegates, so their
  // own profile and applications belong in the file too.
  it("includes an organizer's profile and applications", async () => {
    const fixture = await makeDelegateWithHistory()

    const data = await exportAccountData({ userId: fixture.organizer.id, role: 'ORGANIZER' })

    expect(data.organizerProfile).toMatchObject({
      firstName: 'Privacy',
      lastName: 'Organizer',
      contactPhone: '9876500003',
      upiId: 'privacy@ybl',
      upiPhone: '9876500003',
      agreementVersion: 'test',
    })
    expect(data.organizerApplications).toEqual([
      {
        munName: 'Upcoming Privacy MUN',
        status: 'APPROVED',
        reviewNotes: 'Looks good',
        expectedDelegateCount: 200,
        previousEditions: null,
        websiteUrl: 'https://privacy-mun.test',
        submittedAt: expect.any(Date),
      },
    ])
    // Still scoped to the caller: no delegate rows leak into an organizer's file.
    expect(data.registrations).toEqual([])
    expect(JSON.stringify(data)).not.toContain(fixture.delegate.id)
  })

  it("never includes another user's rows", async () => {
    const fixture = await makeDelegateWithHistory()
    const bystander = await makeAccount('STUDENT')

    const data = await exportAccountData({ userId: bystander.id, role: 'STUDENT' })

    expect(data.account.id).toBe(bystander.id)
    expect(data.studentProfile).toBeNull()
    expect(data.consents).toEqual([])
    expect(data.registrations).toEqual([])
    expect(data.payments).toEqual([])
    expect(data.achievements).toEqual([])
    expect(data.organizerProfile).toBeNull()
    expect(data.organizerApplications).toEqual([])
    expect(data.supportTickets).toEqual([])
    expect(JSON.stringify(data)).not.toContain(fixture.delegate.id)
  })

  it('throws "Account not found" for a session whose user does not exist', async () => {
    await expect(
      exportAccountData({ userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'STUDENT' }),
    ).rejects.toThrow('Account not found')
  })
})

afterAll(async () => {
  await db.$client.end()
})
