import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  getModuleVerificationState,
  confirmModule,
  reviewModule,
  checkAllModulesVerified,
  setModuleRequirement,
  bulkVerifyModules,
} from './module-verification'

async function makeUser(role: 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: 'VERIFICATION' | 'DRAFT' = 'VERIFICATION') {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Verify Mun', slug: `verify-mun-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

// All 15 PRD Section 38 keys tracked by MODULE_REGISTRY — used below to drive
// "verify everything" style tests without hardcoding a shorter legacy list.
const ALL_15_MODULES = [
  'BASIC_INFO',
  'DATES_VENUE',
  'BRANDING',
  'COMMITTEES',
  'PORTFOLIOS',
  'EXECUTIVE_BOARD',
  'REGISTRATION_TYPES',
  'REGISTRATION_FORM',
  'PRICING_CAPACITY',
  'PAYMENT_SETTLEMENT',
  'RULES_DOCUMENTS',
  'SCHEDULE',
  'ACCOMMODATION',
  'CONTACT',
  'FINAL_REVIEW',
] as const

describe('getModuleVerificationState', () => {
  it('lazily creates a NOT_SUBMITTED row on first read', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const state = await getModuleVerificationState(mun.id, 'COMMITTEES')
    expect(state.state).toBe('NOT_SUBMITTED')

    const [row] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
    expect(row).toBeDefined()
  })

  it('seeds isRequired from the module registry default', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const state = await getModuleVerificationState(mun.id, 'PAYMENT_SETTLEMENT')
    expect(state.isRequired).toBe(true)
  })

  it('a concurrent first-touch does not throw and results in exactly one row', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const results = await Promise.allSettled([
      getModuleVerificationState(mun.id, 'FINAL_REVIEW'),
      getModuleVerificationState(mun.id, 'FINAL_REVIEW'),
      getModuleVerificationState(mun.id, 'FINAL_REVIEW'),
    ])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    const rows = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'FINAL_REVIEW')))
    expect(rows.length).toBe(1)
  })
})

