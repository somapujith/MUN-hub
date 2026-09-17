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
  munVersions,
  verificationIssues,
  adminActions,
} from '@/lib/db/schema'
import { enqueueForGoLive, getGoLiveQueue, publishFromQueue, reviewSubmission, submitMunForReview } from './go-live'
import { submitFinalConfirmation } from './organizer-confirmation'
import { updateMunDetails } from '@/lib/actions/mun-config'

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
 *
 * Deliberately seeds `munPaymentSettings.verificationState: 'PENDING'` —
 * this is what makes it pass SUBMIT (payment verification is only HIGH
 * severity pre-publish, see validators/commerce.ts) while still failing
 * PUBLISH (BLOCKER there) until an admin explicitly verifies it. Task 11's
 * publish tests rely on this exact gap to prove PUBLISH-stage re-validation
 * is real.
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

/**
 * Drives a fresh complete mun through submission AND Gate 3's organizer
 * final confirmation, landing it at VERIFICATION — the status
 * `reviewSubmission` actually acts from (`ALLOWED_TRANSITIONS`:
 * ORGANIZER_CONFIRMATION -> VERIFICATION -> {VERIFIED, CHANGES_REQUESTED,
 * ACTION_REQUIRED, REJECTED}; `submitMunForReview` alone only reaches
 * ORGANIZER_CONFIRMATION, one hop short). Returns the submission id.
 */
async function makeMunAtVerification(organizer: { id: string }) {
  const mun = await makeCompleteMun(organizer.id)
  const submitResult = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
  if (!submitResult.passed || !submitResult.submissionId) {
    throw new Error('Fixture setup failed: submitMunForReview did not pass')
  }
  await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
  return { mun, submissionId: submitResult.submissionId }
}

/**
 * Drives a fresh complete mun all the way to VERIFIED with an APPROVED
 * active submission, but stops short of enqueueing. `VERIFIED -> PUBLISHING`
 * is not itself an allowed transition (only `GO_LIVE_QUEUE -> PUBLISHING`
 * is) — most `publishFromQueue` tests should use `makeQueuedSubmission`
 * below instead.
 */
async function makeApprovedSubmission(organizer: { id: string }, admin: { id: string }) {
  const { mun } = await makeMunAtVerification(organizer)
  const approved = await reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' })
  return { mun, submission: approved }
}

/** Drives a fresh complete mun all the way to GO_LIVE_QUEUE, ready for `publishFromQueue`. */
async function makeQueuedSubmission(organizer: { id: string }, admin: { id: string }) {
  const { mun } = await makeApprovedSubmission(organizer, admin)
  const submission = await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })
  return { mun, submission }
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

  it('a resubmission passes once the organizer fixes what failed (stale blockers no longer count)', async () => {
    const organizer = await makeUser()
    const session = { userId: organizer.id, role: 'ORGANIZER' as const }
    const mun = await makeCompleteMun(organizer.id)
    await db.update(muns).set({ venue: null }).where(eq(muns.id, mun.id))

    const first = await submitMunForReview(mun.id, session)
    expect(first.passed).toBe(false)
    expect(first.blockers.map((b) => b.key)).toEqual(['venue_present'])

    await db.update(muns).set({ venue: 'Convention Centre' }).where(eq(muns.id, mun.id))
    const second = await submitMunForReview(mun.id, session)
    expect(second).toMatchObject({ passed: true, blockers: [] })
  })

  it('fixing a failed check resolves its automated issue on the next progress recompute', async () => {
    const organizer = await makeUser()
    const mun = await makeCompleteMun(organizer.id)
    await db.update(muns).set({ venue: null }).where(eq(muns.id, mun.id))
    await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })

    await updateMunDetails(mun.id, { venue: 'Convention Centre' }, { userId: organizer.id, role: 'ORGANIZER' })

    const open = await db
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.resolved, false)))
    expect(open.filter((issue) => issue.code === 'venue_present')).toHaveLength(0)
  })

  it('after Gate-2 changes are requested, the organizer can resubmit and the old round is closed', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun, submissionId } = await makeMunAtVerification(organizer)
    await reviewSubmission(
      mun.id,
      'CHANGES_REQUESTED',
      { notes: 'Please double-check the schedule', issues: [{ severity: 'BLOCKER', reason: 'Schedule looks wrong' }] },
      { userId: admin.id, role: 'ADMIN' },
    )

    const resubmitted = await submitMunForReview(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(resubmitted.passed).toBe(true)
    expect(resubmitted.isResubmission).toBe(true)

    const [oldRound] = await db.select().from(munSubmissions).where(eq(munSubmissions.id, submissionId))
    expect(oldRound.status).toBe('WITHDRAWN')
    const [newRound] = await db.select().from(munSubmissions).where(eq(munSubmissions.id, resubmitted.submissionId!))
    expect(newRound).toMatchObject({ status: 'SUBMITTED', versionNumber: 2 })

    const reviewerIssues = await db
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.source, 'REVIEWER')))
    expect(reviewerIssues).toHaveLength(1)
    expect(reviewerIssues[0].resolved).toBe(true)
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

