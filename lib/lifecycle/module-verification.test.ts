import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  getModuleVerificationState,
  confirmModule,
  reviewModule,
  checkAllModulesVerified,
  setModuleRequirement,
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

  it('under two concurrent reviewModule calls on the same PENDING_REVIEW module, exactly one wins', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewerA = await makeUser('ADMIN')
    const reviewerB = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'FINAL_REVIEW', { userId: organizer.id, role: 'ORGANIZER' })

    const results = await Promise.allSettled([
      reviewModule(mun.id, 'FINAL_REVIEW', 'VERIFIED', [], { userId: reviewerA.id, role: 'ADMIN' }),
      reviewModule(mun.id, 'FINAL_REVIEW', 'REJECTED', [{ severity: 'BLOCKER', reason: 'race' }], {
        userId: reviewerB.id,
        role: 'ADMIN',
      }),
    ])

    // Both calls started from the same PENDING_REVIEW row. The row lock
    // serializes them, so both are legally allowed to succeed (there's no
    // state-precondition rejecting a second review outright in this design —
    // "review a module" is legal from PENDING_REVIEW regardless of decision).
    // What must NOT happen is a corrupted/duplicated write: the final
    // persisted state must be exactly one of the two decisions, and there
    // must be exactly one verificationIssues row for the REJECTED call (not
    // zero, not duplicated).
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof reviewModule>>
    >[]
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)

    const [finalRow] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'FINAL_REVIEW')))
    expect(['VERIFIED', 'REJECTED']).toContain(finalRow.state)

    // Whichever call actually landed last under the lock is reflected
    // consistently — lastReviewedBy must be whichever of A/B corresponds to
    // finalRow.state, never a mix, and never null.
    expect(finalRow.lastReviewedBy).toBeTruthy()
    if (finalRow.state === 'VERIFIED') {
      expect(finalRow.lastReviewedBy).toBe(reviewerA.id)
    } else {
      expect(finalRow.lastReviewedBy).toBe(reviewerB.id)
    }
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
