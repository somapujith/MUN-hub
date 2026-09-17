import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { organizerProfiles, userConsents, users } from '@/lib/db/schema'
import { encryptField } from '@/lib/crypto/field-encryption'
import type { Session } from '@/lib/auth/adapter'

/**
 * One-time organizer onboarding, done in order after signup and required
 * before applying to host a MUN:
 *
 *   1. PROFILE    first name, last name, contact number
 *   2. PAN        PAN number (encrypted, write-only) and the name on it
 *   3. GST        GSTIN, or an explicit "no GSTIN"
 *   4. PAYMENT    the UPI ID payouts go to, and the mobile number linked to it
 *   5. AGREEMENT  the organizer agreement, recorded as a consent row
 *
 * The details belong to the organizer account and apply to every MUN they
 * host. Once the agreement is accepted the details are locked: changing
 * where money goes after onboarding has to go through support.
 */

export const ORGANIZER_AGREEMENT_VERSION = '2026-09-17'

export const ONBOARDING_STEPS = ['PROFILE', 'PAN', 'GST', 'PAYMENT', 'AGREEMENT'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const ONBOARDING_ERRORS = {
  locked: 'Your organizer details are already submitted. Contact support to change them.',
  incomplete: 'Finish organizer onboarding before applying to host a MUN',
  outOfOrder: 'Complete the earlier onboarding steps first',
  notOrganizer: 'Forbidden',
} as const

const PHONE_PATTERN = /^[6-9]\d{9}$/
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/

export interface OrganizerOnboarding {
  profile: {
    firstName: string | null
    lastName: string | null
    contactPhone: string | null
    panName: string | null
    panLast4: string | null
    hasGstin: boolean | null
    gstin: string | null
    upiId: string | null
    upiPhone: string | null
  }
  completedSteps: OnboardingStep[]
  /** The first step not yet done, or null when onboarding is complete. */
  nextStep: OnboardingStep | null
  completed: boolean
  agreementVersion: string
}

type ProfileRow = typeof organizerProfiles.$inferSelect

function assertOrganizer(session: Session | null): asserts session is Session {
  if (!session || session.role !== 'ORGANIZER') throw new Error(ONBOARDING_ERRORS.notOrganizer)
}

function stepsDone(row: ProfileRow | undefined): OnboardingStep[] {
  if (!row) return []
  const done: OnboardingStep[] = []
  if (row.firstName && row.lastName && row.contactPhone) done.push('PROFILE')
  if (row.panCiphertext && row.panName) done.push('PAN')
  if (row.hasGstin === false || (row.hasGstin === true && row.gstin)) done.push('GST')
  if (row.upiId && row.upiPhone) done.push('PAYMENT')
  if (row.completedAt) done.push('AGREEMENT')
  return done
}

function toOnboarding(row: ProfileRow | undefined, fallbackName: string | null): OrganizerOnboarding {
  const completedSteps = stepsDone(row)
  // Pre-fill the name step from the name given at signup.
  const [first, ...rest] = (fallbackName ?? '').trim().split(/\s+/)
  return {
    profile: {
      firstName: row?.firstName ?? (first || null),
      lastName: row?.lastName ?? (rest.join(' ') || null),
      contactPhone: row?.contactPhone ?? null,
      panName: row?.panName ?? null,
      panLast4: row?.panLast4 ?? null,
      hasGstin: row?.hasGstin ?? null,
      gstin: row?.gstin ?? null,
      upiId: row?.upiId ?? null,
      upiPhone: row?.upiPhone ?? null,
    },
    completedSteps,
    nextStep: ONBOARDING_STEPS.find((step) => !completedSteps.includes(step)) ?? null,
    completed: Boolean(row?.completedAt),
    agreementVersion: ORGANIZER_AGREEMENT_VERSION,
  }
}

async function loadRow(userId: string): Promise<ProfileRow | undefined> {
  const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, userId)).limit(1)
  return row
}

export async function getOrganizerOnboarding(session: Session | null): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1)
  return toOnboarding(await loadRow(session.userId), user?.name ?? null)
}

/** Whether `userId` has finished onboarding — the gate on applying to host. */
export async function isOrganizerOnboardingComplete(userId: string): Promise<boolean> {
  const row = await loadRow(userId)
  return Boolean(row?.completedAt)
}

/**
 * Loads the row for an edit to `step`: rejects once onboarding is complete,
 * and when an earlier step is still missing.
 */
