import { beforeAll, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  accommodationOptionFields,
  accommodationOptions,
  committees,
  munExecutiveBoard,
  munFormFields,
  muns,
  registrationProducts,
  users,
} from '@/lib/db/schema'
import { DEFAULT_REGISTRATION_FIELDS } from '@/lib/actions/registration-form-defaults'
import { createApp } from '../src/app'
import { makeCompleteMun } from './fixtures/go-live-fixtures'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

type Fixture = {
  munId: string
  committeeId: string
  optionId: string
}

async function makeOperationsUser() {
  const [user] = await db
    .insert(users)
    .values({ name: 'OPERATIONS', email: `operations-${crypto.randomUUID()}@test.com`, role: 'OPERATIONS' })
    .returning()
  return user
}

/** A complete MUN (contact, documents, media, schedule, board, committee, product) plus accommodation. */
async function makeFixture(organizerId: string, status: 'ONBOARDING' | 'VERIFICATION' | 'PUBLISHED'): Promise<Fixture> {
  const mun = await makeCompleteMun(organizerId)
  await db.update(muns).set({ status }).where(eq(muns.id, mun.id))

  const [committee] = await db.select({ id: committees.id }).from(committees).where(eq(committees.munId, mun.id))
  await db.insert(munExecutiveBoard).values({ munId: mun.id, name: 'Hidden Member', role: 'CHAIR', isPublic: false })
  await db.insert(registrationProducts).values({ munId: mun.id, name: 'Retired', price: 500, capacity: 5, status: 'inactive' })

  const [option] = await db
    .insert(accommodationOptions)
    .values({ munId: mun.id, name: 'Hostel', price: 1000, capacity: 10 })
    .returning()
  await db.insert(accommodationOptions).values({ munId: mun.id, name: 'Archived Hotel', price: 5000, capacity: 5, status: 'inactive' })
  await db.insert(accommodationOptionFields).values({ optionId: option.id, fieldType: 'TEXT', label: 'Roommate preference' })

  return { munId: mun.id, committeeId: committee.id, optionId: option.id }
}

async function formFieldRowCount(munId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(munFormFields).where(eq(munFormFields.munId, munId))
  return row.n
}

/** Every by-id public read, as [label, path] pairs. */
function readPaths(f: Fixture): Array<[string, string]> {
  return [
    ['contact', `/api/v1/muns/${f.munId}/contact`],
    ['documents', `/api/v1/muns/${f.munId}/documents`],
    ['committees', `/api/v1/muns/${f.munId}/committees`],
    ['portfolios', `/api/v1/committees/${f.committeeId}/portfolios`],
    ['schedule', `/api/v1/muns/${f.munId}/schedule`],
    ['media', `/api/v1/muns/${f.munId}/media`],
    ['accommodation', `/api/v1/muns/${f.munId}/accommodation`],
    ['accommodation fields', `/api/v1/accommodation/${f.optionId}/fields`],
    ['executive board', `/api/v1/muns/${f.munId}/executive-board`],
    ['form fields', `/api/v1/muns/${f.munId}/form-fields`],
    ['products', `/api/v1/muns/${f.munId}/products`],
  ]
}

let owner: Awaited<ReturnType<typeof makeUser>>
let unpublished: Fixture
let inReview: Fixture
let published: Fixture
let headers: {
  owner: Record<string, string>
  otherOrganizer: Record<string, string>
  student: Record<string, string>
  admin: Record<string, string>
  operations: Record<string, string>
}

beforeAll(async () => {
  owner = await makeUser('ORGANIZER')
  unpublished = await makeFixture(owner.id, 'ONBOARDING')
  inReview = await makeFixture(owner.id, 'VERIFICATION')
  published = await makeFixture(owner.id, 'PUBLISHED')

  const [otherOrganizer, student, admin, operations] = await Promise.all([
    makeUser('ORGANIZER'),
    makeUser('STUDENT'),
    makeUser('ADMIN'),
    makeOperationsUser(),
  ])
  headers = {
    owner: await authHeaders(owner.id),
    otherOrganizer: await authHeaders(otherOrganizer.id),
    student: await authHeaders(student.id),
    admin: await authHeaders(admin.id),
    operations: await authHeaders(operations.id),
  }
})

describe('by-id MUN reads: published-or-owner guard', () => {
  it('404s every read of an unpublished MUN for anonymous callers, students and other organizers', async () => {
    for (const fixture of [unpublished, inReview]) {
      for (const [label, path] of readPaths(fixture)) {
        for (const [who, init] of [
          ['anonymous', {}],
          ['student', { headers: headers.student }],
          ['other organizer', { headers: headers.otherOrganizer }],
        ] as const) {
          const res = await app.request(path, init)
          expect(res.status, `${label} as ${who}`).toBe(404)
          expect((await res.json()).error.code, `${label} as ${who}`).toBe('NOT_FOUND')
        }
      }
    }
  })

  it('serves every read of an unpublished MUN to its owner, admins and operations staff', async () => {
    for (const [label, path] of readPaths(unpublished)) {
      for (const who of ['owner', 'admin', 'operations'] as const) {
        const res = await app.request(path, { headers: headers[who] })
        expect(res.status, `${label} as ${who}`).toBe(200)
      }
    }
  })

  it('serves every read of a published MUN to anonymous callers', async () => {
    for (const [label, path] of readPaths(published)) {
      const res = await app.request(path)
      expect(res.status, label).toBe(200)
    }
  })

  it('404s unknown and malformed ids instead of erroring', async () => {
    for (const id of [crypto.randomUUID(), 'not-a-uuid', "x' or '1'='1"]) {
      const encoded = encodeURIComponent(id)
      for (const path of [
        `/api/v1/muns/${encoded}/contact`,
        `/api/v1/muns/${encoded}/committees`,
        `/api/v1/muns/${encoded}/form-fields`,
        `/api/v1/committees/${encoded}/portfolios`,
        `/api/v1/accommodation/${encoded}/fields`,
      ]) {
        const res = await app.request(path, { headers: headers.owner })
        expect(res.status, path).toBe(404)
      }
    }
  })
})