describe('reviewSubmission', () => {
  it('APPROVED: mun -> VERIFIED, submission -> APPROVED, decidedAt/approvedAt set, logs MUN_APPROVED', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun, submissionId } = await makeMunAtVerification(organizer)

    const updated = await reviewSubmission(mun.id, 'APPROVED', { notes: 'looks good' }, { userId: admin.id, role: 'ADMIN' })

    expect(updated.status).toBe('APPROVED')
    expect(updated.decidedAt).toBeInstanceOf(Date)
    expect(updated.approvedAt).toBeInstanceOf(Date)
    expect(updated.reviewerId).toBe(admin.id)
    expect(updated.reviewStartedAt).toBeInstanceOf(Date)

    const [munRow] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(munRow.status).toBe('VERIFIED')

    const [log] = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'mun_submission'), eq(adminActions.targetId, submissionId)))
    expect(log.action).toBe('MUN_APPROVED')
  })

  it('CHANGES_REQUESTED: mun -> ACTION_REQUIRED, submission -> CHANGES_REQUESTED, SLA paused, logs MUN_CHANGES_REQUESTED', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMunAtVerification(organizer)

    const beforePause = new Date()
    const updated = await reviewSubmission(
      mun.id,
      'CHANGES_REQUESTED',
      { notes: 'fix the venue address', issues: [{ severity: 'HIGH', reason: 'Venue address incomplete' }] },
      { userId: admin.id, role: 'ADMIN' },
    )

    expect(updated.status).toBe('CHANGES_REQUESTED')
    expect(updated.slaState).toBe('PAUSED')
    expect(updated.slaPausedAt).toBeInstanceOf(Date)
    expect(updated.slaPausedAt!.getTime()).toBeGreaterThanOrEqual(beforePause.getTime())

    const [munRow] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(munRow.status).toBe('ACTION_REQUIRED')

    const issues = await db
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.source, 'REVIEWER')))
    expect(issues.some((i) => i.reason === 'Venue address incomplete')).toBe(true)

    // Dedicated Gate 2 mun-level enum value — must NOT be MODULE_REVIEWED,
    // which is reserved for a distinct, future per-module review audit
    // trail (module-verification.ts). An earlier draft of reviewSubmission
    // reused MODULE_REVIEWED here (caught in review); this assertion pins
    // the fix so it can't silently regress.
    const [log] = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'mun_submission'), eq(adminActions.targetId, updated.id)))
    expect(log.action).toBe('MUN_CHANGES_REQUESTED')
  })

  it('REJECTED without a reason throws', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMunAtVerification(organizer)

    await expect(reviewSubmission(mun.id, 'REJECTED', {}, { userId: admin.id, role: 'ADMIN' })).rejects.toThrow(
      /non-empty reason/i,
    )
    await expect(
      reviewSubmission(mun.id, 'REJECTED', { reason: '   ' }, { userId: admin.id, role: 'ADMIN' }),
    ).rejects.toThrow(/non-empty reason/i)
  })

  it('REJECTED with a reason: mun -> REJECTED, submission -> REJECTED, rejectionReason stored, logs MUN_REJECTED', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMunAtVerification(organizer)

    const updated = await reviewSubmission(
      mun.id,
      'REJECTED',
      { reason: 'Content violates platform policy' },
      { userId: admin.id, role: 'ADMIN' },
    )

    expect(updated.status).toBe('REJECTED')
    expect(updated.rejectionReason).toBe('Content violates platform policy')
    expect(updated.decidedAt).toBeInstanceOf(Date)

    const [munRow] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(munRow.status).toBe('REJECTED')

    const [log] = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'mun_submission'), eq(adminActions.targetId, updated.id)))
    expect(log.action).toBe('MUN_REJECTED')
  })

  it('rejects a non-reviewer (ORGANIZER) with Forbidden', async () => {
    const organizer = await makeUser()
    const { mun } = await makeMunAtVerification(organizer)

    await expect(
      reviewSubmission(mun.id, 'APPROVED', {}, { userId: organizer.id, role: 'ORGANIZER' }),
    ).rejects.toThrow('Forbidden')
  })

  it('two concurrent review decisions on the same submission leave exactly one winner (row-lock proof)', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMunAtVerification(organizer)

    const results = await Promise.allSettled([
      reviewSubmission(mun.id, 'APPROVED', {}, { userId: admin.id, role: 'ADMIN' }),
      reviewSubmission(mun.id, 'REJECTED', { reason: 'racing decision' }, { userId: admin.id, role: 'ADMIN' }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // The row lock serializes the two decisions; whichever commits first
    // wins, and the second must re-check the submission's status under the
    // lock and refuse to blindly overwrite it (the same lesson as Task 7's
    // reviewModule fix) — so exactly one succeeds. The loser's transitionMun
    // call fails because the mun has already left the state its own decision
    // requires (canTransition rejects VERIFIED/REJECTED -> the other
    // decision's target).
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)

    const [submission] = await db.select().from(munSubmissions).where(eq(munSubmissions.munId, mun.id))
    expect(['APPROVED', 'REJECTED']).toContain(submission.status)
  })
})