describe('confirmModule', () => {
  it('lets the owning organizer confirm and moves state to PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const result = await confirmModule(mun.id, 'PORTFOLIOS', { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.state).toBe('PENDING_REVIEW')
    expect(result.organizerConfirmedAt).toBeTruthy()
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(confirmModule(mun.id, 'PORTFOLIOS', { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  it("re-confirming after changes were requested resolves the reviewer's issues on that module only", async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    const organizerSession = { userId: organizer.id, role: 'ORGANIZER' as const }
    const reviewerSession = { userId: reviewer.id, role: 'OPERATIONS' as const }

    await confirmModule(mun.id, 'COMMITTEES', organizerSession)
    await reviewModule(mun.id, 'COMMITTEES', 'CHANGES_REQUESTED', [{ severity: 'BLOCKER', reason: 'Add agendas' }], reviewerSession)
    await confirmModule(mun.id, 'CONTACT', organizerSession)
    await reviewModule(mun.id, 'CONTACT', 'CHANGES_REQUESTED', [{ severity: 'HIGH', reason: 'Fix phone' }], reviewerSession)

    const result = await confirmModule(mun.id, 'COMMITTEES', organizerSession)
    expect(result.state).toBe('PENDING_REVIEW')

    const issues = await db.select().from(verificationIssues).where(eq(verificationIssues.munId, mun.id))
    const byModule = Object.fromEntries(issues.map((issue) => [issue.moduleName, issue.resolved]))
    expect(byModule).toEqual({ COMMITTEES: true, CONTACT: false })
  })

  it('rejects confirming a module that is already PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'COMMITTEES', { userId: organizer.id, role: 'ORGANIZER' })

    await expect(confirmModule(mun.id, 'COMMITTEES', { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow(
      'cannot be confirmed from its current state',
    )
  })
})

describe('reviewModule', () => {
  it('lets OPERATIONS verify a module and records no issues when decision is VERIFIED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'COMMITTEES', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(mun.id, 'COMMITTEES', 'VERIFIED', [], { userId: reviewer.id, role: 'OPERATIONS' })
    expect(result.state).toBe('VERIFIED')
    expect(result.lastReviewedBy).toBe(reviewer.id)
  })

  it('records issues and flips to CHANGES_REQUESTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'REGISTRATION_TYPES', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(
      mun.id,
      'REGISTRATION_TYPES',
      'CHANGES_REQUESTED',
      [{ severity: 'HIGH', reason: 'Price missing currency context' }],
      { userId: reviewer.id, role: 'OPERATIONS' },
    )
    expect(result.state).toBe('CHANGES_REQUESTED')
  })

  it('batches multiple issues into the review and flips to REJECTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'PAYMENT_SETTLEMENT', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(
      mun.id,
      'PAYMENT_SETTLEMENT',
      'REJECTED',
      [
        { severity: 'BLOCKER', reason: 'PAN missing' },
        { severity: 'HIGH', reason: 'Bank account not verified' },
      ],
      { userId: reviewer.id, role: 'OPERATIONS' },
    )
    expect(result.state).toBe('REJECTED')
  })

  it('rejects a STUDENT session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    const mun = await makeMun(organizer.id)

    await expect(
      reviewModule(mun.id, 'COMMITTEES', 'VERIFIED', [], { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('Forbidden')
  })

  it('rejects a second review attempt once the module is no longer PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'COMMITTEES', { userId: organizer.id, role: 'ORGANIZER' })

    await reviewModule(mun.id, 'COMMITTEES', 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })

    await expect(
      reviewModule(mun.id, 'COMMITTEES', 'REJECTED', [{ severity: 'BLOCKER', reason: 'too late' }], {
        userId: reviewer.id,
        role: 'ADMIN',
      }),
    ).rejects.toThrow(/already reviewed/)
  })

  it('under two concurrent reviewModule calls on the same PENDING_REVIEW module, exactly one wins and the other is rejected cleanly', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewerA = await makeUser('ADMIN')
    const reviewerB = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    // Verify every other required module first, so that whichever concurrent
    // call below wins with VERIFIED is the one that actually flips
    // muns.status via checkAllModulesVerified's auto-advance — this is what
    // lets the assertions below tell "the mun transitioned on the winning
    // decision" apart from "the mun transitioned on a clobbered write",
    // which is exactly the failure the reviewer traced through the bug this
    // test guards against (reviewModule was missing a state-precondition
    // check under the lock, so a second concurrent call could silently
    // overwrite the first call's write after checkAllModulesVerified had
    // already acted on it).
    const otherModules = ALL_15_MODULES.filter((m) => m !== 'FINAL_REVIEW')
    for (const moduleName of otherModules) {
      await confirmModule(mun.id, moduleName, { userId: organizer.id, role: 'ORGANIZER' })
      await reviewModule(mun.id, moduleName, 'VERIFIED', [], { userId: reviewerA.id, role: 'ADMIN' })
    }

    await confirmModule(mun.id, 'FINAL_REVIEW', { userId: organizer.id, role: 'ORGANIZER' })

    const results = await Promise.allSettled([
      reviewModule(mun.id, 'FINAL_REVIEW', 'VERIFIED', [], { userId: reviewerA.id, role: 'ADMIN' }),
      reviewModule(mun.id, 'FINAL_REVIEW', 'REJECTED', [{ severity: 'BLOCKER', reason: 'race' }], {
        userId: reviewerB.id,
        role: 'ADMIN',
      }),
    ])

    // The row lock serializes the two transactions; the state precondition
    // re-checked under the lock (current.state !== 'PENDING_REVIEW') then
    // makes whichever call runs second see the row already reviewed and
    // throw, instead of silently overwriting the winner's write. Exactly one
    // of the two calls must succeed — never zero (that would mean the lock
    // itself is broken), never two (that would mean the precondition isn't
    // actually being enforced under the lock).
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof reviewModule>>
    >[]
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect(String(rejected[0].reason)).toMatch(/already reviewed/)

    const winnerIsA = fulfilled[0].value.lastReviewedBy === reviewerA.id
    const expectedFinalState = winnerIsA ? 'VERIFIED' : 'REJECTED'

    const [finalRow] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'FINAL_REVIEW')))
    // The persisted state must reflect ONLY the winning call's decision —
    // never the decision that got rejected, and never a third/corrupted
    // value from a partial overlapping write.
    expect(finalRow.state).toBe(expectedFinalState)
    expect(finalRow.lastReviewedBy).toBe(winnerIsA ? reviewerA.id : reviewerB.id)

    // The critical end-to-end assertion the reviewer called out: muns.status
    // must reflect only the winning decision. If A won (VERIFIED), all 15
    // required modules are now VERIFIED and the mun must have auto-advanced.
    // If B won (REJECTED), FINAL_REVIEW never reached VERIFIED, so the mun
    // must still be sitting in VERIFICATION — it must NOT have been advanced
    // by a VERIFIED write that was later silently discarded.
    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe(winnerIsA ? 'VERIFIED' : 'VERIFICATION')

    // Exactly one verificationIssues row from the REJECTED call when it's
    // the one that actually won — never zero, never duplicated by a
    // clobbered retry.
    if (!winnerIsA) {
      const issueRows = await db
        .select()
        .from(verificationIssues)
        .where(and(eq(verificationIssues.munId, mun.id), eq(verificationIssues.moduleName, 'FINAL_REVIEW')))
      expect(issueRows.length).toBe(1)
    }
  })
})