describe('GET /muns/:munId/contact', () => {
  const PERSON_FIELDS = ['contactPersonName', 'contactPersonRole', 'contactPersonEmail', 'contactPersonPhone']

  it('shows anonymous callers only the official channels of a published MUN', async () => {
    const res = await app.request(`/api/v1/muns/${published.munId}/contact`)
    const contact = await res.json()
    expect(contact.officialEmail).toBe('contact@api.test')
    expect(contact.phone).toBe('+911234567890')
    for (const field of PERSON_FIELDS) {
      expect(contact, field).not.toHaveProperty(field)
    }
  })

  it('shows the owner and staff the contact person', async () => {
    for (const who of ['owner', 'admin', 'operations'] as const) {
      const contact = await (await app.request(`/api/v1/muns/${published.munId}/contact`, { headers: headers[who] })).json()
      expect(contact.contactPersonName, who).toBe('Jane Organizer')
      expect(contact.contactPersonEmail, who).toBe('jane@api.test')
    }
  })

  it('does not show a signed-in non-owner the contact person', async () => {
    const contact = await (
      await app.request(`/api/v1/muns/${published.munId}/contact`, { headers: headers.student })
    ).json()
    expect(contact.officialEmail).toBe('contact@api.test')
    expect(contact).not.toHaveProperty('contactPersonEmail')
  })
})

describe('GET /muns/:munId/form-fields', () => {
  it('never writes for anonymous callers, published or not', async () => {
    const fixture = await makeFixture(owner.id, 'ONBOARDING')
    expect(await formFieldRowCount(fixture.munId)).toBe(0)

    expect((await app.request(`/api/v1/muns/${fixture.munId}/form-fields`)).status).toBe(404)
    expect(await formFieldRowCount(fixture.munId)).toBe(0)

    await db.update(muns).set({ status: 'PUBLISHED' }).where(eq(muns.id, fixture.munId))
    const res = await app.request(`/api/v1/muns/${fixture.munId}/form-fields`)
    expect(res.status).toBe(200)
    expect(await formFieldRowCount(fixture.munId)).toBe(0)

    // The default questions are still shown, as read-only synthetic fields.
    const fields: Array<{ id: string; fieldKey: string }> = await res.json()
    expect(fields.map((f) => f.fieldKey)).toEqual(DEFAULT_REGISTRATION_FIELDS.map((f) => f.fieldKey))
    expect(fields.every((f) => f.id === `default:${f.fieldKey}`)).toBe(true)
  })

  it('never writes for operations staff', async () => {
    const fixture = await makeFixture(owner.id, 'VERIFICATION')
    const res = await app.request(`/api/v1/muns/${fixture.munId}/form-fields`, { headers: headers.operations })
    expect(res.status).toBe(200)
    expect(await formFieldRowCount(fixture.munId)).toBe(0)
  })

  it('materializes the default fields for the owner', async () => {
    const fixture = await makeFixture(owner.id, 'ONBOARDING')
    const res = await app.request(`/api/v1/muns/${fixture.munId}/form-fields`, { headers: headers.owner })
    expect(res.status).toBe(200)
    expect(await formFieldRowCount(fixture.munId)).toBe(DEFAULT_REGISTRATION_FIELDS.length)
    const fields: Array<{ id: string }> = await res.json()
    expect(fields).toHaveLength(DEFAULT_REGISTRATION_FIELDS.length)
    expect(fields.some((f) => f.id.startsWith('default:'))).toBe(false)
  })
})

describe('archived rows stay owner-only', () => {
  it('ignores includeInactive for anyone but the owner or an admin', async () => {
    for (const [resource, nameOfArchived] of [
      ['accommodation', 'Archived Hotel'],
      ['products', 'Retired'],
    ] as const) {
      const path = `/api/v1/muns/${published.munId}/${resource}?includeInactive=true`
      for (const init of [{}, { headers: headers.student }, { headers: headers.operations }]) {
        const names = ((await (await app.request(path, init)).json()) as Array<{ name: string }>).map((r) => r.name)
        expect(names, resource).not.toContain(nameOfArchived)
      }
      for (const who of ['owner', 'admin'] as const) {
        const names = ((await (await app.request(path, { headers: headers[who] })).json()) as Array<{ name: string }>).map(
          (r) => r.name,
        )
        expect(names, `${resource} as ${who}`).toContain(nameOfArchived)
      }
    }
  })

  it('lists only public executive board members on the public route', async () => {
    const members: Array<{ name: string }> = await (
      await app.request(`/api/v1/muns/${published.munId}/executive-board`)
    ).json()
    expect(members.map((m) => m.name)).toContain('Chair One')
    expect(members.map((m) => m.name)).not.toContain('Hidden Member')
  })
})