describe('enqueueForGoLive', () => {
  it('moves VERIFIED -> GO_LIVE_QUEUE and sets queuedAt', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeApprovedSubmission(organizer, admin)

    const updated = await enqueueForGoLive(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(updated.queuedAt).toBeInstanceOf(Date)

    const [munRow] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    expect(munRow.status).toBe('GO_LIVE_QUEUE')
  })

  it('rejects a non-ADMIN with Forbidden', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeApprovedSubmission(organizer, admin)

    await expect(enqueueForGoLive(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })
})

describe('getGoLiveQueue', () => {
  it('rejects a non-reviewer (ORGANIZER) with Forbidden', async () => {
    const organizer = await makeUser()
    await expect(getGoLiveQueue({}, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  it('rejects an unauthenticated caller with Forbidden', async () => {
    await expect(getGoLiveQueue({}, null)).rejects.toThrow('Forbidden')
  })

  it('lists a GO_LIVE_QUEUE mun with its active submission and an ON_TRACK slaState', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun, submission } = await makeQueuedSubmission(organizer, admin)

    const { results, total } = await getGoLiveQueue({ limit: 1000 }, { userId: admin.id, role: 'ADMIN' })

    const row = results.find((r) => r.munId === mun.id)
    expect(row).toBeDefined()
    expect(row!.submissionId).toBe(submission.id)
    expect(row!.munStatus).toBe('GO_LIVE_QUEUE')
    expect(row!.queuedAt).toBeInstanceOf(Date)
    expect(row!.slaState).toBe('ON_TRACK')
    expect(total).toBeGreaterThanOrEqual(1)
  })

  it('does not list a mun once its submission is PUBLISHED (ACTIVE_SUBMISSION_PREDICATE excludes it)', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeQueuedSubmission(organizer, admin)

    // PUBLISH-stage validation requires payment VERIFIED (BLOCKER there,
    // unlike SUBMIT where it's only HIGH) — same pattern as
    // 'publishFromQueue > happy path' below.
    await db
      .update(munPaymentSettings)
      .set({ verificationState: 'VERIFIED', verifiedAt: new Date(), verifiedBy: admin.id })
      .where(eq(munPaymentSettings.munId, mun.id))

    await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })

    const { results } = await getGoLiveQueue({ limit: 1000 }, { userId: admin.id, role: 'ADMIN' })
    expect(results.find((r) => r.munId === mun.id)).toBeUndefined()
  })

  it('paginates with limit/offset', async () => {
    const organizerA = await makeUser()
    const organizerB = await makeUser()
    const admin = await makeUser('ADMIN')
    await makeQueuedSubmission(organizerA, admin)
    await makeQueuedSubmission(organizerB, admin)

    const page1 = await getGoLiveQueue({ limit: 1, offset: 0 }, { userId: admin.id, role: 'ADMIN' })
    expect(page1.results.length).toBe(1)
    expect(page1.total).toBeGreaterThanOrEqual(2)
  })
})

