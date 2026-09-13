import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, users } from '@/lib/db/schema'
import { getMarketplaceFacets, getMunBySlug, listPublicMunSlugs, searchMuns } from './marketplace'

describe('marketplace actions', () => {
  const suffix = Date.now()
  let organizerId: string
  let publishedMunId: string
  let publishedMunSlug: string
  let draftMunSlug: string
  let cheapMunId: string
  let expensiveMunId: string

  beforeAll(async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Test Organizer', email: `org-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    organizerId = organizer.id

    const [publishedMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Searchable Oxford MUN ${suffix}`,
        slug: `searchable-oxford-${suffix}`,
        city: 'Oxford',
        country: 'UK',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        startDate: new Date('2027-05-01'),
        endDate: new Date('2027-05-03'),
      })
      .returning()
    publishedMunId = publishedMun.id
    publishedMunSlug = publishedMun.slug

    const [draftMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Draft Hidden MUN ${suffix}`,
        slug: `draft-hidden-${suffix}`,
        city: 'Oxford',
        country: 'UK',
        status: 'DRAFT',
      })
      .returning()
    draftMunSlug = draftMun.slug

    const [cheapMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Cheap City MUN ${suffix}`,
        slug: `cheap-city-${suffix}`,
        city: 'Cheapville',
        country: 'UK',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        startDate: new Date('2027-06-01'),
      })
      .returning()
    cheapMunId = cheapMun.id

    const [expensiveMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Expensive City MUN ${suffix}`,
        slug: `expensive-city-${suffix}`,
        city: 'Expensiveville',
        country: 'UK',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        startDate: new Date('2027-07-01'),
      })
      .returning()
    expensiveMunId = expensiveMun.id

    await db.insert(registrationProducts).values([
      { munId: publishedMunId, name: 'Delegate', price: 2500, capacity: 200, status: 'active' },
      { munId: publishedMunId, name: 'Press', price: 1500, capacity: 20, status: 'active' },
      { munId: cheapMunId, name: 'Delegate', price: 500, capacity: 100, status: 'active' },
      { munId: expensiveMunId, name: 'Delegate', price: 9000, capacity: 100, status: 'active' },
      // inactive product on cheapMun with an even lower price — must be excluded from minPrice
      { munId: cheapMunId, name: 'Retired Tier', price: 100, capacity: 10, status: 'archived' },
    ])
  })

  afterAll(async () => {
    // clean up rows created by this test file
    await db.delete(registrationProducts).where(eq(registrationProducts.munId, publishedMunId))
    await db.delete(registrationProducts).where(eq(registrationProducts.munId, cheapMunId))
    await db.delete(registrationProducts).where(eq(registrationProducts.munId, expensiveMunId))
    await db.delete(muns).where(eq(muns.organizerId, organizerId))
    await db.delete(users).where(eq(users.id, organizerId))
  })

  describe('searchMuns', () => {
    it('text search excludes non-published muns', async () => {
      const { results } = await searchMuns({ query: `Oxford MUN ${suffix}` })
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((m) => m.status !== 'DRAFT')).toBe(true)
      expect(results.some((m) => m.slug === draftMunSlug)).toBe(false)
    })

    it('filters by city', async () => {
      const { results } = await searchMuns({ city: 'Cheapville' })
      expect(results.length).toBe(1)
      expect(results[0].city).toBe('Cheapville')
    })

    it('price range filter actually excludes out-of-range muns', async () => {
      const { results } = await searchMuns({ minPrice: 400, maxPrice: 600 })
      const slugs = results.map((m) => m.slug)
      expect(slugs).toContain(`cheap-city-${suffix}`)
      expect(slugs).not.toContain(`expensive-city-${suffix}`)
      expect(slugs).not.toContain(publishedMunSlug)
    })

    it('sortBy price actually orders results ascending by minPrice', async () => {
      const { results } = await searchMuns({
        country: 'UK',
        sortBy: 'price',
        limit: 50,
      })
      const withPrice = results.filter((m) => m.minPrice !== null)
      const prices = withPrice.map((m) => m.minPrice as number)
      const sorted = [...prices].sort((a, b) => a - b)
      expect(prices).toEqual(sorted)

      const cheapIdx = results.findIndex((m) => m.slug === `cheap-city-${suffix}`)
      const expensiveIdx = results.findIndex((m) => m.slug === `expensive-city-${suffix}`)
      expect(cheapIdx).toBeGreaterThanOrEqual(0)
      expect(expensiveIdx).toBeGreaterThan(cheapIdx)
    })

    it('never returns DRAFT/SUBMITTED/etc statuses when status param is omitted', async () => {
      const { results } = await searchMuns({ query: `${suffix}` })
      expect(
        results.every((m) =>
          ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(m.status),
        ),
      ).toBe(true)
    })

    it('returns a total count for pagination', async () => {
      const { results, total } = await searchMuns({ country: 'UK', limit: 1, offset: 0 })
      expect(results.length).toBe(1)
      expect(total).toBeGreaterThanOrEqual(3)
    })
  })

  describe('getMunBySlug', () => {
    it('returns full nested shape for a published mun', async () => {
      const detail = await getMunBySlug(publishedMunSlug)
      expect(detail).not.toBeNull()
      expect(detail?.id).toBe(publishedMunId)
      expect(detail?.organizerName).toBe('Test Organizer')
      expect(Array.isArray(detail?.committees)).toBe(true)
      expect(Array.isArray(detail?.registrationProducts)).toBe(true)
      expect(detail?.registrationProducts.every((p) => p.status === 'active')).toBe(true)
      // committees carry nested portfolios array (even if empty for this fixture)
      expect(detail?.committees.every((c) => Array.isArray(c.portfolios))).toBe(true)
    })

    it('returns null for a DRAFT mun even if you know its slug', async () => {
      const detail = await getMunBySlug(draftMunSlug)
      expect(detail).toBeNull()
    })

    it('returns null for a nonexistent slug', async () => {
      const detail = await getMunBySlug('does-not-exist-slug')
      expect(detail).toBeNull()
    })
  })

  describe('getMarketplaceFacets', () => {
    it('returns unique, non-null city and country values', async () => {
      const facets = await getMarketplaceFacets()
      expect(facets.cities).toContain('Cheapville')
      expect(facets.cities).toContain('Expensiveville')
      expect(new Set(facets.cities).size).toBe(facets.cities.length)
      expect(new Set(facets.countries).size).toBe(facets.countries.length)
      expect(facets.cities.every((c) => c !== null)).toBe(true)
      expect(facets.countries.every((c) => c !== null)).toBe(true)
    })
  })

  describe('listPublicMunSlugs', () => {
    it('includes published muns with their slug and updatedAt', async () => {
      const rows = await listPublicMunSlugs()
      const match = rows.find((r) => r.slug === publishedMunSlug)
      expect(match).toBeDefined()
      expect(match?.updatedAt).toBeInstanceOf(Date)
    })

    it('excludes DRAFT muns', async () => {
      const rows = await listPublicMunSlugs()
      expect(rows.some((r) => r.slug === draftMunSlug)).toBe(false)
    })

    it('only returns slug and updatedAt fields', async () => {
      const rows = await listPublicMunSlugs()
      const match = rows.find((r) => r.slug === publishedMunSlug)
      expect(match && Object.keys(match).sort()).toEqual(['slug', 'updatedAt'])
    })
  })
})
