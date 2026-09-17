import { randomUUID } from 'node:crypto'

/** A unique, obviously-synthetic email so tests never collide with each other or with seeded accounts. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@e2e.munhub.test`
}

/**
 * A complete, valid signup payload for POST /api/v1/auth/users — every
 * field lib/actions/auth.ts#signUp requires. Tests override only what
 * they're exercising.
 */
export function signUpPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'E2E Delegate',
    email: uniqueEmail('delegate'),
    password: 'e2e-strong-password',
    gender: 'Prefer not to say',
    phone: '9876501234',
    institution: 'E2E Test University',
    dateOfBirth: '2004-06-15',
    gradeOrYear: '3rd year',
    residentialAddress: '42 Test Lane, Hyderabad',
    emergencyContactName: 'E2E Guardian',
    emergencyContactPhone: '9876505678',
    emergencyContactRelation: 'Parent',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
    ...overrides,
  }
}

export type SignUpPayload = ReturnType<typeof signUpPayload>

/** An adult's date of birth (so the guardian-consent checkbox stays hidden). */
export const ADULT_DOB = '2000-01-01'

/** A date of birth that makes the signer a minor today, so guardian consent is shown. */
export function minorDob(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 15)
  return d.toISOString().slice(0, 10)
}
