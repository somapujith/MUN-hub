import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { committees, munExecutiveBoard, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { createEbMember, deleteEbMember, listEbMembers, updateEbMember } from './executive-board'

async function makeUser(role: 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, overrides: Partial<typeof muns.$inferInsert> = {}) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'EB Mun',
      slug: `eb-mun-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  return mun
}

async function makeCommittee(munId: string) {
  const [committee] = await db.insert(committees).values({ munId, name: 'UNGA', capacity: 50 }).returning()
  return committee
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('executive-board actions', () => {
  describe('createEbMember', () => {
    it('lets the owning organizer create a mun-level EB member', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const member = await createEbMember(
        { munId: mun.id, name: 'Secretary General', role: 'CHAIR' },
        session,
      )

      expect(member.munId).toBe(mun.id)
      expect(member.name).toBe('Secretary General')
      expect(member.committeeId).toBeNull()
      expect(member.isPublic).toBe(true)
    })

    it('persists institution, organization, social links, and public visibility', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)

      const member = await createEbMember(
        {
          munId: mun.id,
          name: 'Secretary General',
          role: 'CHAIR',
          institution: 'VIT Vellore',
          organization: 'VIT MUN Society',
          socialLinks: { instagram: 'https://instagram.com/vitmun' },
          isPublic: false,
        },
        sessionFor(organizer),
      )

      expect(member.institution).toBe('VIT Vellore')
      expect(member.organization).toBe('VIT MUN Society')
      expect(member.socialLinks).toEqual({ instagram: 'https://instagram.com/vitmun' })
      expect(member.isPublic).toBe(false)
      expect(await listEbMembers(mun.id)).toHaveLength(0)
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        createEbMember({ munId: mun.id, name: 'Chair', role: 'CHAIR' }, sessionFor(stranger)),
      ).rejects.toThrow('Forbidden')
    })

    it('rejects a CUSTOM role with an empty customRole', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await expect(
        createEbMember({ munId: mun.id, name: 'Someone', role: 'CUSTOM' }, session),
      ).rejects.toThrow(/customRole/)

      await expect(
        createEbMember({ munId: mun.id, name: 'Someone', role: 'CUSTOM', customRole: '  ' }, session),
      ).rejects.toThrow(/customRole/)
    })

    it('accepts a CUSTOM role with a non-empty customRole', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const member = await createEbMember(
        { munId: mun.id, name: 'Someone', role: 'CUSTOM', customRole: 'Deputy Secretary-General' },
        session,
      )
      expect(member.customRole).toBe('Deputy Secretary-General')
    })

    it('rejects a committeeId belonging to a different mun (IDOR)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const committeeOfB = await makeCommittee(munB.id)
      const session = sessionFor(organizer)

      await expect(
        createEbMember(
          { munId: munA.id, committeeId: committeeOfB.id, name: 'Chair', role: 'CHAIR' },
          session,
        ),
      ).rejects.toThrow('Forbidden')
    })

    it('accepts a committeeId belonging to the same mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const committee = await makeCommittee(mun.id)
      const session = sessionFor(organizer)

      const member = await createEbMember(
        { munId: mun.id, committeeId: committee.id, name: 'Chair', role: 'CHAIR' },
        session,
      )
      expect(member.committeeId).toBe(committee.id)
    })
  })

  describe('updateEbMember', () => {
    it('lets the owning organizer update a member', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const member = await createEbMember({ munId: mun.id, name: 'Chair', role: 'CHAIR' }, session)

      const updated = await updateEbMember(member.id, { name: 'New Chair' }, session)
      expect(updated.name).toBe('New Chair')
    })

    it('updates the new profile and visibility fields without clearing existing fields', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const member = await createEbMember(
        {
          munId: mun.id,
          name: 'Chair',
          role: 'CHAIR',
          institution: 'Original Institution',
          organization: 'Original Organization',
          socialLinks: { website: 'https://example.com' },
        },
        session,
      )

      const updated = await updateEbMember(member.id, { institution: 'Updated Institution', isPublic: false }, session)

      expect(updated.institution).toBe('Updated Institution')
      expect(updated.organization).toBe('Original Organization')
      expect(updated.socialLinks).toEqual({ website: 'https://example.com' })
      expect(updated.isPublic).toBe(false)
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const member = await createEbMember({ munId: mun.id, name: 'Chair', role: 'CHAIR' }, sessionFor(owner))

      await expect(updateEbMember(member.id, { name: 'Hacked' }, sessionFor(stranger))).rejects.toThrow(
        'Forbidden',
      )
    })

    it('rejects switching to CUSTOM without a customRole', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const member = await createEbMember({ munId: mun.id, name: 'Chair', role: 'CHAIR' }, session)

      await expect(updateEbMember(member.id, { role: 'CUSTOM' }, session)).rejects.toThrow(/customRole/)
    })

    it('rejects updating to a committeeId from a different mun (IDOR)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const committeeOfB = await makeCommittee(munB.id)
      const session = sessionFor(organizer)
      const member = await createEbMember({ munId: munA.id, name: 'Chair', role: 'CHAIR' }, session)

      await expect(updateEbMember(member.id, { committeeId: committeeOfB.id }, session)).rejects.toThrow(
        'Forbidden',
      )
    })
  })

  describe('deleteEbMember', () => {
    it('lets the owning organizer delete a member', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const member = await createEbMember({ munId: mun.id, name: 'Chair', role: 'CHAIR' }, session)

      await deleteEbMember(member.id, session)

      const [row] = await db.select().from(munExecutiveBoard).where(eq(munExecutiveBoard.id, member.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const member = await createEbMember({ munId: mun.id, name: 'Chair', role: 'CHAIR' }, sessionFor(owner))

      await expect(deleteEbMember(member.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })
  })

  describe('listEbMembers', () => {
    it('lists members scoped to the given mun only', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createEbMember({ munId: munA.id, name: 'A Chair', role: 'CHAIR' }, session)
      await createEbMember({ munId: munB.id, name: 'B Chair', role: 'CHAIR' }, session)

      const listA = await listEbMembers(munA.id)
      expect(listA).toHaveLength(1)
      expect(listA[0].name).toBe('A Chair')
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
