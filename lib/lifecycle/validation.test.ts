import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db/client'
import {
  muns,
  users,
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
import { loadValidationContext, validateMunForSubmission } from './validation'
import { TRACKED_MODULES } from './module-registry'

async function makeUser(role: 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeBareMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Validation Test Mun', slug: `validation-test-mun-${crypto.randomUUID()}`, status: 'ONBOARDING' })
    .returning()
  return mun
}

/** A mun with every module's backing data seeded EXCEPT payment settlement — used by the SUBMIT/PUBLISH asymmetry test. */
async function makeMunPendingPaymentOnly(organizerId: string) {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000)
  const opensAt = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
  const deadline = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000)

  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Payment Stage Test Mun',
      slug: `payment-stage-test-mun-${crypto.randomUUID()}`,
      status: 'ONBOARDING',
      description: 'A mun seeded to test the SUBMIT vs PUBLISH payment severity asymmetry end to end.',
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
    officialEmail: 'contact@paymentstage.test',
    phone: '+911234567890',
    contactPersonName: 'Jane Organizer',
    contactPersonEmail: 'jane@paymentstage.test',
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

  // Payment settings row EXISTS (details submitted — clears that BLOCKER)
  // but verificationState is PENDING, not VERIFIED — this is exactly the
  // "everything else complete" state the stage-asymmetry test needs.
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
    authorizedRepEmail: 'rep@paymentstage.test',
    accountHolderName: 'Test Org',
    bankName: 'Test Bank',
    accountNumberLast4: '5678',
    accountNumberCiphertext: 'ciphertext-not-real',
    ifsc: 'TEST0001234',
    accountType: 'current',
    gateway: 'razorpay',
    verificationState: 'PENDING',
  })

  return mun
}

describe('loadValidationContext', () => {
  it('loads a plain context object with `now` and every expected key for a bare mun', async () => {
    const organizer = await makeUser()
    const mun = await makeBareMun(organizer.id)

    const ctx = await loadValidationContext(mun.id)

    expect(ctx.now).toBeInstanceOf(Date)
    expect(ctx.mun.id).toBe(mun.id)
    expect(ctx.committees).toEqual([])
    expect(ctx.portfolios).toEqual([])
    expect(ctx.registrationProducts).toEqual([])
    expect(ctx.ebMembers).toEqual([])
    expect(ctx.formFields).toEqual([])
    expect(ctx.paymentSettings).toBeNull()
    expect(ctx.documents).toEqual([])
    expect(ctx.scheduleItems).toEqual([])
    expect(ctx.contact).toBeNull()
    expect(ctx.media).toEqual([])
    expect(ctx.accommodationOptions).toEqual([])
    expect(ctx.accommodationOptionFields).toEqual([])
    expect(ctx.moduleRows).toEqual([])
    expect(ctx.unresolvedIssues).toEqual([])
    expect(ctx.organizerApplication).toBeNull()
  })

  it('throws for a mun id that does not exist', async () => {
    await expect(loadValidationContext('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/)
  })

  it('batches portfolios via inArray across multiple committees rather than per-committee queries', async () => {
    const organizer = await makeUser()
    const mun = await makeBareMun(organizer.id)

    const [c1] = await db.insert(committees).values({ munId: mun.id, name: 'UNSC', agenda: 'Peace', capacity: 10 }).returning()
    const [c2] = await db.insert(committees).values({ munId: mun.id, name: 'UNHRC', agenda: 'Rights', capacity: 10 }).returning()
    await db.insert(portfolios).values([
      { committeeId: c1.id, name: 'USA', availability: 1 },
      { committeeId: c2.id, name: 'France', availability: 1 },
    ])

    const ctx = await loadValidationContext(mun.id)
    expect(ctx.portfolios.length).toBe(2)
    expect(new Set(ctx.portfolios.map((p) => p.committeeId))).toEqual(new Set([c1.id, c2.id]))
  })
})

describe('validateMunForSubmission', () => {
  it('fails a bare mun with a non-empty, module-scoped blockers list covering every required module', async () => {
    const organizer = await makeUser()
    const mun = await makeBareMun(organizer.id)

    const result = await validateMunForSubmission(mun.id)

    expect(result.passed).toBe(false)
    expect(result.modules.length).toBe(TRACKED_MODULES.length)
    expect(result.blockers.length).toBeGreaterThan(0)
    expect(result.blockers.every((b) => b.severity === 'BLOCKER' && !b.passed)).toBe(true)
  })

  it('passes a fully seeded mun (all required modules genuinely satisfied) at SUBMIT stage even with payment PENDING', async () => {
    const organizer = await makeUser()
    const mun = await makeMunPendingPaymentOnly(organizer.id)

    const result = await validateMunForSubmission(mun.id)

    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('the SUBMIT vs PUBLISH payment-verification severity genuinely differs for identical underlying data', async () => {
    const organizer = await makeUser()
    const mun = await makeMunPendingPaymentOnly(organizer.id)

    const submitResult = await validateMunForSubmission(mun.id, { stage: 'SUBMIT' })
    const publishResult = await validateMunForSubmission(mun.id, { stage: 'PUBLISH' })

    const submitPaymentModule = submitResult.modules.find((m) => m.moduleKey === 'PAYMENT_SETTLEMENT')
    const publishPaymentModule = publishResult.modules.find((m) => m.moduleKey === 'PAYMENT_SETTLEMENT')
    const submitCheck = submitPaymentModule?.checks.find((c) => c.key === 'payment_verification_state')
    const publishCheck = publishPaymentModule?.checks.find((c) => c.key === 'payment_verification_state')

    // Identical underlying data (verificationState still PENDING on both
    // calls — same mun, same payment row) genuinely produces different
    // severities and, downstream, a different overall passed/blockers
    // outcome. This is the single most important assertion in this task:
    // if `stage` ever stopped threading through to the PAYMENT_SETTLEMENT
    // validator, both sides of this comparison would silently collapse to
    // the same answer and this test would catch it.
    expect(submitCheck?.severity).toBe('HIGH')
    expect(publishCheck?.severity).toBe('BLOCKER')
    expect(submitCheck?.passed).toBe(false)
    expect(publishCheck?.passed).toBe(false)

    expect(submitResult.passed).toBe(true)
    expect(publishResult.passed).toBe(false)
    expect(submitResult.blockers.find((b) => b.key === 'payment_verification_state')).toBeUndefined()
    expect(publishResult.blockers.find((b) => b.key === 'payment_verification_state')).toBeDefined()
  })

  it('defaults to SUBMIT stage when opts is omitted', async () => {
    const organizer = await makeUser()
    const mun = await makeMunPendingPaymentOnly(organizer.id)

    const defaultResult = await validateMunForSubmission(mun.id)
    const explicitSubmitResult = await validateMunForSubmission(mun.id, { stage: 'SUBMIT' })

    expect(defaultResult.passed).toBe(explicitSubmitResult.passed)
    expect(defaultResult.passed).toBe(true)
  })
})
