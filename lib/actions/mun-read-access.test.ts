import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { accommodationOptions, committees, muns, users } from '@/lib/db/schema'
import type { MunStatus, Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { PUBLIC_DETAIL_STATUSES } from './marketplace'
import {
  assertMunReadable,
  findMunIdForAccommodationOption,
  findMunIdForCommittee,
  resolveMunReadAccess,
} from './mun-read-access'

async function makeUser(role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: MunStatus) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Read Access Mun', slug: `read-access-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('resolveMunReadAccess', () => {
  it('gives the owner, admins and super admins owner access in any status', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const superAdmin = await makeUser('SUPER_ADMIN')
    for (const status of ['DRAFT', 'ONBOARDING', 'VERIFICATION', 'PUBLISHED'] as const) {
      const mun = await makeMun(organizer.id, status)
      expect(await resolveMunReadAccess(mun.id, sessionFor(organizer)), status).toBe('owner')
      expect(await resolveMunReadAccess(mun.id, sessionFor(admin)), status).toBe('owner')
      expect(await resolveMunReadAccess(mun.id, sessionFor(superAdmin)), status).toBe('owner')
    }
  })

  it('gives operations staff read-only staff access in any status', async () => {
    const organizer = await makeUser('ORGANIZER')
    const operations = await makeUser('OPERATIONS')
    for (const status of ['ONBOARDING', 'PUBLISHED'] as const) {
      const mun = await makeMun(organizer.id, status)
      expect(await resolveMunReadAccess(mun.id, sessionFor(operations)), status).toBe('staff')
    }
  })

  it('gives everyone else public access only to publicly visible statuses', async () => {
    const organizer = await makeUser('ORGANIZER')
    const otherOrganizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')

    for (const status of PUBLIC_DETAIL_STATUSES) {
      const mun = await makeMun(organizer.id, status)
      expect(await resolveMunReadAccess(mun.id, null), status).toBe('public')
      expect(await resolveMunReadAccess(mun.id, sessionFor(student)), status).toBe('public')
      expect(await resolveMunReadAccess(mun.id, sessionFor(otherOrganizer)), status).toBe('public')
    }

    for (const status of ['DRAFT', 'SUBMITTED', 'ONBOARDING', 'CONTENT_SUBMITTED', 'VERIFICATION', 'VERIFIED', 'GO_LIVE_QUEUE', 'UNPUBLISHED', 'SUSPENDED', 'CANCELLED'] as const) {
      const mun = await makeMun(organizer.id, status)
      expect(await resolveMunReadAccess(mun.id, null), status).toBe('none')
      expect(await resolveMunReadAccess(mun.id, sessionFor(student)), status).toBe('none')
      expect(await resolveMunReadAccess(mun.id, sessionFor(otherOrganizer)), status).toBe('none')
    }
  })

  it('returns none for unknown and malformed ids, even for admins', async () => {
    const admin = await makeUser('ADMIN')
    expect(await resolveMunReadAccess(crypto.randomUUID(), sessionFor(admin))).toBe('none')
    expect(await resolveMunReadAccess('not-a-uuid', sessionFor(admin))).toBe('none')
    expect(await resolveMunReadAccess('', null)).toBe('none')
  })
})

describe('assertMunReadable', () => {
  it('throws "Mun not found" when there is no access, else returns the level', async () => {
    const organizer = await makeUser('ORGANIZER')
    const draft = await makeMun(organizer.id, 'ONBOARDING')
    const live = await makeMun(organizer.id, 'REGISTRATION_OPEN')

    await expect(assertMunReadable(draft.id, null)).rejects.toThrow('Mun not found')
    await expect(assertMunReadable(draft.id, sessionFor(organizer))).resolves.toBe('owner')
    await expect(assertMunReadable(live.id, null)).resolves.toBe('public')
  })
})

describe('child id lookups', () => {
  it('resolve a committee and an accommodation option to their MUN', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'ONBOARDING')
    const [committee] = await db.insert(committees).values({ munId: mun.id, name: 'UNSC', capacity: 10 }).returning()
    const [option] = await db
      .insert(accommodationOptions)
      .values({ munId: mun.id, name: 'Hostel', price: 100, capacity: 5 })
      .returning()

    expect(await findMunIdForCommittee(committee.id)).toBe(mun.id)
    expect(await findMunIdForAccommodationOption(option.id)).toBe(mun.id)
    expect(await findMunIdForCommittee(crypto.randomUUID())).toBeNull()
    expect(await findMunIdForAccommodationOption('nope')).toBeNull()
  })
})

afterAll(async () => {
  await db.$client.end()
})
