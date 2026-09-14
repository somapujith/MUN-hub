import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
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

// -----------------------------------------------------------------------------
// Task 12 Step 5 — notification-wiring proof for go-live.ts.
//
// A dedicated file (rather than growing the already-800-line go-live.test.ts
// further) that spies on `notifyPipelineEvent` via `vi.mock` and proves it is
// actually CALLED with the right event type at submitMunForReview's success
// path and publishFromQueue's success (non-replay) path — the two cases the
// task brief calls out as the clearest "this must actually fire" checks.
// -----------------------------------------------------------------------------

const notifyPipelineEventMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/notifications/pipeline-events', () => ({
  notifyPipelineEvent: (...args: unknown[]) => notifyPipelineEventMock(...args),
}))

// Imported AFTER the mock is declared (vi.mock is hoisted by vitest, but the
// import itself must still come after for clarity of intent here).
const { submitMunForReview, reviewSubmission, enqueueForGoLive, publishFromQueue } = await import('./go-live')
const { submitFinalConfirmation } = await import('./organizer-confirmation')

async function makeUser(role: 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

/** Same shape as go-live.test.ts's makeCompleteMun fixture — kept in sync deliberately. */
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
      name: 'Notify Test Mun',
      slug: `notify-test-mun-${crypto.randomUUID()}`,
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
    officialEmail: 'contact@notifytest.test',
    phone: '+911234567890',
    contactPersonName: 'Jane Organizer',
    contactPersonEmail: 'jane@notifytest.test',
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
    authorizedRepEmail: 'rep@notifytest.test',
    accountHolderName: 'Test Org',
    bankName: 'Test Bank',
    accountNumberLast4: '5678',
    accountNumberCiphertext: 'ciphertext-not-real',
    ifsc: 'TEST0001234',
    accountType: 'current',
    gateway: 'razorpay',
    verificationState: 'VERIFIED',
    verifiedAt: new Date(),
  })

  return mun
}

/** Polls until the fire-and-forget notification promise chain has had a chance to settle. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('go-live.ts pipeline notification wiring', () => {
  afterEach(() => {
    notifyPipelineEventMock.mockClear()
  })

  it('submitMunForReview success path fires SUBMISSION_RECEIVED and NEW_SUBMISSION after commit', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeCompleteMun(organizer.id)

    const result = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.passed).toBe(true)

    await flushMicrotasks()

    const eventTypes = notifyPipelineEventMock.mock.calls.map((call) => (call[0] as { type: string }).type)
    expect(eventTypes).toContain('SUBMISSION_RECEIVED')
    expect(eventTypes).toContain('NEW_SUBMISSION')

    const submissionReceivedCall = notifyPipelineEventMock.mock.calls.find(
      (call) => (call[0] as { type: string }).type === 'SUBMISSION_RECEIVED',
    )
    expect(submissionReceivedCall?.[0]).toMatchObject({ type: 'SUBMISSION_RECEIVED', munId: mun.id })
  })

  it('submitMunForReview does NOT notify on the automated-validation-failure path', async () => {
    const organizer = await makeUser('ORGANIZER')
    const [bareMun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Incomplete Mun', slug: `incomplete-mun-${crypto.randomUUID()}`, status: 'ONBOARDING' })
      .returning()

    const result = await submitMunForReview(bareMun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.passed).toBe(false)

    await flushMicrotasks()

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })

  it('reviewSubmission APPROVED fires an APPROVED event', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await flushMicrotasks()

    const approvedCall = notifyPipelineEventMock.mock.calls.find((call) => (call[0] as { type: string }).type === 'APPROVED')
    expect(approvedCall?.[0]).toMatchObject({ type: 'APPROVED', munId: mun.id })
  })

  it('reviewSubmission CHANGES_REQUESTED fires a CHANGES_REQUESTED event with the notes as reason', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'CHANGES_REQUESTED', { notes: 'Fix the venue address' }, { userId: admin.id, role: 'ADMIN' })
    await flushMicrotasks()

    const call = notifyPipelineEventMock.mock.calls.find((c) => (c[0] as { type: string }).type === 'CHANGES_REQUESTED')
    expect(call?.[0]).toMatchObject({ type: 'CHANGES_REQUESTED', munId: mun.id, reason: 'Fix the venue address' })
  })

  it('reviewSubmission REJECTED fires the CHANGES_REQUESTED-shaped event with the rejection reason (documented fallback — see go-live.ts docstring)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'REJECTED', { reason: 'Fabricated committee list' }, { userId: admin.id, role: 'ADMIN' })
    await flushMicrotasks()

    const call = notifyPipelineEventMock.mock.calls.find((c) => (c[0] as { type: string }).type === 'CHANGES_REQUESTED')
    expect(call?.[0]).toMatchObject({ reason: 'Fabricated committee list' })
  })

  it('publishFromQueue success (non-replay) path fires PUBLISHED with a publicUrl', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })
    notifyPipelineEventMock.mockClear()

    const result = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(result.replay).toBe(false)

    await flushMicrotasks()

    const call = notifyPipelineEventMock.mock.calls.find((c) => (c[0] as { type: string }).type === 'PUBLISHED')
    expect(call?.[0]).toMatchObject({ type: 'PUBLISHED', munId: mun.id })
    expect((call?.[0] as { publicUrl: string }).publicUrl).toContain(`/mun/${mun.slug}`)
  })

  it('publishFromQueue replay does NOT re-fire PUBLISHED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })
    await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    await flushMicrotasks()
    notifyPipelineEventMock.mockClear()

    const replayResult = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(replayResult.replay).toBe(true)

    await flushMicrotasks()

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await db.$client.end()
})
