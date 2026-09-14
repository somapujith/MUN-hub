import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
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
  munSubmissions,
  verificationIssues,
} from '@/lib/db/schema'
import { submitMunForReview } from './go-live'

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
    .values({ organizerId, name: 'Go-Live Test Mun', slug: `go-live-test-mun-${crypto.randomUUID()}`, status: 'ONBOARDING' })
    .returning()
  return mun
}

/**
 * A mun with every module's backing data seeded to pass SUBMIT-stage
 * validation — mirrors lib/lifecycle/validation.test.ts's
 * `makeMunPendingPaymentOnly` fixture exactly (that file already proves this
 * shape passes `validateMunForSubmission` at the SUBMIT stage), since this
 * task needs its own "genuinely complete" mun to drive `submitMunForReview`
 * to its success path.
 */
async function makeCompleteMun(organizerId: string) {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000)
  const opensAt = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
  const deadline = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000)

  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Complete Go-Live Mun',
      slug: `complete-go-live-mun-${crypto.randomUUID()}`,
      status: 'ONBOARDING',
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
    officialEmail: 'contact@golivetest.test',
    phone: '+911234567890',
    contactPersonName: 'Jane Organizer',
    contactPersonEmail: 'jane@golivetest.test',
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
    authorizedRepEmail: 'rep@golivetest.test',
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

describe('submitMunForReview', () => {
  it('fails an incomplete mun: returns blockers, ends in ACTION_REQUIRED, writes AUTOMATED issue rows', async () => {
    const organizer = await makeUser()
    const mun = await makeBareMun(organizer.id)

    const result = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })

    expect(result.passed).toBe(false)
    expect(result.blockers.length).toBeGreaterThan(0)
    expect(result.submissionId).toBeUndefined()

    const [updated] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(updated.status).toBe('ACTION_REQUIRED')

    const issues = await db
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.source, 'AUTOMATED')))
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((issue) => issue.resolved === false)).toBe(true)

    const submissions = await db.select().from(munSubmissions).where(eq(munSubmissions.munId, mun.id))
    expect(submissions.length).toBe(0)
  })

  it('a resubmission resolves prior AUTOMATED issues before writing new ones (no accumulation)', async () => {
    const organizer = await makeUser()
    const mun = await makeBareMun(organizer.id)

    const first = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(first.passed).toBe(false)

    const afterFirst = await db
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.source, 'AUTOMATED')))
    const firstCount = afterFirst.length
    expect(firstCount).toBeGreaterThan(0)

    // Resubmit without fixing anything — status is now ACTION_REQUIRED, a
    // submittable status.
    const second = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(second.passed).toBe(false)

    const allIssues = await db
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.source, 'AUTOMATED')))
    const unresolved = allIssues.filter((issue) => !issue.resolved)
    const resolved = allIssues.filter((issue) => issue.resolved)

    // Prior round's rows got resolved, not deleted — total rows across both
    // rounds, but only the second round's rows remain unresolved.
    expect(resolved.length).toBe(firstCount)
    expect(unresolved.length).toBe(second.blockers.length)
  })

  it('succeeds for a complete mun: returns passed, opens a submission row with a future SLA deadline in ON_TRACK state', async () => {
    const organizer = await makeUser()
    const mun = await makeCompleteMun(organizer.id)

    const beforeSubmit = new Date()
    const result = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })

    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.submissionId).toBeTruthy()

    const [updated] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(updated.status).toBe('ORGANIZER_CONFIRMATION')

    const [submission] = await db.select().from(munSubmissions).where(eq(munSubmissions.id, result.submissionId!)).limit(1)
    expect(submission).toBeTruthy()
    expect(submission.status).toBe('SUBMITTED')
    expect(submission.slaState).toBe('ON_TRACK')
    expect(submission.slaDeadline.getTime()).toBeGreaterThan(beforeSubmit.getTime())
    // One business day out is at most 4 calendar days away (covers a Friday
    // submission landing the following Monday) — a loose but meaningful
    // upper bound so this doesn't assert exact business-day math (sla.test.ts
    // already covers that in detail).
    expect(submission.slaDeadline.getTime() - beforeSubmit.getTime()).toBeLessThanOrEqual(4 * 24 * 60 * 60 * 1000)
  })

  it('rejects a non-owning organizer with Forbidden', async () => {
    const owner = await makeUser()
    const outsider = await makeUser()
    const mun = await makeBareMun(owner.id)

    await expect(submitMunForReview(mun.id, { userId: outsider.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  it('rejects an unauthenticated caller with Forbidden', async () => {
    const owner = await makeUser()
    const mun = await makeBareMun(owner.id)

    await expect(submitMunForReview(mun.id, null)).rejects.toThrow('Forbidden')
  })

  it('two concurrent submitMunForReview calls on the same complete mun produce exactly one mun_submissions row', async () => {
    const organizer = await makeUser()
    const mun = await makeCompleteMun(organizer.id)

    const results = await Promise.allSettled([
      submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' }),
      submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' }),
      submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof submitMunForReview>>
    >[]
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]

    // Exactly one caller gets to actually create the submission; the mun row
    // lock serializes the rest, and each of those either fails the
    // already-CONTENT_SUBMITTED/ORGANIZER_CONFIRMATION status precondition or
    // hits the friendly "already has an active submission" pre-check or the
    // partial-unique-index constraint itself — any of those is an acceptable
    // rejection reason. `fulfilled.length + rejected.length === 3` alone is
    // a tautology (every settled promise is one or the other, regardless of
    // distribution) — assert the actual 1/2 split explicitly so a regression
    // where the row lock stops serializing (e.g. all 3 fulfill, or all 3
    // reject) is caught here directly, not just indirectly via the final row
    // count below.
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(2)

    expect(fulfilled[0].value.passed).toBe(true)
    expect(fulfilled[0].value.submissionId).toBeTruthy()

    for (const failure of rejected) {
      expect(String(failure.reason)).toMatch(/already has an active submission|Cannot submit mun for review|Invalid transition|duplicate key|unique constraint/i)
    }

    const submissions = await db.select().from(munSubmissions).where(eq(munSubmissions.munId, mun.id))
    expect(submissions.length).toBe(1)
    expect(submissions[0].id).toBe(fulfilled[0].value.submissionId)
  })
})

afterAll(async () => {
  await db.$client.end()
})
