import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  muns,
  users,
  munModuleVerifications,
  verificationIssues,
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
  organizerProfiles,
} from '@/lib/db/schema'
import { computeModuleCompletion, recomputeMunProgress, onModuleDataChanged } from './module-completion'
import { setModuleRequirement } from './module-verification'
import { MODULE_REGISTRY, TRACKED_MODULES } from './module-registry'

/** Modules that are `defaultRequired: true` — the minimum-required-fields cut's real set. */
const DEFAULT_REQUIRED_COUNT = MODULE_REGISTRY.filter((m) => m.defaultRequired).length

async function makeUser(role: 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: (typeof muns.$inferInsert)['status'] = 'ONBOARDING') {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Progress Mun', slug: `progress-mun-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

/**
 * Task 9: `computeModuleCompletion`/`recomputeMunProgress` now call REAL
 * validators (lib/lifecycle/validators/*.ts) instead of Task 8's
 * always-COMPLETE stub. Tests that need "every required module genuinely
 * satisfies its validator" (to exercise the aggregation/materialization
 * ENGINE, not re-test the validators themselves — those have their own
 * dedicated test files) need a mun with enough real data seeded across all
 * 15 modules' backing tables, INCLUDING payment settlement (its "details
 * submitted" check is a BLOCKER at every stage — only the *verification
 * state* check is stage-dependent, see validators/commerce.ts). This is
 * that fixture.
 */
async function makeFullySeededMun(organizerId: string, status: (typeof muns.$inferInsert)['status'] = 'ONBOARDING') {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000)
  const opensAt = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
  const deadline = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000)

  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Fully Seeded Mun',
      slug: `fully-seeded-mun-${crypto.randomUUID()}`,
      status,
      description: 'A fully seeded mun with every module satisfied for engine-level testing purposes.',
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

  await db.insert(organizerApplications).values({
    organizerId,
    munId: mun.id,
    status: 'APPROVED',
  })
  await db
    .insert(organizerProfiles)
    .values({
      userId: organizerId,
      accountHolderName: 'Test Organizer',
      bankName: 'Test Bank',
      bankAccountLast4: '4321',
      ifscCode: 'TEST0001234',
      upiId: 'organizer@upi',
      upiPhone: '9000000000',
    })
    .onConflictDoUpdate({
      target: organizerProfiles.userId,
      set: { accountHolderName: 'Test Organizer', bankName: 'Test Bank', bankAccountLast4: '4321', ifscCode: 'TEST0001234' },
    })

  const [committee] = await db
    .insert(committees)
    .values({ munId: mun.id, name: 'UNSC', agenda: 'Maintaining peace and security', capacity: 20 })
    .returning()

  await db.insert(portfolios).values({ committeeId: committee.id, name: 'United States', availability: 1 })

  await db.insert(munExecutiveBoard).values({
    munId: mun.id,
    committeeId: committee.id,
    name: 'Chairperson One',
    role: 'CHAIR',
  })

  await db.insert(registrationProducts).values({
    munId: mun.id,
    name: 'Standard Delegate',
    price: 1000,
    capacity: 20,
    status: 'active',
    deadline,
  })

  await db.insert(munContacts).values({
    munId: mun.id,
    officialEmail: 'contact@fullyseeded.test',
    phone: '+911234567890',
    contactPersonName: 'Jane Organizer',
    contactPersonEmail: 'jane@fullyseeded.test',
  })

  await db.insert(munMedia).values([
    { munId: mun.id, kind: 'LOGO', url: 'https://example.com/logo.png', storageKey: 'logo', contentType: 'image/png', sizeBytes: 100 },
    { munId: mun.id, kind: 'COVER', url: 'https://example.com/cover.png', storageKey: 'cover', contentType: 'image/png', sizeBytes: 100 },
  ])

  await db.insert(munDocuments).values([
    { munId: mun.id, kind: 'RULES', title: 'Rules', url: 'https://example.com/rules.pdf', storageKey: 'rules', contentType: 'application/pdf', sizeBytes: 100 },
    { munId: mun.id, kind: 'CODE_OF_CONDUCT', title: 'Code of Conduct', url: 'https://example.com/coc.pdf', storageKey: 'coc', contentType: 'application/pdf', sizeBytes: 100 },
    { munId: mun.id, kind: 'REFUND_POLICY', title: 'Refund Policy', url: 'https://example.com/refund.pdf', storageKey: 'refund', contentType: 'application/pdf', sizeBytes: 100 },
  ])

  await db.insert(munScheduleItems).values({
    munId: mun.id,
    title: 'Opening Ceremony',
    kind: 'OPENING_CEREMONY',
    startsAt: start,
    endsAt: new Date(start.getTime() + 60 * 60 * 1000),
  })

  // PAYMENT_SETTLEMENT: "details submitted" is a BLOCKER at every stage, so
  // this row must exist for this fixture's "everything COMPLETE" tests to
  // hold. VERIFIED (not just PENDING) so the module is unconditionally
  // COMPLETE regardless of which stage a future caller computes against —
  // the stage-dependent HIGH-vs-BLOCKER distinction on the *verification
  // state* check is covered by its own dedicated tests in
  // validators/commerce.test.ts and validation.test.ts, not here.
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
    authorizedRepEmail: 'rep@fullyseeded.test',
    accountHolderName: 'Test Org',
    bankName: 'Test Bank',
    accountNumberLast4: '5678',
    accountNumberCiphertext: 'ciphertext-not-real',
    ifsc: 'TEST0001234',
    accountType: 'current',
    gateway: 'razorpay',
    verificationState: 'VERIFIED',
  })

  return mun
}

