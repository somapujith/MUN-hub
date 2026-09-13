import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import {
  createAccommodationOption,
  createAccommodationOptionField,
  deleteAccommodationOption,
  deleteAccommodationOptionField,
  listAccommodationOptionFields,
  listAccommodationOptions,
  updateAccommodationOption,
  updateAccommodationOptionField,
} from './accommodation'

async function makeUser(role: 'ORGANIZER' | 'ADMIN') {
  const [user] = await db.insert(users).values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role }).returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db.insert(muns).values({ organizerId, name: 'Accommodation Mun', slug: `accom-mun-${crypto.randomUUID()}` }).returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('accommodation options CRUD', () => {
  it('lets the owning organizer create, update, and soft-delete an option', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    const session = sessionFor(organizer)

    const option = await createAccommodationOption(
      { munId: mun.id, name: 'Twin Room', price: 1500, capacity: 20, description: 'Shared twin room' },
      session,
    )
    expect(option.price).toBe(1500)
    expect(option.status).toBe('active')

    const updated = await updateAccommodationOption(option.id, { price: 1800 }, session)
    expect(updated.price).toBe(1800)

    await deleteAccommodationOption(option.id, session)
    const list = await listAccommodationOptions(mun.id, { includeInactive: true })
    expect(list.find((o) => o.id === option.id)?.status).toBe('inactive')
  })

  it('excludes soft-deleted options by default, includes them with includeInactive', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    const session = sessionFor(organizer)

    const active = await createAccommodationOption({ munId: mun.id, name: 'Active Room', price: 1000, capacity: 10 }, session)
    const archived = await createAccommodationOption({ munId: mun.id, name: 'Archived Room', price: 1000, capacity: 10 }, session)
    await deleteAccommodationOption(archived.id, session)

    const activeOnly = await listAccommodationOptions(mun.id)
    expect(activeOnly.map((o) => o.id)).toEqual([active.id])

    const all = await listAccommodationOptions(mun.id, { includeInactive: true })
    expect(all.length).toBe(2)
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(
      createAccommodationOption({ munId: mun.id, name: 'Twin Room', price: 1500, capacity: 20 }, sessionFor(stranger)),
    ).rejects.toThrow('Forbidden')
  })

  it('listAccommodationOptions returns only the given mun\'s options', async () => {
    const organizer = await makeUser('ORGANIZER')
    const munA = await makeMun(organizer.id)
    const munB = await makeMun(organizer.id)
    const session = sessionFor(organizer)

    await createAccommodationOption({ munId: munA.id, name: 'A Room', price: 1000, capacity: 10 }, session)
    await createAccommodationOption({ munId: munB.id, name: 'B Room', price: 2000, capacity: 10 }, session)

    const listA = await listAccommodationOptions(munA.id)
    expect(listA.length).toBe(1)
    expect(listA[0].name).toBe('A Room')
  })
})

describe('accommodation option fields', () => {
  it('lets the owning organizer add TEXT/DATE/DROPDOWN fields, list them ordered', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    const session = sessionFor(organizer)
    const option = await createAccommodationOption({ munId: mun.id, name: 'Twin Room', price: 1500, capacity: 20 }, session)

    await createAccommodationOptionField(
      { optionId: option.id, fieldType: 'DATE', label: 'Arrival date', required: true, displayOrder: 1 },
      session,
    )
    await createAccommodationOptionField(
      { optionId: option.id, fieldType: 'TEXT', label: 'Special requests', displayOrder: 2 },
      session,
    )
    const dropdown = await createAccommodationOptionField(
      { optionId: option.id, fieldType: 'DROPDOWN', label: 'Room preference', choices: ['Single', 'Shared'], displayOrder: 0 },
      session,
    )

    const fields = await listAccommodationOptionFields(option.id)
    expect(fields.length).toBe(3)
    expect(fields[0].id).toBe(dropdown.id) // displayOrder 0 sorts first
    expect(fields[0].choices).toEqual(['Single', 'Shared'])
  })

  it('rejects a DROPDOWN field with no choices', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    const session = sessionFor(organizer)
    const option = await createAccommodationOption({ munId: mun.id, name: 'Twin Room', price: 1500, capacity: 20 }, session)

    await expect(
      createAccommodationOptionField({ optionId: option.id, fieldType: 'DROPDOWN', label: 'Room preference' }, session),
    ).rejects.toThrow('requires at least one choice')
  })

  it('lets the owning organizer update and hard-delete a field', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    const session = sessionFor(organizer)
    const option = await createAccommodationOption({ munId: mun.id, name: 'Twin Room', price: 1500, capacity: 20 }, session)
    const field = await createAccommodationOptionField(
      { optionId: option.id, fieldType: 'TEXT', label: 'Notes' },
      session,
    )

    const updated = await updateAccommodationOptionField(field.id, { label: 'Special notes' }, session)
    expect(updated.label).toBe('Special notes')

    await deleteAccommodationOptionField(field.id, session)
    const fields = await listAccommodationOptionFields(option.id)
    expect(fields.length).toBe(0)
  })

  it('rejects a non-owning organizer on field mutations', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)
    const option = await createAccommodationOption({ munId: mun.id, name: 'Twin Room', price: 1500, capacity: 20 }, sessionFor(owner))

    await expect(
      createAccommodationOptionField({ optionId: option.id, fieldType: 'TEXT', label: 'Notes' }, sessionFor(stranger)),
    ).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
