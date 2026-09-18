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
  munSubmissions,
  organizerApplications,
  organizerProfiles,
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
const { onModuleDataChanged } = await import('./module-completion')

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
  await db
    .insert(organizerProfiles)
    .values({ userId: organizerId, upiId: 'organizer@upi', upiPhone: '9000000000' })
    .onConflictDoUpdate({ target: organizerProfiles.userId, set: { upiId: 'organizer@upi' } })

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

/**
 * Polls `notifyPipelineEventMock`'s call count instead of guessing a fixed
 * sleep duration.
 *
 * Root-cause fix (2026-09-15, post-review): the original helper was
 * `await new Promise(r => setTimeout(r, 20))` — a hardcoded 20ms bet on how
 * long the fire-and-forget `notifyAfterCommit` call (real DB queries to
 * resolve admin emails / mun context, then `notifyPipelineEvent`) takes to
 * land. Under full-suite load (more concurrent DB connections and event-loop
 * contention than running this file alone) that budget was not always
 * enough — a PREVIOUS test's still-in-flight notification promise would
 * resolve late, landing its call into the mock during the NEXT test's
 * window: after that next test's own setup but before its assertion. That
 * is exactly the reviewer-caught failure in `submitMunForReview does NOT
 * notify on the automated-validation-failure path` (mock unexpectedly
 * called with NEW_SUBMISSION — really the PRIOR test's own submission
 * notification, arriving late).
 *
 * Fix, round 1: resolve as soon as the mock has actually been called at
 * least `minCalls` times (checked every 5ms), rather than sleeping a fixed
 * amount and hoping.
 *
 * Fix, round 2 (this version) — delta-based, not absolute: several tests in
 * this file call `waitForNotifications` more than once in a row WITHOUT
 * clearing the mock in between (e.g. the "replay does NOT re-fire" test
 * calls it after `reviewSubmission`, again after `enqueueForGoLive`'s
 * caller, again after the first `publishFromQueue`, only clearing right
 * before the replay call). An absolute `calls.length >= minCalls` check is
 * satisfied instantly by calls already sitting in the mock from an EARLIER
 * step in the same test — so a later `waitForNotifications(1)` call could
 * return immediately without the actual new call (from the action under
 * test at that point) having landed yet, then a subsequent `mockClear()`
 * would wipe it before the assertion ever sees it, OR — the actual observed
 * failure — a genuinely late call from an earlier step would still be
 * in-flight, land after a `mockClear()` that an EARLIER `waitForNotifications`
 * call's premature return allowed to run too soon, and get miscounted
 * against the WRONG step's assertion.
 *
 * Capturing the call count at entry as a baseline and waiting for that many
 * NEW calls (`calls.length - baseline >= minCalls`) fixes this for every
 * call site regardless of whether the mock was cleared since the last call —
 * each `waitForNotifications` invocation now only ever counts calls that
 * land after it starts, never calls counted by a previous invocation.
 */
async function waitForNotifications(minCalls = 1, timeoutMs = 300): Promise<void> {
  const baseline = notifyPipelineEventMock.mock.calls.length
  const deadline = Date.now() + timeoutMs
  while (notifyPipelineEventMock.mock.calls.length - baseline < minCalls && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (minCalls === 0) {
    // No early exit is possible for "prove nothing arrives" — wait out the
    // full window so a call landing near the deadline is still caught.
    const remaining = deadline - Date.now()
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining))
    }
  }
}