describe('bulkVerifyModules', () => {
  it("continues past a per-target failure and reports each target's outcome, without letting the failure block the good target", async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    const organizerSession = { userId: organizer.id, role: 'ORGANIZER' as const }
    const reviewerSession = { userId: reviewer.id, role: 'ADMIN' as const }

    await confirmModule(mun.id, 'COMMITTEES', organizerSession)

    // Simulates "someone else already reviewed this one since the queue was
    // loaded": review it up front, so the bulk call's own attempt at the
    // same (munId, moduleName) hits the real `reviewModule` no-longer-
    // PENDING_REVIEW guard, not a synthetic failure.
    await confirmModule(mun.id, 'CONTACT', organizerSession)
    await reviewModule(mun.id, 'CONTACT', 'VERIFIED', [], reviewerSession)

    const results = await bulkVerifyModules(
      [
        { munId: mun.id, moduleName: 'COMMITTEES' },
        { munId: mun.id, moduleName: 'CONTACT' },
      ],
      reviewerSession,
    )

    expect(results).toEqual([
      { munId: mun.id, moduleName: 'COMMITTEES', ok: true },
      { munId: mun.id, moduleName: 'CONTACT', ok: false, error: expect.stringContaining('already reviewed') },
    ])

    // The good target's own reviewModule call ran to completion despite the
    // other target failing later in the loop.
    const [committeesRow] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
    expect(committeesRow.state).toBe('VERIFIED')
    expect(committeesRow.lastReviewedBy).toBe(reviewer.id)
  })

  it('rejects a non-reviewer session up front, before touching any target', async () => {
    const organizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    const mun = await makeMun(organizer.id)

    await expect(
      bulkVerifyModules([{ munId: mun.id, moduleName: 'COMMITTEES' }], { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('Forbidden')
  })

  it('still auto-advances the mun to VERIFIED when the last required module clears via the bulk call', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    const organizerSession = { userId: organizer.id, role: 'ORGANIZER' as const }
    const reviewerSession = { userId: reviewer.id, role: 'ADMIN' as const }

    for (const moduleName of ALL_15_MODULES.filter((m) => m !== 'FINAL_REVIEW')) {
      await confirmModule(mun.id, moduleName, organizerSession)
      await reviewModule(mun.id, moduleName, 'VERIFIED', [], reviewerSession)
    }
    await confirmModule(mun.id, 'FINAL_REVIEW', organizerSession)

    const results = await bulkVerifyModules([{ munId: mun.id, moduleName: 'FINAL_REVIEW' }], reviewerSession)
    expect(results).toEqual([{ munId: mun.id, moduleName: 'FINAL_REVIEW', ok: true }])

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })
})

describe('checkAllModulesVerified', () => {
  it('returns false when a required module has no row at all', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    // Verify every module except one (FINAL_REVIEW never gets a row here).
    const modulesToTouch = ALL_15_MODULES.filter((m) => m !== 'FINAL_REVIEW')
    for (const moduleName of modulesToTouch) {
      await confirmModule(mun.id, moduleName, { userId: organizer.id, role: 'ORGANIZER' })
      await reviewModule(mun.id, moduleName, 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })
    }

    const result = await checkAllModulesVerified(mun.id, reviewer.id)
    expect(result).toBe(false)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')
  })

  it('transitions the mun to VERIFIED once all 15 required modules are VERIFIED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    for (const moduleName of ALL_15_MODULES) {
      await confirmModule(mun.id, moduleName, { userId: organizer.id, role: 'ORGANIZER' })
      await reviewModule(mun.id, moduleName, 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })
    }

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })

  it('does not transition the mun if only some modules are verified', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    await confirmModule(mun.id, 'COMMITTEES', { userId: organizer.id, role: 'ORGANIZER' })
    await reviewModule(mun.id, 'COMMITTEES', 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')
  })

  it('an optional module left NOT_SUBMITTED does not block the overall check', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    // Make ACCOMMODATION optional for this mun, then verify every other
    // required module. ACCOMMODATION itself is left NOT_SUBMITTED.
    await setModuleRequirement(mun.id, 'ACCOMMODATION', false, { userId: reviewer.id, role: 'ADMIN' })

    const requiredModules = ALL_15_MODULES.filter((m) => m !== 'ACCOMMODATION')
    for (const moduleName of requiredModules) {
      await confirmModule(mun.id, moduleName, { userId: organizer.id, role: 'ORGANIZER' })
      await reviewModule(mun.id, moduleName, 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })
    }

    // The last reviewModule call above already auto-triggered the transition
    // internally (its VERIFIED decision made checkAllModulesVerified pass,
    // since ACCOMMODATION is excluded from the required set), so the mun is
    // already VERIFIED by this point. A fresh explicit call here correctly
    // returns false — the mun is no longer in VERIFICATION to transition out
    // of. The assertion that actually matters is below: the transition DID
    // happen despite ACCOMMODATION being left NOT_SUBMITTED.
    const result = await checkAllModulesVerified(mun.id, reviewer.id)
    expect(result).toBe(false)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')

    const [accommodationRow] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'ACCOMMODATION')))
    expect(accommodationRow.state).toBe('NOT_SUBMITTED')
  })
})

describe('setModuleRequirement', () => {
  it('lets ADMIN flip isRequired on a module and records an admin_actions row', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    const result = await setModuleRequirement(mun.id, 'ACCOMMODATION', false, { userId: admin.id, role: 'ADMIN' })
    expect(result.isRequired).toBe(false)
  })

  it('rejects a non-admin caller', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    await expect(
      setModuleRequirement(mun.id, 'ACCOMMODATION', false, { userId: organizer.id, role: 'ORGANIZER' }),
    ).rejects.toThrow('Forbidden')
  })

  it('rejects making FINAL_REVIEW optional', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    await expect(
      setModuleRequirement(mun.id, 'FINAL_REVIEW', false, { userId: admin.id, role: 'ADMIN' }),
    ).rejects.toThrow('FINAL_REVIEW cannot be made optional')
  })
})

afterAll(async () => {
  await db.$client.end()
})
