import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, organizerProfiles, userConsents, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { decryptField } from '@/lib/crypto/field-encryption'
import {
  ONBOARDING_ERRORS,
  acceptOrganizerAgreement,
  getOrganizerOnboarding,
  isOrganizerOnboardingComplete,
  saveOrganizerDetailsStep,
  saveOrganizerMunStep,
  saveOrganizerPaymentStep,
  saveOrganizerProfileStep,
  updateOrganizerOrganization,
} from './organizer-onboarding'
import { submitOrganizerApplication } from './organizer-application'

const PROFILE = { firstName: 'Asha', lastName: 'Rao', contactPhone: '98765 43210' }
const MUN = { munName: 'Deccan MUN 2027', munCity: 'Hyderabad', munStartDate: '2027-01-15' }
const DETAILS = {
  expectedDelegateCount: 350,
  munDescription: 'A three-day conference with eight committees for college delegates.',
  previousEditions: '2 editions',
  websiteUrl: 'https://deccanmun.example',
}
const FULL_ACCOUNT_NUMBER = '123456789012'
// Bank details are required; UPI is an optional secondary payout address.
const PAYMENT = {
  accountHolderName: 'Asha Rao',
  bankName: 'HDFC Bank',
  bankAccountNumber: FULL_ACCOUNT_NUMBER,
  ifscCode: 'hdfc0001234',
  upiId: 'Asha.Rao@freecharge',
  upiPhone: '+919876543210',
}