describe('go-live.ts pipeline notification wiring', () => {
  afterEach(() => {
    notifyPipelineEventMock.mockClear()
  })

  it('submitMunForReview success path fires NEW_SUBMISSION after commit', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeCompleteMun(organizer.id)

    const result = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.passed).toBe(true)

    // One event expected on this path (NEW_SUBMISSION — organizer-facing
    // SUBMISSION_RECEIVED was removed).
    await waitForNotifications(1)

    const eventTypes = notifyPipelineEventMock.mock.calls.map((call) => (call[0] as { type: string }).type)
    expect(eventTypes).toContain('NEW_SUBMISSION')
  })

  it('submitMunForReview does NOT notify on the automated-validation-failure path', async () => {
    const organizer = await makeUser('ORGANIZER')
    const [bareMun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Incomplete Mun', slug: `incomplete-mun-${crypto.randomUUID()}`, status: 'ONBOARDING' })
      .returning()

    const result = await submitMunForReview(bareMun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.passed).toBe(false)

    await waitForNotifications(0)

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })

  it('reviewSubmission APPROVED fires an APPROVED event', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    // Drain the submission's own NEW_SUBMISSION call (submitFinalConfirmation
    // fires no pipeline event of its own — the old UNDER_REVIEW "process
    // narration" event was removed outright) before clearing, so a
    // late-arriving one from THIS setup doesn't bleed into the assertion
    // below.
    await waitForNotifications(1)
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await waitForNotifications(1)

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
    await waitForNotifications(1) // NEW_SUBMISSION only — submitFinalConfirmation fires nothing
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'CHANGES_REQUESTED', { notes: 'Fix the venue address' }, { userId: admin.id, role: 'ADMIN' })
    await waitForNotifications(1)

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
    await waitForNotifications(1) // NEW_SUBMISSION only — submitFinalConfirmation fires nothing
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'REJECTED', { reason: 'Fabricated committee list' }, { userId: admin.id, role: 'ADMIN' })
    await waitForNotifications(1)

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
    await waitForNotifications(1) // NEW_SUBMISSION only — submitFinalConfirmation fires nothing
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await waitForNotifications(1)
    notifyPipelineEventMock.mockClear()

    await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })
    notifyPipelineEventMock.mockClear()

    const result = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(result.replay).toBe(false)

    // One event expected on this path (PUBLISHED — the PUBLISHING event was
    // removed).
    await waitForNotifications(1)

    const eventTypes = notifyPipelineEventMock.mock.calls.map((call) => (call[0] as { type: string }).type)
    expect(eventTypes).toContain('PUBLISHED')

    const publishedCall = notifyPipelineEventMock.mock.calls.find((c) => (c[0] as { type: string }).type === 'PUBLISHED')
    const publishedEvent = publishedCall?.[0] as { publicUrl: string } | undefined
    expect(publishedEvent).toMatchObject({ type: 'PUBLISHED', munId: mun.id })
    expect(publishedEvent?.publicUrl).toContain(`/mun/${mun.slug}`)
  })

  it('publishFromQueue replay does NOT re-fire PUBLISHED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    await waitForNotifications(1) // NEW_SUBMISSION only — submitFinalConfirmation fires nothing
    notifyPipelineEventMock.mockClear()

    await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
    await waitForNotifications(1)
    notifyPipelineEventMock.mockClear()

    await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })
    notifyPipelineEventMock.mockClear()

    await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    await waitForNotifications(1)
    notifyPipelineEventMock.mockClear()

    const replayResult = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(replayResult.replay).toBe(true)

    await waitForNotifications(0)

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })

  it('submitFinalConfirmation fires no pipeline event after the VERIFICATION transition commits', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeCompleteMun(organizer.id)
    const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    if (!submitResult.passed) throw new Error('fixture setup failed')
    await waitForNotifications(1) // NEW_SUBMISSION
    notifyPipelineEventMock.mockClear()

    // The old organizer-facing UNDER_REVIEW "process narration" event was
    // removed outright — organizer-confirmation.ts no longer calls
    // notifyPipelineEvent at all, so this transition sends nothing.
    const updated = await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(updated.status).toBe('VERIFICATION')
    await waitForNotifications(0)

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })

  it('submitMunForReview fires RESUBMISSION (not NEW_SUBMISSION) to admins when a prior submission already exists', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeCompleteMun(organizer.id)

    // Simulate an earlier submission attempt that reached a terminal state
    // (REJECTED — any status outside ACTIVE_SUBMISSION_PREDICATE works, since
    // the row just needs to exist so nextVersion computes > 1; it must not
    // collide with mun_submissions_active_per_mun_uq).
    await db.insert(munSubmissions).values({
      munId: mun.id,
      submittedBy: organizer.id,
      versionNumber: 1,
      status: 'REJECTED',
      progressPercentage: 100,
      submittedAt: new Date(),
      slaDeadline: new Date(),
      slaState: 'COMPLETED',
    })

    const result = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.passed).toBe(true)
    expect(result.isResubmission).toBe(true)

    await waitForNotifications(1) // RESUBMISSION

    const eventTypes = notifyPipelineEventMock.mock.calls.map((call) => (call[0] as { type: string }).type)
    expect(eventTypes).toContain('RESUBMISSION')
    expect(eventTypes).not.toContain('NEW_SUBMISSION')

    const call = notifyPipelineEventMock.mock.calls.find((c) => (c[0] as { type: string }).type === 'RESUBMISSION')
    expect(call?.[0]).toMatchObject({ type: 'RESUBMISSION', munId: mun.id })
  })

  it('onModuleDataChanged flips a mun from ONBOARDING to READY_FOR_SUBMISSION without firing any pipeline notification', async () => {
    const organizer = await makeUser('ORGANIZER')
    // makeCompleteMun always seeds status: 'ONBOARDING' — every required
    // module already satisfies its validator, so one onModuleDataChanged
    // call is enough to flip it straight to READY_FOR_SUBMISSION. The
    // READY_FOR_SUBMISSION PipelineEvent variant was removed outright (only
    // review-decision and published emails go out now) — this is a silent
    // status materialization, not a notification trigger.
    const mun = await makeCompleteMun(organizer.id)

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)
    await waitForNotifications(0)
    expect(notifyPipelineEventMock).not.toHaveBeenCalled()

    // Mun is already READY_FOR_SUBMISSION — a second call recomputes the
    // same target status, which is a no-op transition (not a real flip), so
    // it must still not fire anything.
    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)
    await waitForNotifications(0)

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await db.$client.end()
})
