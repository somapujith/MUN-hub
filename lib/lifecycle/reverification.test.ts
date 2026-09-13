import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { detectHighImpactChange, triggerReverificationIfNeeded } from './reverification'

describe('detectHighImpactChange', () => {
  it('detects a price change on registration_products as high-impact', () => {
    expect(detectHighImpactChange('registration_products', { price: 2000 }, { price: 2500 })).toBe(true)
  })

  it('does not flag an unchanged price', () => {
    expect(detectHighImpactChange('registration_products', { price: 2000 }, { price: 2000 })).toBe(false)
  })

  it('ignores changes to fields not on the high-impact list', () => {
    expect(detectHighImpactChange('mun_details', { description: 'old' }, { description: 'new' })).toBe(false)
  })

  it('detects a mun name change as high-impact', () => {
    expect(detectHighImpactChange('mun_details', { name: 'Old Name' }, { name: 'New Name' })).toBe(true)
  })

  it('detects a committee capacity change as high-impact', () => {
    expect(detectHighImpactChange('committees', { capacity: 30 }, { capacity: 50 })).toBe(true)
  })
})

async function makeUser(role: 'ORGANIZER' = 'ORGANIZER') {
  const [user] = await db.insert(users).values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role }).returning()
  return user
}

describe('triggerReverificationIfNeeded', () => {
  it('flips a VERIFIED module and the mun back to VERIFICATION when the mun is already VERIFIED and a high-impact field changed', async () => {
    const organizer = await makeUser()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Reverify Mun', slug: `reverify-mun-${crypto.randomUUID()}`, status: 'VERIFIED' })
      .returning()
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'registration_products', state: 'VERIFIED' })

    await triggerReverificationIfNeeded('registration_products', { price: 2000 }, { price: 3000 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')

    const [moduleState] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'registration_products')))
    expect(moduleState.state).toBe('PENDING_REVIEW')
  })

  it('is a no-op if the mun is not yet VERIFIED', async () => {
    const organizer = await makeUser()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Draft Mun', slug: `draft-mun-${crypto.randomUUID()}`, status: 'DRAFT' })
      .returning()

    await triggerReverificationIfNeeded('registration_products', { price: 2000 }, { price: 3000 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('DRAFT')
  })

  it('is a no-op if the change is not high-impact', async () => {
    const organizer = await makeUser()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Stable Mun', slug: `stable-mun-${crypto.randomUUID()}`, status: 'VERIFIED' })
      .returning()

    await triggerReverificationIfNeeded('mun_details', { description: 'old' }, { description: 'new' }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })
})

afterAll(async () => {
  await db.$client.end()
})
