import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'
import { submitOrganizerApplication } from './organizer-application'

describe('submitOrganizerApplication', () => {
  it('creates an application and mun linked to each other, mun starts SUBMITTED', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'New Org', email: `neworg-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const result = await submitOrganizerApplication({
      organizerId: organizer.id,
      conferenceName: 'New City MUN',
      expectedDate: new Date('2027-08-01'),
      location: 'Pune, India',
      expectedDelegateCount: 300,
      description: 'A regional MUN for first-time delegates.',
    })

    expect(result.status).toBe('SUBMITTED')
    expect(result.organizerId).toBe(organizer.id)
    expect(result.munId).toBeTruthy()

    const [mun] = await db.select().from(muns).where(eq(muns.id, result.munId!)).limit(1)
    // PRD: submitting the organizer application IS the SUBMITTED trigger —
    // the mun must not be left in DRAFT.
    expect(mun?.status).toBe('SUBMITTED')
    expect(mun?.name).toBe('New City MUN')
    expect(mun?.organizerId).toBe(organizer.id)
  })

  it('auto-generates a unique slug when conference names collide', async () => {
    const [organizerA] = await db
      .insert(users)
      .values({ name: 'Org A', email: `orga-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [organizerB] = await db
      .insert(users)
      .values({ name: 'Org B', email: `orgb-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const resultA = await submitOrganizerApplication({
      organizerId: organizerA.id,
      conferenceName: 'Duplicate Name MUN',
      expectedDate: new Date('2027-09-01'),
      location: 'Delhi, India',
      expectedDelegateCount: 100,
      description: 'First conference with this name.',
    })
    const resultB = await submitOrganizerApplication({
      organizerId: organizerB.id,
      conferenceName: 'Duplicate Name MUN',
      expectedDate: new Date('2027-09-02'),
      location: 'Mumbai, India',
      expectedDelegateCount: 150,
      description: 'Second conference with the same name.',
    })

    const [munA] = await db.select().from(muns).where(eq(muns.id, resultA.munId!)).limit(1)
    const [munB] = await db.select().from(muns).where(eq(muns.id, resultB.munId!)).limit(1)

    expect(munA?.slug).not.toBe(munB?.slug)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
