import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import {
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