async function rowForStep(session: Session, step: OnboardingStep): Promise<ProfileRow | undefined> {
  const row = await loadRow(session.userId)
  if (row?.completedAt) throw new Error(ONBOARDING_ERRORS.locked)
  const done = stepsDone(row)
  const earlier = ONBOARDING_STEPS.slice(0, ONBOARDING_STEPS.indexOf(step))
  if (earlier.some((s) => !done.includes(s))) throw new Error(ONBOARDING_ERRORS.outOfOrder)
  return row
}

async function saveRow(userId: string, values: Partial<typeof organizerProfiles.$inferInsert>) {
  const now = new Date()
  await db
    .insert(organizerProfiles)
    .values({ userId, ...values, updatedAt: now })
    .onConflictDoUpdate({ target: organizerProfiles.userId, set: { ...values, updatedAt: now } })
}

function requiredText(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  return trimmed
}

function normalizePhone(value: string, label: string): string {
  const digits = value.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '')
  if (!PHONE_PATTERN.test(digits)) throw new Error(`${label} must be a 10-digit Indian mobile number`)
  return digits
}

export async function saveOrganizerProfileStep(
  input: { firstName: string; lastName: string; contactPhone: string },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'PROFILE')
  const firstName = requiredText(input.firstName, 'First name')
  const lastName = requiredText(input.lastName, 'Last name')
  const contactPhone = normalizePhone(input.contactPhone, 'Contact number')

  await db.transaction(async (tx) => {
    const now = new Date()
    await tx
      .insert(organizerProfiles)
      .values({ userId: session.userId, firstName, lastName, contactPhone, updatedAt: now })
      .onConflictDoUpdate({
        target: organizerProfiles.userId,
        set: { firstName, lastName, contactPhone, updatedAt: now },
      })
    // Keep the account's own name and phone in step with the profile.
    await tx
      .update(users)
      .set({ name: `${firstName} ${lastName}`, phone: contactPhone })
      .where(eq(users.id, session.userId))
  })
  return getOrganizerOnboarding(session)
}

export async function saveOrganizerPanStep(
  input: { panNumber: string; panName: string },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'PAN')
  const panNumber = input.panNumber.replace(/\s/g, '').toUpperCase()
  if (!PAN_PATTERN.test(panNumber)) throw new Error('PAN must look like ABCDE1234F')
  const panName = requiredText(input.panName, 'Name as on PAN')

  await saveRow(session.userId, {
    panName,
    panLast4: panNumber.slice(-4),
    panCiphertext: encryptField(panNumber),
  })
  return getOrganizerOnboarding(session)
}

export async function saveOrganizerGstStep(
  input: { hasGstin: boolean; gstin?: string },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'GST')
  let gstin: string | null = null
  if (input.hasGstin) {
    gstin = (input.gstin ?? '').replace(/\s/g, '').toUpperCase()
    if (!GSTIN_PATTERN.test(gstin)) throw new Error('GSTIN must be a valid 15-character GST number')
  }

  await saveRow(session.userId, { hasGstin: input.hasGstin, gstin })
  return getOrganizerOnboarding(session)
}

export async function saveOrganizerPaymentStep(
  input: { upiId: string; upiPhone: string },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'PAYMENT')
  const upiId = input.upiId.trim()
  if (!UPI_PATTERN.test(upiId)) throw new Error('UPI ID must look like name@bank')
  const upiPhone = normalizePhone(input.upiPhone, 'UPI mobile number')

  await saveRow(session.userId, { upiId: upiId.toLowerCase(), upiPhone })
  return getOrganizerOnboarding(session)
}

/**
 * Final step: records the organizer agreement and completes onboarding, which
 * locks the details above and unlocks the host application.
 */
export async function acceptOrganizerAgreement(
  input: { accepted: boolean },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'AGREEMENT')
  if (!input.accepted) throw new Error('You must accept the organizer agreement to continue')

  const now = new Date()
  await db.transaction(async (tx) => {
    // Conditional on "not yet completed" so a double submit can't record the
    // agreement twice.
    const updated = await tx
      .update(organizerProfiles)
      .set({ completedAt: now, agreementVersion: ORGANIZER_AGREEMENT_VERSION, updatedAt: now })
      .where(and(eq(organizerProfiles.userId, session.userId), isNull(organizerProfiles.completedAt)))
      .returning({ userId: organizerProfiles.userId })
    if (updated.length === 0) throw new Error(ONBOARDING_ERRORS.locked)
    await tx.insert(userConsents).values({
      userId: session.userId,
      consentType: 'ORGANIZER_AGREEMENT',
      policyVersion: ORGANIZER_AGREEMENT_VERSION,
      acceptedAt: now,
    })
  })
  return getOrganizerOnboarding(session)
}
