import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import {
  muns,
  users,
  organizerConfirmations,
  committees,
  portfolios,
  registrationProducts,
  munExecutiveBoard,
  munContacts,
  munMedia,
  munDocuments,
  munScheduleItems,
  munPaymentSettings,
  organizerApplications,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { submitFinalConfirmation } from './organizer-confirmation'

async function makeUser(role: 'ORGANIZER' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

/** A bare mun in CONTENT_SUBMITTED with no module data — fails re-validation. */
async function makeBareMun(organizerId: string, status: 'CONTENT_SUBMITTED' | 'DRAFT' = 'CONTENT_SUBMITTED') {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Confirm Mun', slug: `confirm-mun-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

/**
 * A mun with every module's backing data seeded to pass SUBMIT-stage
 * validation, created directly in the given status — mirrors go-live.test.ts's
 * `makeCompleteMun` fixture (itself mirroring validation.test.ts's proven
 * `makeMunPendingPaymentOnly` shape), since `submitFinalConfirmation` now
 * re-runs `validateMunForSubmission` and needs a genuinely-complete mun to
 * exercise its success path.
 */
async function makeCompleteMun(organizerId: string, status: 'CONTENT_SUBMITTED' | 'ORGANIZER_CONFIRMATION') {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000)
  const opensAt = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
  const deadline = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000)

  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Complete Confirm Mun',
      slug: `complete-confirm-mun-${crypto.randomUUID()}`,
      status,
      description: 'A mun seeded complete enough to pass SUBMIT-stage validation end to end.',
      edition: '2027',
      startDate: start,
      endDate: end,
      venue: 'Grand Hall',
      addressLine1: '123 Diplomat Ave',
      city: 'Hyderabad',
      country: 'India',
      registrationOpensAt: opensAt,
      registrationDeadline: deadline,
      accommodationProvided: 'NOT_PROVIDED',
    })
    .returning()

  await db.insert(organizerApplications).values({ organizerId, munId: mun.id, status: 'APPROVED' })

  const [committee] = await db
    .insert(committees)
    .values({ munId: mun.id, name: 'UNSC', agenda: 'Maintaining peace and security', capacity: 20 })
    .returning()

  await db.insert(portfolios).values({ committeeId: committee.id, name: 'United States', availability: 1 })
  await db.insert(munExecutiveBoard).values({ munId: mun.id, committeeId: committee.id, name: 'Chair One', role: 'CHAIR' })
  await db.insert(registrationProducts).values({ munId: mun.id, name: 'Standard', price: 1000, capacity: 20, status: 'active', deadline })
  await db.insert(munContacts).values({
    munId: mun.id,
    officialEmail: 'contact@confirmtest.test',
    phone: '+911234567890',
    contactPersonName: 'Jane Organizer',
    contactPersonEmail: 'jane@confirmtest.test',
  })
  await db.insert(munMedia).values([
    { munId: mun.id, kind: 'LOGO', url: 'https://example.com/logo.png', storageKey: 'logo', contentType: 'image/png', sizeBytes: 100 },
    { munId: mun.id, kind: 'COVER', url: 'https://example.com/cover.png', storageKey: 'cover', contentType: 'image/png', sizeBytes: 100 },
  ])
  await db.insert(munDocuments).values([
    { munId: mun.id, kind: 'RULES', title: 'Rules', url: 'https://example.com/rules.pdf', storageKey: 'rules', contentType: 'application/pdf', sizeBytes: 100 },
    { munId: mun.id, kind: 'CODE_OF_CONDUCT', title: 'CoC', url: 'https://example.com/coc.pdf', storageKey: 'coc', contentType: 'application/pdf', sizeBytes: 100 },
    { munId: mun.id, kind: 'REFUND_POLICY', title: 'Refund', url: 'https://example.com/refund.pdf', storageKey: 'refund', contentType: 'application/pdf', sizeBytes: 100 },
  ])
  await db.insert(munScheduleItems).values({
    munId: mun.id,
    title: 'Opening Ceremony',
    kind: 'OPENING_CEREMONY',
    startsAt: start,
    endsAt: new Date(start.getTime() + 60 * 60 * 1000),
  })
  await db.insert(munPaymentSettings).values({
    munId: mun.id,
    legalName: 'Test Org',
    orgType: 'NGO',
    addressLine1: 'Addr',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    panLast4: '1234',
    panCiphertext: 'ciphertext-not-real',
    authorizedRepName: 'Rep',
    authorizedRepEmail: 'rep@confirmtest.test',
    accountHolderName: 'Test Org',
    bankName: 'Test Bank',
    accountNumberLast4: '5678',
    accountNumberCiphertext: 'ciphertext-not-real',
    ifsc: 'TEST0001234',
    accountType: 'current',
    gateway: 'razorpay',
    verificationState: 'PENDING',
  })

  return { mun, committee }
}

