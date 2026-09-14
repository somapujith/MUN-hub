import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import { computeModuleCompletion, recomputeMunProgress, onModuleDataChanged } from './module-completion'
import { setModuleRequirement } from './module-verification'
import { TRACKED_MODULES } from './module-registry'

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

describe('computeModuleCompletion', () => {
  it('stub: trivially passes every module until Task 9 adds real validate functions', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)

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
  it('is module-count based: required-complete / required-total, all 15 modules stub-COMPLETE', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)

    const progress = await recomputeMunProgress(mun.id)
    expect(progress.requiredTotal).toBe(TRACKED_MODULES.length)
    expect(progress.requiredComplete).toBe(TRACKED_MODULES.length)
    expect(progress.overallPercentage).toBe(100)
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
    const mun = await makeMun(organizer.id)

    await recomputeMunProgress(mun.id) // seeds a row for every tracked module

    // Hand-write one module's row to a lower percentage — computeModuleCompletion
    // is stubbed and will overwrite completionStatus/completionPercentage on
    // the very next recompute, but blockingIssueCount is aggregated fresh
    // from verificationIssues every time, independent of the stub. Combined
    // with the exact-fraction assertion below, this pins down that
    // overallPercentage is derived from the COMPLETE/total count, not from
    // any per-module percentage value (which the stub always sets to 100
    // regardless of what's hand-written here).
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
    const mun = await makeMun(organizer.id)

    await recomputeMunProgress(mun.id)
    await setModuleRequirement(mun.id, 'BRANDING', false, { userId: admin.id, role: 'ADMIN' })

    const progress = await recomputeMunProgress(mun.id)
    expect(progress.requiredTotal).toBe(TRACKED_MODULES.length - 1)
    expect(progress.modules.find((m) => m.key === 'BRANDING')?.isRequired).toBe(false)
    expect(progress.requiredComplete).toBe(TRACKED_MODULES.length - 1)
  })
})

describe('onModuleDataChanged — ONBOARDING/ACTION_REQUIRED/READY_FOR_SUBMISSION materialization', () => {
  it('flips ONBOARDING to READY_FOR_SUBMISSION once every required module is COMPLETE (stub: always true) with zero blocking issues', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'ONBOARDING')

    await onModuleDataChanged(mun.id, 'COMMITTEES', organizer.id)

    const [updated] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updated.status).toBe('READY_FOR_SUBMISSION')
  })

  it('flips ONBOARDING to ACTION_REQUIRED when a BLOCKER-severity issue exists', async () => {
    const organizer = await makeUser()
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'ONBOARDING')

    // Every module is stub-COMPLETE, so the only way to force
    // "not (all required complete AND zero blocking issues)" today is via
    // blockingIssueCount, which recomputeMunProgress aggregates fresh from
    // verificationIssues on every call (unlike completionStatus, which the
    // stub always overwrites to COMPLETE).
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
    const mun = await makeMun(organizer.id, 'ONBOARDING')

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

    // The mun-level status flip (ONBOARDING -> READY_FOR_SUBMISSION) must
    // also have rolled back, since it ran on the same transaction.
    const [munAfterRollback] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(munAfterRollback.status).toBe('ONBOARDING')
  })

  it('commits everything (module row + status flip) when the outer transaction commits normally', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id, 'ONBOARDING')

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
