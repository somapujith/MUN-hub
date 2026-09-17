import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, users } from '@/lib/db/schema'
import { APPLICATION_PENDING, listMyOrganizerApplications, submitOrganizerApplication } from './organizer-application'

describe('submitOrganizerApplication', () => {
  async function makeOrganizer() {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Repeat Org', email: `repeatorg-${crypto.randomUUID()}@test.com`, role: 'ORGANIZER' })
      .returning()
    return organizer
  }
  const inputFor = (organizerId: string, conferenceName: string) => ({
    organizerId,
    conferenceName,
    expectedDate: new Date('2027-08-01'),
    location: 'Pune, India',
    expectedDelegateCount: 100,
    description: 'An organizer can host more than one conference on MUN Hub.',
  })

  it('refuses a new application while an earlier one awaits review, without creating a mun', async () => {
    const organizer = await makeOrganizer()
    await submitOrganizerApplication(inputFor(organizer.id, 'First MUN'))

    await expect(submitOrganizerApplication(inputFor(organizer.id, 'Second MUN'))).rejects.toThrow(APPLICATION_PENDING)
    const owned = await db.select({ id: muns.id }).from(muns).where(eq(muns.organizerId, organizer.id))
    expect(owned).toHaveLength(1)
  })

  // `organizer_applications` has no unique constraint left to fall back on
  // (migration 0030 dropped the organizer_id one), so the "one pending
  // application" rule is only as strong as the row lock the check runs under.
  it('lets exactly one of several simultaneous submissions through', async () => {
    const organizer = await makeOrganizer()

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => submitOrganizerApplication(inputFor(organizer.id, `Race MUN ${i}`))),
    )

    const fulfilled = settled.filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    for (const result of settled.filter((r) => r.status === 'rejected')) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({ message: APPLICATION_PENDING })
    }

    const applications = await db
      .select({ id: organizerApplications.id })
      .from(organizerApplications)
      .where(eq(organizerApplications.organizerId, organizer.id))
    expect(applications).toHaveLength(1)
    const owned = await db.select({ id: muns.id }).from(muns).where(eq(muns.organizerId, organizer.id))
    expect(owned).toHaveLength(1)
  })

  it('lets an organizer apply for another MUN once the earlier application is reviewed', async () => {
    const organizer = await makeOrganizer()
    const first = await submitOrganizerApplication(inputFor(organizer.id, 'First MUN'))
    await db.update(organizerApplications).set({ status: 'APPROVED', reviewNotes: 'Welcome aboard' }).where(eq(organizerApplications.id, first.id))

    const second = await submitOrganizerApplication(inputFor(organizer.id, 'Second MUN'))
    expect(second.munId).not.toBe(first.munId)

    const mine = await listMyOrganizerApplications({ userId: organizer.id, role: 'ORGANIZER' })
    expect(mine.map((a) => a.munName)).toEqual(['Second MUN', 'First MUN'])
    expect(mine[1]).toMatchObject({ status: 'APPROVED', reviewNotes: 'Welcome aboard' })
  })

  it("only lists the organizer's own applications, and only for organizers", async () => {
    const organizer = await makeOrganizer()
    const other = await makeOrganizer()
    await submitOrganizerApplication(inputFor(other.id, 'Someone Else MUN'))

    await expect(listMyOrganizerApplications({ userId: organizer.id, role: 'ORGANIZER' })).resolves.toEqual([])
    await expect(listMyOrganizerApplications({ userId: organizer.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })

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
