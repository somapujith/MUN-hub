import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import {
  createCommittee,
  createRegistrationProduct,
  deleteRegistrationProduct,
} from '@/lib/actions/mun-config'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Products API Mun',
      slug: `products-api-${crypto.randomUUID()}`,
      status: 'ONBOARDING',
    })
    .returning()
  return mun
}

async function publishMunForProductsTest(munId: string) {
  await db
    .update(muns)
    .set({ status: 'PUBLISHED', publishedAt: new Date() })
    .where(eq(muns.id, munId))
}

describe('GET /api/v1/muns/:slug/products?includeInactive=true', () => {
  it('silently defaults to active-only for anonymous callers (IDOR guard)', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)
    await publishMunForProductsTest(mun.id)
    const session = { userId: organizer.id, role: 'ORGANIZER' as const }

    const active = await createRegistrationProduct(
      { munId: mun.id, name: 'Active', price: 1000, capacity: 10 },
      session,
    )
    const archived = await createRegistrationProduct(
      { munId: mun.id, name: 'Archived', price: 1000, capacity: 10 },
      session,
    )
    await deleteRegistrationProduct(archived.id, session)

    const res = await app.request(`/api/v1/muns/${mun.slug}/products?includeInactive=true`)

    expect(res.status).toBe(200)
    const products = await res.json()
    expect(products.map((p: { id: string }) => p.id)).toEqual([active.id])
  })

  it('returns inactive products when includeInactive=true and caller owns the mun', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)
    await publishMunForProductsTest(mun.id)
    const session = { userId: organizer.id, role: 'ORGANIZER' as const }
    const headers = await authHeaders(organizer.id)

    const active = await createRegistrationProduct(
      { munId: mun.id, name: 'Active', price: 1000, capacity: 10 },
      session,
    )
    const archived = await createRegistrationProduct(
      { munId: mun.id, name: 'Archived', price: 1000, capacity: 10 },
      session,
    )
    await deleteRegistrationProduct(archived.id, session)

    const res = await app.request(`/api/v1/muns/${mun.slug}/products?includeInactive=true`, { headers })

    expect(res.status).toBe(200)
    const products = await res.json()
    expect(products.length).toBe(2)
    expect(products.map((p: { id: string }) => p.id).sort()).toEqual([active.id, archived.id].sort())
  })
})

describe('GET /api/v1/muns/:munId/products (by id)', () => {
  it('is not shadowed by the public by-slug route: the owner lists an unpublished mun\'s passes by id', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)
    const session = { userId: organizer.id, role: 'ORGANIZER' as const }
    const headers = await authHeaders(organizer.id)

    const active = await createRegistrationProduct(
      { munId: mun.id, name: 'Active', price: 1000, capacity: 10 },
      session,
    )
    const archived = await createRegistrationProduct(
      { munId: mun.id, name: 'Archived', price: 1000, capacity: 10 },
      session,
    )
    await deleteRegistrationProduct(archived.id, session)

    const res = await app.request(`/api/v1/muns/${mun.id}/products?includeInactive=true`, { headers })

    expect(res.status).toBe(200)
    const products = await res.json()
    expect(products.map((p: { id: string }) => p.id).sort()).toEqual([active.id, archived.id].sort())
  })

  it('still resolves a published mun by id (active passes only for anonymous callers)', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)
    await publishMunForProductsTest(mun.id)
    const session = { userId: organizer.id, role: 'ORGANIZER' as const }
    const active = await createRegistrationProduct(
      { munId: mun.id, name: 'Active', price: 1000, capacity: 10 },
      session,
    )
    const archived = await createRegistrationProduct(
      { munId: mun.id, name: 'Archived', price: 1000, capacity: 10 },
      session,
    )
    await deleteRegistrationProduct(archived.id, session)

    const res = await app.request(`/api/v1/muns/${mun.id}/products?includeInactive=true`)

    expect(res.status).toBe(200)
    const products = await res.json()
    expect(products.map((p: { id: string }) => p.id)).toEqual([active.id])
  })
})

describe('POST /api/v1/committees/:committeeId/portfolios/bulk', () => {
  const postBulk = (committeeId: string, body: unknown, headers: Record<string, string>) =>
    app.request(`/api/v1/committees/${committeeId}/portfolios/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('adds the list for the owner, refuses duplicates with 409 and strangers with 403', async () => {
    const organizer = await makeUser()
    const mun = await makeMun(organizer.id)
    const session = { userId: organizer.id, role: 'ORGANIZER' as const }
    const committee = await createCommittee({ munId: mun.id, name: 'UNGA', capacity: 100 }, session)
    const headers = await authHeaders(organizer.id)

    const created = await postBulk(
      committee.id,
      { portfolios: [{ name: 'Ghana', type: 'country' }, { name: 'Peru', type: 'country', availability: 2 }] },
      headers,
    )
    expect(created.status).toBe(201)
    expect((await created.json()).map((p: { name: string }) => p.name)).toEqual(['Ghana', 'Peru'])

    const duplicate = await postBulk(committee.id, { portfolios: [{ name: 'ghana' }] }, headers)
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error.code).toBe('CONFLICT_UNIQUE')

    const empty = await postBulk(committee.id, { portfolios: [] }, headers)
    expect(empty.status).toBe(400)

    const stranger = await makeUser()
    const forbidden = await postBulk(committee.id, { portfolios: [{ name: 'Chile' }] }, await authHeaders(stranger.id))
    expect(forbidden.status).toBe(403)

    const list = await app.request(`/api/v1/committees/${committee.id}/portfolios`, { headers })
    expect((await list.json()).length).toBe(2)
  })
})
