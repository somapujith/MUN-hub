import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from './client'
import { muns, users, committees, munModuleVerifications } from './schema'

describe('pipeline schema (Task 3: completion axis + unique constraints)', () => {
  it('rejects a second mun_module_verifications row with the same (munId, moduleName)', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Uq Test Mun', slug: `uq-test-${Date.now()}-${Math.random()}` })
      .returning()

    await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'COMMITTEES', state: 'NOT_SUBMITTED' })

    await expect(
      db.insert(munModuleVerifications).values({
        munId: mun.id,
        moduleName: 'COMMITTEES',
        state: 'NOT_SUBMITTED',
      }),
    ).rejects.toThrow()
  })

  it('allows the same moduleName across two different muns (constraint is per-mun, not global)', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org2', email: `org2-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [munA] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Mun A', slug: `mun-a-${Date.now()}-${Math.random()}` })
      .returning()
    const [munB] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Mun B', slug: `mun-b-${Date.now()}-${Math.random()}` })
      .returning()

    const [rowA] = await db
      .insert(munModuleVerifications)
      .values({ munId: munA.id, moduleName: 'BASIC_INFO', state: 'NOT_SUBMITTED' })
      .returning()
    const [rowB] = await db
      .insert(munModuleVerifications)
      .values({ munId: munB.id, moduleName: 'BASIC_INFO', state: 'NOT_SUBMITTED' })
      .returning()

    expect(rowA.moduleName).toBe('BASIC_INFO')
    expect(rowB.moduleName).toBe('BASIC_INFO')
  })

  it('mun_module_verifications completion-axis columns default correctly and round-trip', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org3', email: `org3-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Completion Mun', slug: `completion-mun-${Date.now()}-${Math.random()}` })
      .returning()

    const [row] = await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'PORTFOLIOS', state: 'NOT_SUBMITTED' })
      .returning()

    expect(row.completionStatus).toBe('NOT_STARTED')
    expect(row.isRequired).toBe(true)
    expect(row.completionPercentage).toBe(0)
    expect(row.blockingIssueCount).toBe(0)
    expect(row.lastComputedAt).toBeNull()
    expect(row.completedAt).toBeNull()

    const now = new Date()
    const [updated] = await db
      .update(munModuleVerifications)
      .set({
        completionStatus: 'COMPLETE',
        isRequired: false,
        completionPercentage: 100,
        blockingIssueCount: 0,
        lastComputedAt: now,
        completedAt: now,
      })
      .where(eq(munModuleVerifications.id, row.id))
      .returning()

    expect(updated.completionStatus).toBe('COMPLETE')
    expect(updated.isRequired).toBe(false)
    expect(updated.completionPercentage).toBe(100)
    expect(updated.lastComputedAt?.toISOString()).toBe(now.toISOString())
    expect(updated.completedAt?.toISOString()).toBe(now.toISOString())
  })

  it('muns table round-trips the new PRD Section 9/10/22 columns', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org4', email: `org4-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const registrationOpensAt = new Date('2027-01-01T10:00:00Z')
    const registrationDeadline = new Date('2027-02-01T18:00:00Z')

    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Full Columns Mun',
        slug: `full-columns-mun-${Date.now()}-${Math.random()}`,
        conferenceType: 'IN_PERSON',
        targetParticipantType: 'UNIVERSITY',
        addressLine1: '123 Diplomat Lane',
        addressState: 'Telangana',
        postalCode: '500032',
        mapUrl: 'https://maps.example.com/mun',
        registrationOpensAt,
        registrationDeadline,
        accommodationProvided: 'PROVIDED',
      })
      .returning()

    expect(mun.conferenceType).toBe('IN_PERSON')
    expect(mun.targetParticipantType).toBe('UNIVERSITY')
    expect(mun.addressLine1).toBe('123 Diplomat Lane')
    expect(mun.addressState).toBe('Telangana')
    expect(mun.postalCode).toBe('500032')
    expect(mun.mapUrl).toBe('https://maps.example.com/mun')
    expect(mun.registrationOpensAt?.toISOString()).toBe(registrationOpensAt.toISOString())
    expect(mun.registrationDeadline?.toISOString()).toBe(registrationDeadline.toISOString())
    expect(mun.accommodationProvided).toBe('PROVIDED')
  })

  it('committees table round-trips committeeType and portfoliosEnabled', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org5', email: `org5-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Committee Cols Mun', slug: `committee-cols-mun-${Date.now()}-${Math.random()}` })
      .returning()

    const [committee] = await db
      .insert(committees)
      .values({
        munId: mun.id,
        name: 'UNSC',
        committeeType: 'CRISIS',
        portfoliosEnabled: false,
      })
      .returning()

    expect(committee.committeeType).toBe('CRISIS')
    expect(committee.portfoliosEnabled).toBe(false)

    // Default applies when not explicitly set.
    const [defaultCommittee] = await db
      .insert(committees)
      .values({ munId: mun.id, name: 'UNHRC' })
      .returning()
    expect(defaultCommittee.portfoliosEnabled).toBe(true)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
