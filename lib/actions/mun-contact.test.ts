import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { getMunContact, upsertMunContact } from './mun-contact'

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
      name: 'Contact Mun',
      slug: `contact-mun-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('mun-contact actions', () => {
  describe('upsertMunContact', () => {
    it('lets the owning organizer create the contact row', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const contact = await upsertMunContact(
        mun.id,
        {
          officialEmail: 'info@mun.example',
          contactPersonName: 'Jane Doe',
          contactPersonEmail: 'jane@mun.example',
        },
        session,
      )

      expect(contact.munId).toBe(mun.id)
      expect(contact.officialEmail).toBe('info@mun.example')
    })

    it('upserts on a second call rather than creating a duplicate row', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const first = await upsertMunContact(
        mun.id,
        { officialEmail: 'first@mun.example', contactPersonName: 'A', contactPersonEmail: 'a@mun.example' },
        session,
      )
      const second = await upsertMunContact(
        mun.id,
        { officialEmail: 'second@mun.example', contactPersonName: 'B', contactPersonEmail: 'b@mun.example' },
        session,
      )

      expect(second.id).toBe(first.id)
      expect(second.officialEmail).toBe('second@mun.example')

      const fetched = await getMunContact(mun.id)
      expect(fetched?.officialEmail).toBe('second@mun.example')
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        upsertMunContact(
          mun.id,
          { officialEmail: 'x@mun.example', contactPersonName: 'X', contactPersonEmail: 'x@mun.example' },
          sessionFor(stranger),
        ),
      ).rejects.toThrow('Forbidden')
    })

    it('lets an admin upsert any mun contact', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)

      const contact = await upsertMunContact(
        mun.id,
        { officialEmail: 'admin-set@mun.example', contactPersonName: 'Admin', contactPersonEmail: 'admin@mun.example' },
        sessionFor(admin),
      )
      expect(contact.officialEmail).toBe('admin-set@mun.example')
    })
  })

  describe('getMunContact', () => {
    it('returns null when no contact row exists yet', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)

      const contact = await getMunContact(mun.id)
      expect(contact).toBeNull()
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