describe('submitFinalConfirmation', () => {
  it('creates a confirmation snapshot and moves the mun to VERIFICATION from CONTENT_SUBMITTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const { mun } = await makeCompleteMun(organizer.id, 'CONTENT_SUBMITTED')

    const result = await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.status).toBe('VERIFICATION')

    const [confirmation] = await db.select().from(organizerConfirmations).where(eq(organizerConfirmations.munId, mun.id))
    expect(confirmation.confirmingUserId).toBe(organizer.id)
    expect(confirmation.versionNumber).toBe(1)
    expect(confirmation.snapshotJson).toBeTruthy()
    // Widened snapshot (Task 10) covers all 15 tracked modules' data, not
    // just the slice-1 4-table subset.
    const snapshot = confirmation.snapshotJson as Record<string, unknown>
    expect(snapshot.media).toBeTruthy()
    expect(snapshot.executiveBoard).toBeTruthy()
    expect(snapshot.paymentSettings).toBeTruthy()
    expect(snapshot.documents).toBeTruthy()
    expect(snapshot.scheduleItems).toBeTruthy()
    expect(snapshot.contact).toBeTruthy()
    expect(snapshot.accommodationOptions).toBeTruthy()
  })

  it('does not leak payment ciphertext columns into the snapshot', async () => {
    const organizer = await makeUser('ORGANIZER')
    const { mun } = await makeCompleteMun(organizer.id, 'CONTENT_SUBMITTED')

    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })

    const [confirmation] = await db.select().from(organizerConfirmations).where(eq(organizerConfirmations.munId, mun.id))
    const snapshot = confirmation.snapshotJson as { paymentSettings: Record<string, unknown> }
    expect(snapshot.paymentSettings).not.toHaveProperty('panCiphertext')
    expect(snapshot.paymentSettings).not.toHaveProperty('accountNumberCiphertext')
  })

  it('accepts ORGANIZER_CONFIRMATION as a starting status and skips the redundant transition', async () => {
    const organizer = await makeUser('ORGANIZER')
    const { mun } = await makeCompleteMun(organizer.id, 'ORGANIZER_CONFIRMATION')

    const result = await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.status).toBe('VERIFICATION')
  })

  it('rejects a mun not in CONTENT_SUBMITTED or ORGANIZER_CONFIRMATION status', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeBareMun(organizer.id, 'DRAFT')

    await expect(submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow()
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const { mun } = await makeCompleteMun(owner.id, 'CONTENT_SUBMITTED')

    await expect(submitFinalConfirmation(mun.id, { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  it('rejects confirmation when a bare (never-complete) mun is in CONTENT_SUBMITTED — validation fails up front', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeBareMun(organizer.id, 'CONTENT_SUBMITTED')

    await expect(submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow(
      /validation now fails/,
    )
  })

  it('blocks confirmation when validation regresses between submit and confirm (a required committee is deleted)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const { mun, committee } = await makeCompleteMun(organizer.id, 'CONTENT_SUBMITTED')

    // Simulate the exact attack this re-validation exists to stop: the mun
    // passed validation once (that's how it got to CONTENT_SUBMITTED via
    // submitMunForReview in the real flow), then the organizer breaks a
    // required field before calling submitFinalConfirmation. Deleting the
    // only committee removes both COMMITTEES' and PORTFOLIOS' backing data —
    // the executive board row referencing it must go first (no cascade on
    // that FK).
    await db.delete(munExecutiveBoard).where(eq(munExecutiveBoard.committeeId, committee.id))
    await db.delete(committees).where(eq(committees.id, committee.id))

    await expect(submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow(
      /validation now fails/,
    )

    // Confirmation must not have been recorded, and the mun must not have moved.
    const confirmations = await db.select().from(organizerConfirmations).where(eq(organizerConfirmations.munId, mun.id))
    expect(confirmations.length).toBe(0)

    const [unchanged] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(unchanged.status).toBe('CONTENT_SUBMITTED')
  })
})

afterAll(async () => {
  await db.$client.end()
})
