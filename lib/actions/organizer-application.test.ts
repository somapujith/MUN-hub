import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, users, verificationLogs } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import {
  APPLICATION_PENDING,
  listMyOrganizerApplications,
  resubmitOrganizerApplication,
  submitOrganizerApplication,
} from './organizer-application'

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
})

describe('resubmitOrganizerApplication', () => {
  function sess(user: { id: string }): Session {
    return { userId: user.id, role: 'ORGANIZER' }
  }

  async function makeChangesRequestedApplication(
    reviewNotes = 'Please clarify your delegate count.',
    fieldsRequiringCorrection: string[] = [],
  ) {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Resubmit Org', email: `resubmitorg-${crypto.randomUUID()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Needs Fixing MUN',
        slug: `needs-fixing-${crypto.randomUUID()}`,
        description: 'Original description that was too vague for review.',
        startDate: new Date('2027-10-01'),
        city: 'Chennai',
        status: 'CHANGES_REQUESTED',
      })
      .returning()
    await db.insert(organizerApplications).values({
      organizerId: organizer.id,
      munId: mun.id,
      status: 'CHANGES_REQUESTED',
      reviewNotes,
      expectedDelegateCount: 50,
      fieldsRequiringCorrection,
    })
    return { organizer, mun }
  }

  const resubmitInputFor = (munId: string) => ({
    munId,
    conferenceName: 'Fixed MUN Name',
    expectedDate: new Date('2027-11-01'),
    location: 'Bengaluru',
    expectedDelegateCount: 250,
    description: 'A much more detailed description addressing the reviewer feedback in full.',
    previousEditions: '2 editions',
    websiteUrl: 'https://fixedmun.example.com',
  })

  it('rejects a signed-out / non-organizer caller', async () => {
    const { mun } = await makeChangesRequestedApplication()
    await expect(resubmitOrganizerApplication(resubmitInputFor(mun.id), null)).rejects.toThrow('Forbidden')
  })

  it('rejects a caller who does not own the application', async () => {
    const { mun } = await makeChangesRequestedApplication()
    const [stranger] = await db
      .insert(users)
      .values({ name: 'Stranger', email: `stranger-${crypto.randomUUID()}@test.com`, role: 'ORGANIZER' })
      .returning()

    await expect(resubmitOrganizerApplication(resubmitInputFor(mun.id), sess(stranger))).rejects.toThrow('Forbidden')

    const [unchanged] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(unchanged.status).toBe('CHANGES_REQUESTED')
  })

  it('rejects a munId with no application at all', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'No App Org', email: `noapp-${crypto.randomUUID()}@test.com`, role: 'ORGANIZER' })
      .returning()

    await expect(
      resubmitOrganizerApplication(resubmitInputFor(crypto.randomUUID()), sess(organizer)),
    ).rejects.toThrow('Application not found')
  })

  it('rejects an application that is no longer CHANGES_REQUESTED (via the state machine, not a duplicated check)', async () => {
    const { organizer, mun } = await makeChangesRequestedApplication()
    // Simulate MUN Hub having already approved it and moved it into ONBOARDING.
    await db.update(muns).set({ status: 'ONBOARDING' }).where(eq(muns.id, mun.id))
    await db.update(organizerApplications).set({ status: 'APPROVED' }).where(eq(organizerApplications.munId, mun.id))

    await expect(resubmitOrganizerApplication(resubmitInputFor(mun.id), sess(organizer))).rejects.toThrow(
      'Invalid transition from ONBOARDING to SUBMITTED',
    )
  })

  it('resubmits: mun + application flip to SUBMITTED, edited fields are saved, reviewNotes clears, and an audit log is written', async () => {
    const { organizer, mun } = await makeChangesRequestedApplication('Fix your description — too vague.', [
      'description',
    ])
    const input = resubmitInputFor(mun.id)

    const updated = await resubmitOrganizerApplication(input, sess(organizer))

    expect(updated.status).toBe('SUBMITTED')
    expect(updated.reviewNotes).toBeNull()
    expect(updated.expectedDelegateCount).toBe(250)
    expect(updated.previousEditions).toBe('2 editions')
    expect(updated.websiteUrl).toBe('https://fixedmun.example.com')
    // resubmissionCount goes up, and the previous round's flagged fields are
    // cleared — they described a round that's now over.
    expect(updated.resubmissionCount).toBe(1)
    expect(updated.fieldsRequiringCorrection).toEqual([])

    const [refreshedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(refreshedMun.status).toBe('SUBMITTED')
    expect(refreshedMun.name).toBe('Fixed MUN Name')
    expect(refreshedMun.city).toBe('Bengaluru')
    expect(refreshedMun.description).toBe(input.description)
    expect(refreshedMun.startDate?.toISOString()).toBe(new Date('2027-11-01').toISOString())

    // transitionMun's own audit-log convention — the same one reviewMunApplication relies on.
    const logs = await db
      .select()
      .from(verificationLogs)
      .where(eq(verificationLogs.munId, mun.id))
      .orderBy(verificationLogs.createdAt)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('SUBMITTED')
    expect(logs[0].reviewerId).toBe(organizer.id)
  })

  it('is a real loop: a resubmitted application can be sent through CHANGES_REQUESTED and resubmitted again', async () => {
    const { organizer, mun } = await makeChangesRequestedApplication()
    await resubmitOrganizerApplication(resubmitInputFor(mun.id), sess(organizer))

    // A second Gate-1 review round also asks for changes.
    await db.update(muns).set({ status: 'CHANGES_REQUESTED' }).where(eq(muns.id, mun.id))
    await db
      .update(organizerApplications)
      .set({ status: 'CHANGES_REQUESTED', reviewNotes: 'Still not enough detail.' })
      .where(eq(organizerApplications.munId, mun.id))

    const second = await resubmitOrganizerApplication(
      { ...resubmitInputFor(mun.id), conferenceName: 'Fixed Again MUN' },
      sess(organizer),
    )
    expect(second.status).toBe('SUBMITTED')
    expect(second.resubmissionCount).toBe(2)

    const logs = await db
      .select({ action: verificationLogs.action })
      .from(verificationLogs)
      .where(eq(verificationLogs.munId, mun.id))
      .orderBy(verificationLogs.createdAt)
    expect(logs.map((l) => l.action)).toEqual(['SUBMITTED', 'SUBMITTED'])
  })
})

afterAll(async () => {
  await db.$client.end()
})