async function makeUser(role: 'ORGANIZER' | 'STUDENT', name = 'Signup Name Here'): Promise<Session> {
  const [user] = await db
    .insert(users)
    .values({ name, email: `onboarding-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return { userId: user.id, role: user.role }
}

async function fillAllButAgreement(session: Session) {
  await saveOrganizerProfileStep(PROFILE, session)
  await saveOrganizerMunStep(MUN, session)
  await saveOrganizerDetailsStep(DETAILS, session)
  await saveOrganizerPaymentStep(PAYMENT, session)
}

describe('organizer onboarding', () => {
  it('prefills the contact and UPI numbers from the phone given at signup', async () => {
    const session = await makeUser('ORGANIZER', 'Meera Iyer')
    await db.update(users).set({ phone: '+91 98450 12345' }).where(eq(users.id, session.userId))

    const initial = await getOrganizerOnboarding(session)
    expect(initial.profile).toMatchObject({ contactPhone: '9845012345', upiPhone: '9845012345' })

    // A signup phone that isn't an Indian mobile number isn't prefilled.
    const other = await makeUser('ORGANIZER', 'Tom Hale')
    await db.update(users).set({ phone: '+44 20 7946 0958' }).where(eq(users.id, other.userId))
    expect((await getOrganizerOnboarding(other)).profile).toMatchObject({ contactPhone: null, upiPhone: null })
  })

  it('saves the organization on the account, where the marketplace reads the host name', async () => {
    const session = await makeUser('ORGANIZER', 'Ravi Kumar')
    expect((await getOrganizerOnboarding(session)).profile.organization).toBeNull()

    const state = await saveOrganizerProfileStep({ ...PROFILE, organization: '  Deccan Debating Society ' }, session)
    expect(state.profile.organization).toBe('Deccan Debating Society')
    const [user] = await db.select().from(users).where(eq(users.id, session.userId))
    expect(user.institution).toBe('Deccan Debating Society')

    await expect(saveOrganizerProfileStep({ ...PROFILE, organization: '   ' }, session)).rejects.toThrow(
      'Organization is required',
    )
    await expect(saveOrganizerProfileStep({ ...PROFILE, organization: 'x'.repeat(121) }, session)).rejects.toThrow(
      'Organization must be at most 120 characters',
    )
    // Leaving it out keeps what was saved.
    await saveOrganizerProfileStep(PROFILE, session)
    expect((await getOrganizerOnboarding(session)).profile.organization).toBe('Deccan Debating Society')

    // Editable any time, including clearing it.
    await expect(updateOrganizerOrganization(' Hyderabad MUN Society ', session)).resolves.toEqual({
      organization: 'Hyderabad MUN Society',
    })
    await expect(updateOrganizerOrganization('', session)).resolves.toEqual({ organization: null })
    const student = await makeUser('STUDENT')
    await expect(updateOrganizerOrganization('Nope', student)).rejects.toThrow()
  })

  it('walks the five steps and submits the MUN as the organizer application', async () => {
    const session = await makeUser('ORGANIZER', 'Asha Rao Kumar')

    const initial = await getOrganizerOnboarding(session)
    expect(initial).toMatchObject({ completedSteps: [], nextStep: 'PROFILE', completed: false, firstMunId: null })
    expect(initial.profile).toMatchObject({ firstName: 'Asha', lastName: 'Rao Kumar' })

    let state = await saveOrganizerProfileStep(PROFILE, session)
    expect(state.nextStep).toBe('MUN')
    const [user] = await db.select().from(users).where(eq(users.id, session.userId))
    expect(user).toMatchObject({ name: 'Asha Rao', phone: '9876543210' })

    state = await saveOrganizerMunStep(MUN, session)
    expect(state.nextStep).toBe('DETAILS')
    expect(state.profile).toMatchObject({ munName: 'Deccan MUN 2027', munCity: 'Hyderabad', munStartDate: '2027-01-15' })

    state = await saveOrganizerDetailsStep(DETAILS, session)
    expect(state.nextStep).toBe('PAYMENT')
    expect(state.profile).toMatchObject({ expectedDelegateCount: 350, websiteUrl: 'https://deccanmun.example' })

    state = await saveOrganizerPaymentStep(PAYMENT, session)
    expect(state.profile).toMatchObject({
      accountHolderName: 'Asha Rao',
      bankName: 'HDFC Bank',
      bankAccountLast4: '9012',
      ifscCode: 'HDFC0001234',
      upiId: 'asha.rao@freecharge',
      upiPhone: '9876543210',
    })
    // The full account number is write-only — never present anywhere in the returned profile.
    expect(JSON.stringify(state.profile)).not.toContain(FULL_ACCOUNT_NUMBER)
    expect(state.nextStep).toBe('AGREEMENT')
    expect(await isOrganizerOnboardingComplete(session.userId)).toBe(false)

    state = await acceptOrganizerAgreement({ accepted: true }, session)
    expect(state).toMatchObject({ completed: true, nextStep: null })
    expect(state.completedSteps).toEqual(['PROFILE', 'MUN', 'DETAILS', 'PAYMENT', 'AGREEMENT'])
    expect(await isOrganizerOnboardingComplete(session.userId)).toBe(true)

    const [application] = await db
      .select()
      .from(organizerApplications)
      .where(eq(organizerApplications.organizerId, session.userId))
    expect(application.status).toBe('SUBMITTED')
    expect(state.firstMunId).toBe(application.munId)
    const [mun] = await db.select().from(muns).where(eq(muns.id, application.munId!))
    expect(mun).toMatchObject({ name: 'Deccan MUN 2027', city: 'Hyderabad', status: 'SUBMITTED', organizerId: session.userId })

    const consents = await db
      .select()
      .from(userConsents)
      .where(and(eq(userConsents.userId, session.userId), eq(userConsents.consentType, 'ORGANIZER_AGREEMENT')))
    expect(consents).toHaveLength(1)
  })

  it("doesn't create a second application for an organizer who already has one", async () => {
    const session = await makeUser('ORGANIZER')
    const existing = await submitOrganizerApplication({
      organizerId: session.userId,
      conferenceName: 'Earlier MUN',
      location: 'Pune',
      expectedDate: new Date('2027-03-01'),
      expectedDelegateCount: 100,
      description: 'Submitted before the wizard existed, through the old form.',
    })
    await fillAllButAgreement(session)

    const state = await acceptOrganizerAgreement({ accepted: true }, session)
    expect(state.completed).toBe(true)
    expect(state.firstMunId).toBe(existing.munId)
    const applications = await db
      .select()
      .from(organizerApplications)
      .where(eq(organizerApplications.organizerId, session.userId))
    expect(applications).toHaveLength(1)
  })

  it('validates each field', async () => {
    const session = await makeUser('ORGANIZER')
    await expect(saveOrganizerProfileStep({ ...PROFILE, firstName: ' ' }, session)).rejects.toThrow(
      'First name is required',
    )
    await expect(saveOrganizerProfileStep({ ...PROFILE, contactPhone: '12345' }, session)).rejects.toThrow(
      'Contact number must be a 10-digit Indian mobile number',
    )
    await saveOrganizerProfileStep(PROFILE, session)

    await expect(saveOrganizerMunStep({ ...MUN, munName: '' }, session)).rejects.toThrow('MUN title is required')
    await expect(saveOrganizerMunStep({ ...MUN, munStartDate: '15/01/2027' }, session)).rejects.toThrow(
      'Expected start date must be a valid date',
    )
    await saveOrganizerMunStep(MUN, session)

    await expect(saveOrganizerDetailsStep({ ...DETAILS, expectedDelegateCount: 0 }, session)).rejects.toThrow(
      'Maximum expected delegates must be a whole number from 1 to 10000',
    )
    await expect(saveOrganizerDetailsStep({ ...DETAILS, expectedDelegateCount: 12.5 }, session)).rejects.toThrow(
      'Maximum expected delegates',
    )
    await expect(saveOrganizerDetailsStep({ ...DETAILS, munDescription: 'Too short' }, session)).rejects.toThrow(
      'Description must be at least 40 characters',
    )
    await expect(saveOrganizerDetailsStep({ ...DETAILS, websiteUrl: 'deccanmun.example' }, session)).rejects.toThrow(
      'Website must be a full URL, including https://',
    )
    const state = await saveOrganizerDetailsStep({ ...DETAILS, previousEditions: ' ', websiteUrl: '' }, session)
    expect(state.profile).toMatchObject({ previousEditions: null, websiteUrl: null })

    await expect(saveOrganizerPaymentStep({ ...PAYMENT, accountHolderName: ' ' }, session)).rejects.toThrow(
      'Account holder name is required',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, bankName: ' ' }, session)).rejects.toThrow(
      'Bank name is required',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, bankAccountNumber: '12345' }, session)).rejects.toThrow(
      'Account number must be 9 to 18 digits',
    )
    await expect(
      saveOrganizerPaymentStep({ ...PAYMENT, bankAccountNumber: '1'.repeat(19) }, session),
    ).rejects.toThrow('Account number must be 9 to 18 digits')
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, bankAccountNumber: 'abc123456' }, session)).rejects.toThrow(
      'Account number must be 9 to 18 digits',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, ifscCode: 'BAD' }, session)).rejects.toThrow(
      'IFSC code must look like HDFC0001234',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, ifscCode: '0000HDFC123' }, session)).rejects.toThrow(
      'IFSC code must look like HDFC0001234',
    )

    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiId: 'not-a-upi' }, session)).rejects.toThrow(
      'Only a FreeCharge UPI ID is accepted — it must look like name@freecharge',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiId: 'rahul@okhdfcbank' }, session)).rejects.toThrow(
      'Only a FreeCharge UPI ID is accepted — it must look like name@freecharge',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiPhone: '5123456789' }, session)).rejects.toThrow(
      'UPI mobile number must be a 10-digit Indian mobile number',
    )
    // UPI is optional, but it's a pair: one without the other is rejected.
    const { upiPhone: _omitPhone, ...paymentWithoutUpiPhone } = PAYMENT
    await expect(saveOrganizerPaymentStep(paymentWithoutUpiPhone, session)).rejects.toThrow(
      'Mobile number linked to the UPI ID is required',
    )
    const { upiId: _omitId, ...paymentWithoutUpiId } = PAYMENT
    await expect(saveOrganizerPaymentStep(paymentWithoutUpiId, session)).rejects.toThrow(
      'Enter a UPI ID before its linked mobile number',
    )

    await saveOrganizerPaymentStep(PAYMENT, session)

    await expect(acceptOrganizerAgreement({ accepted: false }, session)).rejects.toThrow(
      'You must accept the organizer agreement to continue',
    )
  })

  it('rejects steps taken out of order', async () => {
    const session = await makeUser('ORGANIZER')
    await expect(saveOrganizerMunStep(MUN, session)).rejects.toThrow(ONBOARDING_ERRORS.outOfOrder)
    await expect(saveOrganizerPaymentStep(PAYMENT, session)).rejects.toThrow(ONBOARDING_ERRORS.outOfOrder)
    await expect(acceptOrganizerAgreement({ accepted: true }, session)).rejects.toThrow(ONBOARDING_ERRORS.outOfOrder)
  })

  it('locks every step once the agreement is accepted, and never submits twice', async () => {
    const session = await makeUser('ORGANIZER')
    await fillAllButAgreement(session)
    await acceptOrganizerAgreement({ accepted: true }, session)

    await expect(saveOrganizerProfileStep(PROFILE, session)).rejects.toThrow(ONBOARDING_ERRORS.locked)
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiId: 'someone.else@ybl' }, session)).rejects.toThrow(
      ONBOARDING_ERRORS.locked,
    )
    await expect(acceptOrganizerAgreement({ accepted: true }, session)).rejects.toThrow(ONBOARDING_ERRORS.locked)

    const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, session.userId))
    expect(row.upiId).toBe('asha.rao@freecharge')
    expect(row.bankAccountLast4).toBe('9012')
  })

  it('keeps the bank account number write-only: encrypted at rest, never returned as plaintext', async () => {
    const session = await makeUser('ORGANIZER')
    await saveOrganizerProfileStep(PROFILE, session)
    await saveOrganizerMunStep(MUN, session)
    await saveOrganizerDetailsStep(DETAILS, session)
    const state = await saveOrganizerPaymentStep(PAYMENT, session)

    expect(state.profile.bankAccountLast4).toBe(FULL_ACCOUNT_NUMBER.slice(-4))
    // The type has no plaintext/ciphertext field at all — checked through
    // `unknown` so this fails if one is ever added back.
    const asRecord = state.profile as unknown as Record<string, unknown>
    expect(asRecord.bankAccountNumber).toBeUndefined()
    expect(asRecord.bankAccountNumberCiphertext).toBeUndefined()

    const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, session.userId))
    expect(row.bankAccountNumberCiphertext).toBeTruthy()
    expect(row.bankAccountNumberCiphertext).not.toContain(FULL_ACCOUNT_NUMBER)
    expect(decryptField(row.bankAccountNumberCiphertext!)).toBe(FULL_ACCOUNT_NUMBER)
  })

  it('accepts the payment step with bank details only — UPI is optional', async () => {
    const session = await makeUser('ORGANIZER')
    await saveOrganizerProfileStep(PROFILE, session)
    await saveOrganizerMunStep(MUN, session)
    await saveOrganizerDetailsStep(DETAILS, session)

    const { upiId: _upiId, upiPhone: _upiPhone, ...bankOnly } = PAYMENT
    const state = await saveOrganizerPaymentStep(bankOnly, session)

    expect(state.nextStep).toBe('AGREEMENT')
    expect(state.profile.upiId).toBeNull()
    // upiPhone still defaults from the signup phone when no UPI was ever saved —
    // that's a pre-fill suggestion for the UI, independent of the UPI pair rule.
    const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, session.userId))
    expect(row.upiId).toBeNull()
    expect(row.upiPhone).toBeNull()
  })

  it('handles a double submit of the agreement without a second application', async () => {
    const session = await makeUser('ORGANIZER')
    await fillAllButAgreement(session)

    const results = await Promise.allSettled([
      acceptOrganizerAgreement({ accepted: true }, session),
      acceptOrganizerAgreement({ accepted: true }, session),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const applications = await db
      .select()
      .from(organizerApplications)
      .where(eq(organizerApplications.organizerId, session.userId))
    expect(applications).toHaveLength(1)
  })

  it('is organizer-only', async () => {
    const student = await makeUser('STUDENT')
    await expect(getOrganizerOnboarding(student)).rejects.toThrow('Forbidden')
    await expect(saveOrganizerProfileStep(PROFILE, student)).rejects.toThrow('Forbidden')
    await expect(getOrganizerOnboarding(null)).rejects.toThrow('Forbidden')
  })
})
