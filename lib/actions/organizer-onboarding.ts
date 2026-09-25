import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { organizerApplications, organizerProfiles, userConsents, users } from '@/lib/db/schema'
import { submitOrganizerApplication } from '@/lib/actions/organizer-application'
import { encryptField } from '@/lib/crypto/field-encryption'
import type { Session } from '@/lib/auth/adapter'

/**
 * One-time organizer onboarding, done in order after signup:
 *
 *   1. PROFILE    first name, last name, contact number
 *   2. MUN        the MUN's title, host city and expected start date
 *   3. DETAILS    maximum expected delegates, a description, previous
 *                 editions and website (optional)
 *   4. PAYMENT    bank account details payouts go to (account holder name,
 *                 bank name, account number, IFSC — all required), plus an
 *                 optional FreeCharge UPI ID + its linked mobile number
 *   5. AGREEMENT  the organizer agreement — accepting it submits the MUN
 *                 answers as the organizer's application (Gate 1)
 *
 * Accepting the agreement also locks the details: changing where money goes
 * after onboarding has to go through support.
 */

export const ORGANIZER_AGREEMENT_VERSION = '2026-09-17'

export const ONBOARDING_STEPS = ['PROFILE', 'MUN', 'DETAILS', 'PAYMENT', 'AGREEMENT'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const ONBOARDING_ERRORS = {
  locked: 'Your organizer details are already submitted. Contact support to change them.',
  incomplete: 'Finish organizer onboarding before applying to host a MUN',
  outOfOrder: 'Complete the earlier onboarding steps first',
  notOrganizer: 'Forbidden',
} as const

export const MIN_DESCRIPTION_LENGTH = 40
export const MAX_EXPECTED_DELEGATES = 10_000

const PHONE_PATTERN = /^[6-9]\d{9}$/
// MUN Hub only accepts payouts to a FreeCharge UPI handle (@freecharge),
// user-directed restriction — every other UPI provider's handle is rejected.
// UPI itself is optional (2026-09-26) — this only applies once a UPI ID is given.
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@freecharge$/
// Real-world Indian bank account number range.
const BANK_ACCOUNT_PATTERN = /^\d{9,18}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/

export interface OrganizerOnboarding {
  profile: {
    firstName: string | null
    lastName: string | null
    contactPhone: string | null
    /** Shown to delegates as the host. */
    organization: string | null
    munName: string | null
    munCity: string | null
    /** ISO date (YYYY-MM-DD) */
    munStartDate: string | null
    expectedDelegateCount: number | null
    munDescription: string | null
    previousEditions: string | null
    websiteUrl: string | null
    accountHolderName: string | null
    bankName: string | null
    /** Last 4 digits only — the full account number is write-only, never returned. */
    bankAccountLast4: string | null
    ifscCode: string | null
    /** Optional secondary payout address. */
    upiId: string | null
    upiPhone: string | null
  }
  completedSteps: OnboardingStep[]
  /** The first step not yet done, or null when onboarding is complete. */
  nextStep: OnboardingStep | null
  completed: boolean
  /** The MUN created from the wizard's answers, once submitted. */
  firstMunId: string | null
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
  if (row.munName && row.munCity && row.munStartDate) done.push('MUN')
  if (row.expectedDelegateCount && row.munDescription) done.push('DETAILS')
  if (row.accountHolderName && row.bankName && row.bankAccountLast4 && row.ifscCode) done.push('PAYMENT')
  if (row.completedAt) done.push('AGREEMENT')
  return done
}

/** A signup phone in the wizard's 10-digit form, or null if it isn't one. */
function signupPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '')
  return PHONE_PATTERN.test(digits) ? digits : null
}

interface AccountFields {
  name: string | null
  phone: string | null
  institution: string | null
}

function toOnboarding(row: ProfileRow | undefined, account: AccountFields | undefined): OrganizerOnboarding {
  const completedSteps = stepsDone(row)
  // Pre-fill the name and phone from what was given at signup.
  const [first, ...rest] = (account?.name ?? '').trim().split(/\s+/)
  const contactPhone = row?.contactPhone ?? signupPhone(account?.phone)
  return {
    profile: {
      firstName: row?.firstName ?? (first || null),
      lastName: row?.lastName ?? (rest.join(' ') || null),
      contactPhone,
      organization: account?.institution?.trim() || null,
      munName: row?.munName ?? null,
      munCity: row?.munCity ?? null,
      munStartDate: row?.munStartDate ? row.munStartDate.toISOString().slice(0, 10) : null,
      expectedDelegateCount: row?.expectedDelegateCount ?? null,
      munDescription: row?.munDescription ?? null,
      previousEditions: row?.previousEditions ?? null,
      websiteUrl: row?.websiteUrl ?? null,
      accountHolderName: row?.accountHolderName ?? null,
      bankName: row?.bankName ?? null,
      bankAccountLast4: row?.bankAccountLast4 ?? null,
      ifscCode: row?.ifscCode ?? null,
      upiId: row?.upiId ?? null,
      // Most organizers take payouts on the number they gave us.
      upiPhone: row?.upiPhone ?? contactPhone ?? null,
    },
    completedSteps,
    nextStep: ONBOARDING_STEPS.find((step) => !completedSteps.includes(step)) ?? null,
    completed: Boolean(row?.completedAt),
    firstMunId: row?.firstMunId ?? null,
    agreementVersion: ORGANIZER_AGREEMENT_VERSION,
  }
}