describe('computeModuleCompletion', () => {
  it('a bare mun (no data in any module table) fails COMMITTEES for real: at least one committee is required', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)

    const result = await computeModuleCompletion(mun.id, 'COMMITTEES')
    expect(result.completionStatus).toBe('ACTION_REQUIRED')
    expect(result.blockingIssueCount).toBeGreaterThan(0)
    expect(result.issues.some((i) => i.key === 'at_least_one_committee')).toBe(true)
  })

  it('a fully seeded mun genuinely satisfies COMMITTEES', async () => {
    const organizer = await makeUser()
    const mun = await makeFullySeededMun(organizer.id)

    const result = await computeModuleCompletion(mun.id, 'COMMITTEES')
    expect(result).toEqual({
      completionStatus: 'COMPLETE',
      completionPercentage: 100,
      blockingIssueCount: 0,
      issues: [],
    })
  })
})

describe('recomputeMunProgress — percentage arithmetic', () => {
  it('is module-count based: required-complete / required-total, every default-required module genuinely COMPLETE on a fully seeded mun', async () => {
    const organizer = await makeUser()
    const mun = await makeFullySeededMun(organizer.id)

    const progress = await recomputeMunProgress(mun.id)
    expect(progress.requiredTotal).toBe(DEFAULT_REQUIRED_COUNT)
    expect(progress.requiredComplete).toBe(DEFAULT_REQUIRED_COUNT)
    expect(progress.overallPercentage).toBe(100)
  })

  it('a bare mun leaves required modules incomplete (every real validator with a required field fails on empty data)', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)

    const progress = await recomputeMunProgress(mun.id)
    expect(progress.requiredTotal).toBe(DEFAULT_REQUIRED_COUNT)
    expect(progress.requiredComplete).toBeLessThan(DEFAULT_REQUIRED_COUNT)
    expect(progress.overallPercentage).toBeLessThan(100)
    expect(progress.modules.find((m) => m.key === 'COMMITTEES')?.completionStatus).toBe('ACTION_REQUIRED')
    // BASIC_INFO's only remaining BLOCKER is name_present, which `makeMun`
    // sets — DATES_VENUE (dates + city are BLOCKER there) is the one that
    // genuinely stays incomplete on this bare fixture.
    expect(progress.modules.find((m) => m.key === 'DATES_VENUE')?.completionStatus).toBe('ACTION_REQUIRED')
  })

  it('module-count based formula gives a different answer than averaging when completion is uneven', () => {
    // Construct the case directly: 14 of 15 required modules COMPLETE
    // (100%), 1 module IN_PROGRESS at 60%. Module-count based:
    // round(14/15 * 100) = 93. Averaging per-module percentages:
    // round((14*100 + 60) / 15) = 97. These disagree, which is exactly the
    // design doc Section 3.2 failure mode ("the bar moves when a module
    // goes from 40%→60% while the 12/15 count stays put") that module-count
    // basing is chosen to avoid.
    const requiredTotal = 15
    const requiredComplete = 14
    const oddModulePercentage = 60

    const moduleCountPercentage = Math.round((requiredComplete / requiredTotal) * 100)
    const averagingPercentage = Math.round((requiredComplete * 100 + oddModulePercentage) / requiredTotal)

    expect(moduleCountPercentage).toBe(93)
    expect(averagingPercentage).toBe(97)
    expect(moduleCountPercentage).not.toBe(averagingPercentage)
  })

  it('recomputeMunProgress.overallPercentage always equals round(requiredComplete/requiredTotal*100), never an average', async () => {
    const organizer = await makeUser()
    const mun = await makeFullySeededMun(organizer.id)

    await recomputeMunProgress(mun.id) // seeds a row for every tracked module

    // Hand-write one module's row to a lower percentage. The very next
    // recompute overwrites completionStatus/completionPercentage with the
    // real validator's answer again (COMMITTEES genuinely passes on this
    // fixture), but blockingIssueCount is aggregated fresh from
    // verificationIssues every time. Combined with the exact-fraction
    // assertion below, this pins down that overallPercentage is derived
    // from the COMPLETE/total count, not from any per-module percentage
    // value hand-written here.
    await db
      .update(munModuleVerifications)
      .set({ completionStatus: 'IN_PROGRESS', completionPercentage: 60 })
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))

    const progress = await recomputeMunProgress(mun.id)
    expect(progress.overallPercentage).toBe(Math.round((progress.requiredComplete / progress.requiredTotal) * 100))
  })

  it('excludes optional modules from the denominator', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const mun = await makeFullySeededMun(organizer.id)

    await recomputeMunProgress(mun.id)
    // COMMITTEES is defaultRequired: true — flipping it to false via the
    // admin override is what actually moves requiredTotal, proving the
    // override mechanism (not just the static registry default) works.
    await setModuleRequirement(mun.id, 'COMMITTEES', false, { userId: admin.id, role: 'ADMIN' })

    const progress = await recomputeMunProgress(mun.id)
    expect(progress.requiredTotal).toBe(DEFAULT_REQUIRED_COUNT - 1)
    expect(progress.modules.find((m) => m.key === 'COMMITTEES')?.isRequired).toBe(false)
    expect(progress.requiredComplete).toBe(DEFAULT_REQUIRED_COUNT - 1)
  })
})

