import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { committees, munScheduleItems, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { createScheduleItem, deleteScheduleItem, listScheduleItems, updateScheduleItem } from './mun-schedule'

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
      name: 'Schedule Mun',
      slug: `schedule-mun-${crypto.randomUUID()}`,
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

describe('mun-schedule actions', () => {
  describe('createScheduleItem', () => {
    it('lets the owning organizer create a schedule item', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const item = await createScheduleItem(
        {
          munId: mun.id,
          title: 'Opening Ceremony',
          kind: 'OPENING_CEREMONY',
          startsAt: new Date('2027-01-01T09:00:00Z'),
          endsAt: new Date('2027-01-01T10:00:00Z'),
        },
        session,
      )

      expect(item.munId).toBe(mun.id)
      expect(item.title).toBe('Opening Ceremony')
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        createScheduleItem(
          {
            munId: mun.id,
            title: 'Opening',
            kind: 'OPENING_CEREMONY',
            startsAt: new Date('2027-01-01T09:00:00Z'),
            endsAt: new Date('2027-01-01T10:00:00Z'),
          },
          sessionFor(stranger),
        ),
      ).rejects.toThrow('Forbidden')
    })

    it('rejects endsAt before startsAt', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await expect(
        createScheduleItem(
          {
            munId: mun.id,
            title: 'Broken',
            kind: 'OTHER',
            startsAt: new Date('2027-01-01T10:00:00Z'),
            endsAt: new Date('2027-01-01T09:00:00Z'),
          },
          session,
        ),
      ).rejects.toThrow(/endsAt must be after startsAt/)
    })

    it('rejects endsAt equal to startsAt', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const t = new Date('2027-01-01T09:00:00Z')

      await expect(
        createScheduleItem({ munId: mun.id, title: 'Zero-length', kind: 'OTHER', startsAt: t, endsAt: t }, session),
      ).rejects.toThrow(/endsAt must be after startsAt/)
    })

    it('rejects a committeeId belonging to a different mun (IDOR)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const committeeOfB = await makeCommittee(munB.id)
      const session = sessionFor(organizer)

      await expect(
        createScheduleItem(
          {
            munId: munA.id,
            committeeId: committeeOfB.id,
            title: 'Session',
            kind: 'COMMITTEE_SESSION',
            startsAt: new Date('2027-01-01T09:00:00Z'),
            endsAt: new Date('2027-01-01T10:00:00Z'),
          },
          session,
        ),
      ).rejects.toThrow('Forbidden')
    })
  })

  describe('updateScheduleItem', () => {
    it('lets the owning organizer update a schedule item', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const item = await createScheduleItem(
        {
          munId: mun.id,
          title: 'Lunch',
          kind: 'LUNCH',
          startsAt: new Date('2027-01-01T12:00:00Z'),
          endsAt: new Date('2027-01-01T13:00:00Z'),
        },
        session,
      )

      const updated = await updateScheduleItem(item.id, { title: 'Lunch Break' }, session)
      expect(updated.title).toBe('Lunch Break')
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const item = await createScheduleItem(
        {
          munId: mun.id,
          title: 'Lunch',
          kind: 'LUNCH',
          startsAt: new Date('2027-01-01T12:00:00Z'),
          endsAt: new Date('2027-01-01T13:00:00Z'),
        },
        sessionFor(owner),
      )

      await expect(updateScheduleItem(item.id, { title: 'Hacked' }, sessionFor(stranger))).rejects.toThrow(
        'Forbidden',
      )
    })

    it('rejects an update that makes endsAt before startsAt', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const item = await createScheduleItem(
        {
          munId: mun.id,
          title: 'Session',
          kind: 'COMMITTEE_SESSION',
          startsAt: new Date('2027-01-01T09:00:00Z'),
          endsAt: new Date('2027-01-01T11:00:00Z'),
        },
        session,
      )

      await expect(
        updateScheduleItem(item.id, { endsAt: new Date('2027-01-01T08:00:00Z') }, session),
      ).rejects.toThrow(/endsAt must be after startsAt/)
    })

    it('rejects updating to a committeeId from a different mun (IDOR)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const committeeOfB = await makeCommittee(munB.id)
      const session = sessionFor(organizer)
      const item = await createScheduleItem(
        {
          munId: munA.id,
          title: 'Session',
          kind: 'COMMITTEE_SESSION',
          startsAt: new Date('2027-01-01T09:00:00Z'),
          endsAt: new Date('2027-01-01T11:00:00Z'),
        },
        session,
      )

      await expect(updateScheduleItem(item.id, { committeeId: committeeOfB.id }, session)).rejects.toThrow(
        'Forbidden',
      )
    })
  })

  describe('deleteScheduleItem', () => {
    it('lets the owning organizer delete a schedule item', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const item = await createScheduleItem(
        {
          munId: mun.id,
          title: 'Break',
          kind: 'BREAK',
          startsAt: new Date('2027-01-01T09:00:00Z'),
          endsAt: new Date('2027-01-01T09:15:00Z'),
        },
        session,
      )

      await deleteScheduleItem(item.id, session)

      const [row] = await db.select().from(munScheduleItems).where(eq(munScheduleItems.id, item.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const item = await createScheduleItem(
        {
          munId: mun.id,
          title: 'Break',
          kind: 'BREAK',
          startsAt: new Date('2027-01-01T09:00:00Z'),
          endsAt: new Date('2027-01-01T09:15:00Z'),
        },
        sessionFor(owner),
      )

      await expect(deleteScheduleItem(item.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })
  })

  describe('listScheduleItems', () => {
    it('lists items scoped to the given mun only, ordered by start time', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createScheduleItem(
        { munId: munA.id, title: 'Second', kind: 'OTHER', startsAt: new Date('2027-01-01T11:00:00Z'), endsAt: new Date('2027-01-01T12:00:00Z') },
        session,
      )
      await createScheduleItem(
        { munId: munA.id, title: 'First', kind: 'OTHER', startsAt: new Date('2027-01-01T09:00:00Z'), endsAt: new Date('2027-01-01T10:00:00Z') },
        session,
      )
      await createScheduleItem(
        { munId: munB.id, title: 'Other Mun', kind: 'OTHER', startsAt: new Date('2027-01-01T09:00:00Z'), endsAt: new Date('2027-01-01T10:00:00Z') },
        session,
      )

      const listA = await listScheduleItems(munA.id)
      expect(listA).toHaveLength(2)
      expect(listA.map((i) => i.title)).toEqual(['First', 'Second'])
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