async function loadRow(userId: string): Promise<ProfileRow | undefined> {
  const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, userId)).limit(1)
  return row
}

export async function getOrganizerOnboarding(session: Session | null): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  const [user] = await db
    .select({ name: users.name, phone: users.phone, institution: users.institution })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)
  return toOnboarding(await loadRow(session.userId), user)
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

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null
}

function normalizePhone(value: string, label: string): string {
  const digits = value.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '')
  if (!PHONE_PATTERN.test(digits)) throw new Error(`${label} must be a 10-digit Indian mobile number`)
  return digits
}

export const MAX_ORGANIZATION_LENGTH = 120

export async function saveOrganizerProfileStep(
  input: {
    firstName: string
    lastName: string
    contactPhone: string
    /** The school, college or society hosting the MUN; shown to delegates as the host. */
    organization?: string
  },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'PROFILE')
  const firstName = requiredText(input.firstName, 'First name')
  const lastName = requiredText(input.lastName, 'Last name')
  const contactPhone = normalizePhone(input.contactPhone, 'Contact number')
  const organization = input.organization === undefined ? undefined : requiredText(input.organization, 'Organization')
  if (organization && organization.length > MAX_ORGANIZATION_LENGTH) {
    throw new Error(`Organization must be at most ${MAX_ORGANIZATION_LENGTH} characters`)
  }

  await db.transaction(async (tx) => {
    const now = new Date()
    await tx
      .insert(organizerProfiles)
      .values({ userId: session.userId, firstName, lastName, contactPhone, updatedAt: now })
      .onConflictDoUpdate({
        target: organizerProfiles.userId,
        set: { firstName, lastName, contactPhone, updatedAt: now },
      })
    // Keep the account's own name and phone in step with the profile. The
    // organization lives on the account too (users.institution), where the
    // marketplace reads the host name from.
    await tx
      .update(users)
      .set({
        name: `${firstName} ${lastName}`,
        phone: contactPhone,
        ...(organization !== undefined ? { institution: organization } : {}),
      })
      .where(eq(users.id, session.userId))
  })
  return getOrganizerOnboarding(session)
}

/**
 * Changes the organization delegates see as the host, at any time (also after
 * onboarding is complete). An empty value clears it, so the organizer's own
 * name is shown instead.
 */
export async function updateOrganizerOrganization(
  organization: string,
  session: Session | null,
): Promise<{ organization: string | null }> {
  assertOrganizer(session)
  const value = organization.trim() || null
  if (value && value.length > MAX_ORGANIZATION_LENGTH) {
    throw new Error(`Organization must be at most ${MAX_ORGANIZATION_LENGTH} characters`)
  }
  await db.update(users).set({ institution: value }).where(eq(users.id, session.userId))
  return { organization: value }
}

export async function saveOrganizerMunStep(
  input: { munName: string; munCity: string; munStartDate: string },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'MUN')
  const munName = requiredText(input.munName, 'MUN title')
  const munCity = requiredText(input.munCity, 'Host city')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.munStartDate.trim())) {
    throw new Error('Expected start date must be a valid date')
  }
  const munStartDate = new Date(`${input.munStartDate.trim()}T00:00:00.000Z`)
  if (Number.isNaN(munStartDate.getTime())) throw new Error('Expected start date must be a valid date')

  await saveRow(session.userId, { munName, munCity, munStartDate })
  return getOrganizerOnboarding(session)
}