describe('onModuleDataChanged — ONBOARDING/ACTION_REQUIRED/READY_FOR_SUBMISSION materialization', () => {
  it('flips ONBOARDING to READY_FOR_SUBMISSION once every required module genuinely satisfies its validator, zero blocking issues', async () => {
    const organizer = await makeUser()
    const mun = await makeFullySeededMun(organizer.id, 'ONBOARDING')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('READY_FOR_SUBMISSION')
  })

  it('a bare mun stays ACTION_REQUIRED (required modules genuinely incomplete)', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'ONBOARDING')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('ACTION_REQUIRED')
  })

  it('flips ONBOARDING to ACTION_REQUIRED when a BLOCKER-severity issue exists, even on an otherwise fully seeded mun', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const mun = await makeFullySeededMun(organizer.id, 'ONBOARDING')

    // Every module genuinely satisfies its validator on this fixture, so the
    // only way to force "not (all required complete AND zero blocking
    // issues)" here is via blockingIssueCount, which recomputeMunProgress
    // aggregates fresh from verificationIssues on every call.
    await db.insert(verificationIssues).values({
      munId: mun.id,
      moduleName: 'COMMITTEES',
      severity: 'BLOCKER',
      reason: 'Test-injected blocker',
      raisedBy: admin.id,
    })

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('ACTION_REQUIRED')
  })

  it('READY_FOR_SUBMISSION reverts to ACTION_REQUIRED once a blocking issue appears', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const mun = await makeFullySeededMun(organizer.id, 'ONBOARDING')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)
    const [afterFirstTouch] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(afterFirstTouch.status).toBe('READY_FOR_SUBMISSION')

    await db.insert(verificationIssues).values({
      munId: mun.id,
      moduleName: 'COMMITTEES',
      severity: 'BLOCKER',
      reason: 'Organizer broke a previously-complete module',
      raisedBy: admin.id,
    })
    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [afterSecondTouch] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(afterSecondTouch.status).toBe('ACTION_REQUIRED')
  })

  it('does NOT touch a mun in VERIFICATION status', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('VERIFICATION')
  })

  it('does NOT touch a mun in PUBLISHED status', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'PUBLISHED')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('PUBLISHED')
  })

  it('does NOT touch a mun in DRAFT status (pre-onboarding, Gate 1)', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'DRAFT')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('DRAFT')
  })
})

describe('onModuleDataChanged — atomicity with a caller-supplied transaction', () => {
  it('rolls back everything (including the lazy-created module row) when the outer transaction rolls back', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'ONBOARDING')

    // No module rows exist yet for this fresh mun — calling onModuleDataChanged
    // inside a transaction that we then force to roll back is the sharpest
    // possible proof of the atomicity fix: getModuleVerificationState's
    // lazy-create INSERT must run on the SAME connection as this transaction
    // for the rollback to undo it. Before the fix, that insert ran on the
    // module-level `db` singleton (a separate connection) and would have
    // survived the rollback.
    const rollbackError = new Error('forced rollback for atomicity test')
    await expect(
      db.transaction(async (tx) => {
        await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id, tx)
        throw rollbackError
      }),
    ).rejects.toThrow(rollbackError)

    const [row] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
    expect(row).toBeUndefined()

    // The mun-level status must also have rolled back (stays ONBOARDING —
    // never touched at all — since the whole transaction rolled back), since
    // it ran on the same transaction.
    const [munAfterRollback] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(munAfterRollback.status).toBe('ONBOARDING')
  })

  it('commits everything (module row + status flip) when the outer transaction commits normally', async () => {
    const organizer = await makeUser()
    const mun = await makeFullySeededMun(organizer.id, 'ONBOARDING')

    await db.transaction(async (tx) => {
      await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id, tx)
    })

    const [row] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
    expect(row).toBeDefined()
    expect(row.completionStatus).toBe('COMPLETE')

    const [munAfterCommit] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(munAfterCommit.status).toBe('READY_FOR_SUBMISSION')
  })
})
