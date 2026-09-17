import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { organizerProfiles, userConsents, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import {
  ONBOARDING_ERRORS,
  acceptOrganizerAgreement,
  getOrganizerOnboarding,
  isOrganizerOnboardingComplete,
  saveOrganizerGstStep,
  saveOrganizerPanStep,
  saveOrganizerPaymentStep,
  saveOrganizerProfileStep,
} from './organizer-onboarding'

const PROFILE = { firstName: 'Asha', lastName: 'Rao', contactPhone: '98765 43210' }
const PAN = { panNumber: 'abcde1234f', panName: 'Asha Rao' }
const PAYMENT = { upiId: 'Asha.Rao@okhdfcbank', upiPhone: '+919876543210' }

async function makeUser(role: 'ORGANIZER' | 'STUDENT', name = 'Signup Name Here'): Promise<Session> {
  const [user] = await db
    .insert(users)
    .values({ name, email: `onboarding-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return { userId: user.id, role: user.role }
}

async function completeAll(session: Session) {
  await saveOrganizerProfileStep(PROFILE, session)
  await saveOrganizerPanStep(PAN, session)
  await saveOrganizerGstStep({ hasGstin: false }, session)
  await saveOrganizerPaymentStep(PAYMENT, session)
  return acceptOrganizerAgreement({ accepted: true }, session)
}

describe('organizer onboarding', () => {
  it('walks the five steps in order and unlocks hosting at the end', async () => {
    const session = await makeUser('ORGANIZER', 'Asha Rao Kumar')

    const initial = await getOrganizerOnboarding(session)
    expect(initial).toMatchObject({ completedSteps: [], nextStep: 'PROFILE', completed: false })
    expect(initial.profile).toMatchObject({ firstName: 'Asha', lastName: 'Rao Kumar' })

    let state = await saveOrganizerProfileStep(PROFILE, session)
    expect(state.nextStep).toBe('PAN')
    expect(state.profile.contactPhone).toBe('9876543210')
    const [user] = await db.select().from(users).where(eq(users.id, session.userId))
    expect(user).toMatchObject({ name: 'Asha Rao', phone: '9876543210' })

    state = await saveOrganizerPanStep(PAN, session)
    expect(state.nextStep).toBe('GST')
    expect(state.profile.panLast4).toBe('234F')

    state = await saveOrganizerGstStep({ hasGstin: true, gstin: '27abcde1234f1z5' }, session)
    expect(state.profile.gstin).toBe('27ABCDE1234F1Z5')
    expect(state.nextStep).toBe('PAYMENT')

    state = await saveOrganizerPaymentStep(PAYMENT, session)
    expect(state.profile).toMatchObject({ upiId: 'asha.rao@okhdfcbank', upiPhone: '9876543210' })
    expect(state.nextStep).toBe('AGREEMENT')
    expect(await isOrganizerOnboardingComplete(session.userId)).toBe(false)

    state = await acceptOrganizerAgreement({ accepted: true }, session)
    expect(state).toMatchObject({ completed: true, nextStep: null })
    expect(state.completedSteps).toEqual(['PROFILE', 'PAN', 'GST', 'PAYMENT', 'AGREEMENT'])
    expect(await isOrganizerOnboardingComplete(session.userId)).toBe(true)

    const consents = await db
      .select()
      .from(userConsents)
      .where(and(eq(userConsents.userId, session.userId), eq(userConsents.consentType, 'ORGANIZER_AGREEMENT')))
    expect(consents).toHaveLength(1)
  })

  it('stores the PAN encrypted and never returns it in full', async () => {
    const session = await makeUser('ORGANIZER')
    await saveOrganizerProfileStep(PROFILE, session)
    const state = await saveOrganizerPanStep(PAN, session)

    const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, session.userId))
    expect(row.panCiphertext).toBeTruthy()
    expect(row.panCiphertext).not.toContain('ABCDE1234F')
    expect(JSON.stringify(state)).not.toContain('ABCDE1234F')
  })

  it('accepts "no GSTIN" but requires a valid one when the organizer has it', async () => {
    const session = await makeUser('ORGANIZER')
    await saveOrganizerProfileStep(PROFILE, session)
    await saveOrganizerPanStep(PAN, session)

    await expect(saveOrganizerGstStep({ hasGstin: true, gstin: '12345' }, session)).rejects.toThrow(
      'GSTIN must be a valid 15-character GST number',
    )
    const state = await saveOrganizerGstStep({ hasGstin: false, gstin: 'ignored' }, session)
    expect(state.profile).toMatchObject({ hasGstin: false, gstin: null })
    expect(state.completedSteps).toContain('GST')
  })

  it('rejects steps taken out of order', async () => {
    const session = await makeUser('ORGANIZER')
    await expect(saveOrganizerPanStep(PAN, session)).rejects.toThrow(ONBOARDING_ERRORS.outOfOrder)
    await expect(saveOrganizerPaymentStep(PAYMENT, session)).rejects.toThrow(ONBOARDING_ERRORS.outOfOrder)
    await expect(acceptOrganizerAgreement({ accepted: true }, session)).rejects.toThrow(ONBOARDING_ERRORS.outOfOrder)
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

    await expect(saveOrganizerPanStep({ ...PAN, panNumber: 'ABCD1234F' }, session)).rejects.toThrow(
      'PAN must look like ABCDE1234F',
    )
    await saveOrganizerPanStep(PAN, session)
    await saveOrganizerGstStep({ hasGstin: false }, session)

    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiId: 'not-a-upi' }, session)).rejects.toThrow(
      'UPI ID must look like name@bank',
    )
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiPhone: '5123456789' }, session)).rejects.toThrow(
      'UPI mobile number must be a 10-digit Indian mobile number',
    )
    await saveOrganizerPaymentStep(PAYMENT, session)

    await expect(acceptOrganizerAgreement({ accepted: false }, session)).rejects.toThrow(
      'You must accept the organizer agreement to continue',
    )
  })

  it('locks every step once the agreement is accepted', async () => {
    const session = await makeUser('ORGANIZER')
    await completeAll(session)

    await expect(saveOrganizerProfileStep(PROFILE, session)).rejects.toThrow(ONBOARDING_ERRORS.locked)
    await expect(saveOrganizerPaymentStep({ ...PAYMENT, upiId: 'someone.else@ybl' }, session)).rejects.toThrow(
      ONBOARDING_ERRORS.locked,
    )
    await expect(acceptOrganizerAgreement({ accepted: true }, session)).rejects.toThrow(ONBOARDING_ERRORS.locked)

    const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, session.userId))
    expect(row.upiId).toBe('asha.rao@okhdfcbank')
  })

  it('is organizer-only', async () => {
    const student = await makeUser('STUDENT')
    await expect(getOrganizerOnboarding(student)).rejects.toThrow('Forbidden')
    await expect(saveOrganizerProfileStep(PROFILE, student)).rejects.toThrow('Forbidden')
    await expect(getOrganizerOnboarding(null)).rejects.toThrow('Forbidden')
  })
})