export async function saveOrganizerDetailsStep(
  input: { expectedDelegateCount: number; munDescription: string; previousEditions?: string; websiteUrl?: string },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'DETAILS')
  const count = input.expectedDelegateCount
  if (!Number.isInteger(count) || count < 1 || count > MAX_EXPECTED_DELEGATES) {
    throw new Error(`Maximum expected delegates must be a whole number from 1 to ${MAX_EXPECTED_DELEGATES}`)
  }
  const munDescription = requiredText(input.munDescription, 'Description')
  if (munDescription.length < MIN_DESCRIPTION_LENGTH) {
    throw new Error(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`)
  }
  const websiteUrl = optionalText(input.websiteUrl)
  if (websiteUrl) {
    let protocol = ''
    try {
      protocol = new URL(websiteUrl).protocol
    } catch {
      // handled below
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error('Website must be a full URL, including https://')
    }
  }

  await saveRow(session.userId, {
    expectedDelegateCount: count,
    munDescription,
    previousEditions: optionalText(input.previousEditions),
    websiteUrl,
  })
  return getOrganizerOnboarding(session)
}

export interface SaveOrganizerPaymentStepInput {
  accountHolderName: string
  bankName: string
  bankAccountNumber: string
  ifscCode: string
  /** Optional secondary payout address — a FreeCharge UPI handle. */
  upiId?: string
  /** Required alongside upiId, and only alongside upiId. */
  upiPhone?: string
}

/**
 * Bank account details are the required payout method (2026-09-26 — reverses
 * the earlier UPI-only design, see CLAUDE.md). The account number is never
 * stored in plaintext: it's encrypted here via lib/crypto/field-encryption.ts
 * (the same write-only pattern lib/actions/payment-settlement.ts uses for
 * mun_payment_settings) and only its last 4 digits are kept for display.
 * There is deliberately no decrypt-and-return path anywhere in this action.
 *
 * UPI stays a secondary, optional receiving address: omit both upiId and
 * upiPhone, or give both together — one without the other is rejected.
 */
export async function saveOrganizerPaymentStep(
  input: SaveOrganizerPaymentStepInput,
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'PAYMENT')

  const accountHolderName = requiredText(input.accountHolderName, 'Account holder name')
  const bankName = requiredText(input.bankName, 'Bank name')
  const bankAccountNumber = requiredText(input.bankAccountNumber, 'Account number').replace(/\s+/g, '')
  if (!BANK_ACCOUNT_PATTERN.test(bankAccountNumber)) {
    throw new Error('Account number must be 9 to 18 digits')
  }
  const ifscCode = requiredText(input.ifscCode, 'IFSC code').toUpperCase()
  if (!IFSC_PATTERN.test(ifscCode)) throw new Error('IFSC code must look like HDFC0001234')

  const upiIdRaw = input.upiId?.trim()
  let upiId: string | null = null
  let upiPhone: string | null = null
  if (upiIdRaw) {
    if (!UPI_PATTERN.test(upiIdRaw)) throw new Error('Only a FreeCharge UPI ID is accepted — it must look like name@freecharge')
    if (!input.upiPhone?.trim()) throw new Error('Mobile number linked to the UPI ID is required')
    upiId = upiIdRaw.toLowerCase()
    upiPhone = normalizePhone(input.upiPhone, 'UPI mobile number')
  } else if (input.upiPhone?.trim()) {
    throw new Error('Enter a UPI ID before its linked mobile number')
  }

  await saveRow(session.userId, {
    accountHolderName,
    bankName,
    bankAccountNumberCiphertext: encryptField(bankAccountNumber),
    bankAccountLast4: bankAccountNumber.slice(-4),
    ifscCode,
    upiId,
    upiPhone,
  })
  return getOrganizerOnboarding(session)
}

/**
 * Final step: records the organizer agreement, submits the wizard's MUN
 * answers as the organizer's application (unless they already have one), and
 * completes onboarding, which locks the details above.
 */
export async function acceptOrganizerAgreement(
  input: { accepted: boolean },
  session: Session | null,
): Promise<OrganizerOnboarding> {
  assertOrganizer(session)
  await rowForStep(session, 'AGREEMENT')
  if (!input.accepted) throw new Error('You must accept the organizer agreement to continue')

  await db.transaction(async (tx) => {
    // Row lock: a double submit waits here, then finds onboarding completed,
    // so it can't create a second application.
    const [row] = await tx
      .select()
      .from(organizerProfiles)
      .where(eq(organizerProfiles.userId, session.userId))
      .for('update')
    if (!row || row.completedAt) throw new Error(ONBOARDING_ERRORS.locked)

    const [existing] = await db
      .select({ munId: organizerApplications.munId })
      .from(organizerApplications)
      .where(eq(organizerApplications.organizerId, session.userId))
      .limit(1)

    let firstMunId = existing?.munId ?? null
    if (!existing) {
      const application = await submitOrganizerApplication({
        organizerId: session.userId,
        conferenceName: row.munName!,
        location: row.munCity!,
        expectedDate: row.munStartDate!,
        expectedDelegateCount: row.expectedDelegateCount!,
        description: row.munDescription!,
        previousEditions: row.previousEditions ?? undefined,
        websiteUrl: row.websiteUrl ?? undefined,
      })
      firstMunId = application.munId
    }

    const now = new Date()
    const updated = await tx
      .update(organizerProfiles)
      .set({ completedAt: now, agreementVersion: ORGANIZER_AGREEMENT_VERSION, firstMunId, updatedAt: now })
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