describe('publishFromQueue', () => {
  it('happy path: reaches PUBLISHED with publishedAt set and creates a mun_versions row', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeQueuedSubmission(organizer, admin)

    // PUBLISH-stage validation requires payment VERIFIED (BLOCKER there,
    // unlike SUBMIT where it's only HIGH) — verify it so this mun can
    // actually reach PUBLISHED.
    await db
      .update(munPaymentSettings)
      .set({ verificationState: 'VERIFIED', verifiedAt: new Date(), verifiedBy: admin.id })
      .where(eq(munPaymentSettings.munId, mun.id))

    const result = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })

    expect(result.replay).toBe(false)
    expect(result.mun.status).toBe('PUBLISHED')
    expect(result.mun.publishedAt).toBeInstanceOf(Date)
    expect(result.submission.status).toBe('PUBLISHED')
    expect(result.submission.publishedAt).toBeInstanceOf(Date)
    expect(result.submission.slaState).toBe('COMPLETED')
    expect(result.submission.publishIdempotencyKey).toBeTruthy()
    expect(result.munVersionId).toBeTruthy()

    const versions = await db.select().from(munVersions).where(eq(munVersions.munId, mun.id))
    expect(versions.length).toBe(1)
    expect(versions[0].id).toBe(result.munVersionId)

    const [log] = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'mun'), eq(adminActions.targetId, mun.id), eq(adminActions.action, 'MUN_PUBLISHED')))
    expect(log).toBeTruthy()
  })

  it('idempotency: calling publishFromQueue twice returns the same result and creates exactly ONE version row', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeQueuedSubmission(organizer, admin)

    await db
      .update(munPaymentSettings)
      .set({ verificationState: 'VERIFIED', verifiedAt: new Date(), verifiedBy: admin.id })
      .where(eq(munPaymentSettings.munId, mun.id))

    const first = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(first.replay).toBe(false)

    const second = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })
    expect(second.replay).toBe(true)
    expect(second.submission.id).toBe(first.submission.id)
    expect(second.munVersionId).toBe(first.munVersionId)
    expect(second.mun.status).toBe('PUBLISHED')

    const versions = await db.select().from(munVersions).where(eq(munVersions.munId, mun.id))
    expect(versions.length).toBe(1)

    // Direct DB query proof — exactly one PUBLISHED submission row for this
    // mun, not two.
    const submissions = await db.select().from(munSubmissions).where(eq(munSubmissions.munId, mun.id))
    expect(submissions.length).toBe(1)
    expect(submissions[0].status).toBe('PUBLISHED')

    // A supplied idempotencyKey matching the stored one is also a replay.
    const third = await publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' }, first.submission.publishIdempotencyKey!)
    expect(third.replay).toBe(true)

    const versionsAfterThird = await db.select().from(munVersions).where(eq(munVersions.munId, mun.id))
    expect(versionsAfterThird.length).toBe(1)
  })

  it('concurrency: two concurrent calls produce one publish and one no-op replay, with exactly one version row', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeQueuedSubmission(organizer, admin)

    await db
      .update(munPaymentSettings)
      .set({ verificationState: 'VERIFIED', verifiedAt: new Date(), verifiedBy: admin.id })
      .where(eq(munPaymentSettings.munId, mun.id))

    const results = await Promise.allSettled([
      publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' }),
      publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof publishFromQueue>>
    >[]
    // Both calls should fulfill: the row lock serializes them, the first
    // commits the real publish, and the second — once unblocked — sees the
    // now-PUBLISHED submission row and takes the idempotent-replay path
    // rather than erroring.
    expect(fulfilled.length).toBe(2)

    const replays = fulfilled.filter((r) => r.value.replay)
    const realPublishes = fulfilled.filter((r) => !r.value.replay)
    expect(realPublishes.length).toBe(1)
    expect(replays.length).toBe(1)
    expect(replays[0].value.submission.id).toBe(realPublishes[0].value.submission.id)

    const versions = await db.select().from(munVersions).where(eq(munVersions.munId, mun.id))
    expect(versions.length).toBe(1)

    const submissions = await db.select().from(munSubmissions).where(eq(munSubmissions.munId, mun.id))
    expect(submissions.length).toBe(1)
    expect(submissions[0].status).toBe('PUBLISHED')
  })

  it('blocks publish with a specific message when payment verification regressed to PENDING', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeQueuedSubmission(organizer, admin)

    // Payment verification was never advanced past PENDING (makeCompleteMun's
    // default) — this proves PUBLISH-stage re-validation is real, not
    // decorative: the mun passed SUBMIT (HIGH there) and was approved, but
    // publish must re-check live data and block on the same field now being
    // a BLOCKER at PUBLISH stage.
    await expect(publishFromQueue(mun.id, { userId: admin.id, role: 'ADMIN' })).rejects.toThrow(
      /Payment account has been verified by MUNHub/i,
    )

    const [munRow] = await db.select().from(muns).where(eq(muns.id, mun.id)).limit(1)
    // Must never be left stranded in PUBLISHING — the whole transaction
    // rolled back, leaving the mun exactly where it was before this call.
    expect(munRow.status).toBe('GO_LIVE_QUEUE')

    const versions = await db.select().from(munVersions).where(eq(munVersions.munId, mun.id))
    expect(versions.length).toBe(0)
  })

  it('rejects a non-ADMIN with Forbidden', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeQueuedSubmission(organizer, admin)

    await expect(publishFromQueue(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
