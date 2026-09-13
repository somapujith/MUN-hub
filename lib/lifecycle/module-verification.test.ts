import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  getModuleVerificationState,
  confirmModule,
  reviewModule,
  checkAllModulesVerified,
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

describe('getModuleVerificationState', () => {
  it('lazily creates a NOT_SUBMITTED row on first read', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const state = await getModuleVerificationState(mun.id, 'committees')
    expect(state.state).toBe('NOT_SUBMITTED')

    const [row] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'committees')))
    expect(row).toBeDefined()
  })
})

describe('confirmModule', () => {
  it('lets the owning organizer confirm and moves state to PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const result = await confirmModule(mun.id, 'portfolios', { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.state).toBe('PENDING_REVIEW')
    expect(result.organizerConfirmedAt).toBeTruthy()
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(confirmModule(mun.id, 'portfolios', { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })

  it('rejects confirming a module that is already PENDING_REVIEW', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })

    await expect(confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow(
      'cannot be confirmed from its current state',
    )
  })
})

describe('reviewModule', () => {
  it('lets OPERATIONS verify a module and records no issues when decision is VERIFIED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(mun.id, 'committees', 'VERIFIED', [], { userId: reviewer.id, role: 'OPERATIONS' })
    expect(result.state).toBe('VERIFIED')
    expect(result.lastReviewedBy).toBe(reviewer.id)
  })

  it('records issues and flips to CHANGES_REQUESTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await confirmModule(mun.id, 'registration_products', { userId: organizer.id, role: 'ORGANIZER' })

    const result = await reviewModule(
      mun.id,
      'registration_products',
      'CHANGES_REQUESTED',
      [{ severity: 'HIGH', reason: 'Price missing currency context' }],
      { userId: reviewer.id, role: 'OPERATIONS' },
    )
    expect(result.state).toBe('CHANGES_REQUESTED')
  })

  it('rejects a STUDENT session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    const mun = await makeMun(organizer.id)

    await expect(
      reviewModule(mun.id, 'committees', 'VERIFIED', [], { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('Forbidden')
  })
})

describe('checkAllModulesVerified', () => {
  it('transitions the mun to VERIFIED and creates a version once all 4 modules pass', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)

    const modules = ['mun_details', 'committees', 'portfolios', 'registration_products'] as const
    for (const moduleName of modules) {
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

    await confirmModule(mun.id, 'committees', { userId: organizer.id, role: 'ORGANIZER' })
    await reviewModule(mun.id, 'committees', 'VERIFIED', [], { userId: reviewer.id, role: 'ADMIN' })

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')
  })
})

afterAll(async () => {
  await db.$client.end()
})
