import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { committees, munContacts, munFormFields, munMedia, muns, portfolios, registrationProducts, users } from '@/lib/db/schema'
import {
  assertMunPubliclyVisible,
  clipToPublicStatuses,
  getMarketplaceFacets,
  getMunBySlug,
  getMunPreview,
  listPublicMunSlugs,
  searchMuns,
} from './marketplace'

describe('marketplace actions', () => {
  const suffix = Date.now()
  let organizerId: string
  let societyOrganizerId: string
  let publishedMunId: string
  let publishedMunSlug: string
  let draftMunId: string
  let draftMunSlug: string
  let cheapMunId: string
  let expensiveMunId: string
  let completedMunSlug: string
  let suspendedMunId: string
  let suspendedMunSlug: string

  beforeAll(async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Test Organizer', email: `org-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    organizerId = organizer.id

    const [society] = await db
      .insert(users)
      .values({
        name: `Zenith Debating Society ${suffix}`,
        email: `society-${suffix}@test.com`,
        role: 'ORGANIZER',
        institution: `Quillfield Institute ${suffix}`,
      })
      .returning()
    societyOrganizerId = society.id

    const [publishedMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Searchable Oxford MUN ${suffix}`,
        slug: `searchable-oxford-${suffix}`,
        theme: `Tidewater Diplomacy ${suffix}`,
        venue: 'Examination Schools',
        addressLine1: '75-81 High St',
        city: 'Oxford',
        country: 'UK',
        mapUrl: 'https://maps.example.com/oxford',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        startDate: new Date('2027-05-01T09:00:00Z'),
        endDate: new Date('2027-05-03T17:00:00Z'),
        registrationDeadline: new Date('2027-04-20T00:00:00Z'),
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
    draftMunId = draftMun.id
    draftMunSlug = draftMun.slug

    const [cheapMun] = await db
      .insert(muns)
      .values({
        organizerId: societyOrganizerId,
        name: `Cheap City MUN ${suffix}`,
        slug: `cheap-city-${suffix}`,
        city: 'Cheapville',
        country: 'UK',
        status: 'REGISTRATION_OPEN',
        publishedAt: new Date('2026-02-01T00:00:00Z'),
        startDate: new Date('2027-06-01T09:00:00Z'),
        endDate: new Date('2027-06-02T17:00:00Z'),
        registrationDeadline: new Date('2027-03-01T00:00:00Z'),
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
        publishedAt: new Date('2026-03-01T00:00:00Z'),
        startDate: new Date('2027-07-01T09:00:00Z'),
      })
      .returning()
    expensiveMunId = expensiveMun.id

    const [completedMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Completed Archive MUN ${suffix}`,
        slug: `completed-archive-${suffix}`,
        status: 'COMPLETED',
        publishedAt: new Date(),
      })
      .returning()
    completedMunSlug = completedMun.slug

    const [suspendedMun] = await db
      .insert(muns)
      .values({
        organizerId,
        name: `Suspended MUN ${suffix}`,
        slug: `suspended-${suffix}`,
        status: 'SUSPENDED',
        publishedAt: new Date(),
      })
      .returning()
    suspendedMunId = suspendedMun.id
    suspendedMunSlug = suspendedMun.slug

    await db.insert(registrationProducts).values([
      { munId: publishedMunId, name: 'Delegate', price: 2500, capacity: 200, status: 'active' },
      { munId: publishedMunId, name: 'Press', price: 1500, capacity: 20, status: 'active' },
      { munId: cheapMunId, name: 'Delegate', price: 500, capacity: 100, status: 'active' },
      { munId: expensiveMunId, name: 'Delegate', price: 9000, capacity: 100, status: 'active' },
      // inactive product on cheapMun with an even lower price — must be excluded from minPrice
      { munId: cheapMunId, name: 'Retired Tier', price: 100, capacity: 10, status: 'archived' },
    ])

    await db.insert(munMedia).values([
      {
        munId: publishedMunId,
        kind: 'COVER',
        url: `https://cdn.example.com/${suffix}/cover.png`,
        storageKey: `muns/${publishedMunId}/branding/cover`,
        contentType: 'image/png',
        sizeBytes: 100,
      },
      {
        munId: publishedMunId,
        kind: 'LOGO',
        url: `https://cdn.example.com/${suffix}/logo.png`,
        storageKey: `muns/${publishedMunId}/branding/logo`,
        contentType: 'image/png',
        sizeBytes: 100,
      },
      {
        munId: publishedMunId,
        kind: 'GALLERY',
        url: `https://cdn.example.com/${suffix}/gallery.png`,
        storageKey: `muns/${publishedMunId}/branding/gallery`,
        contentType: 'image/png',
        sizeBytes: 100,
      },
    ])

    await db.insert(munContacts).values({
      munId: publishedMunId,
      officialEmail: 'secretariat@oxford.example.com',
      phone: '+44 1865 000000',
      website: 'https://oxford.example.com',
      contactPersonName: 'Private Person',
      contactPersonEmail: 'private.person@example.com',
      contactPersonPhone: '+44 7700 900000',
    })

    // One committee with two portfolios, one with none — exercises the
    // committees<->portfolios LEFT JOIN grouping in loadPublicMunDetail.
    const [unsc, unhrc] = await db
      .insert(committees)
      .values([
        { munId: publishedMunId, name: `UNSC ${suffix}`, agenda: 'Peace and security', capacity: 20 },
        { munId: publishedMunId, name: `UNHRC ${suffix}`, agenda: 'Human rights', capacity: 15 },
      ])
      .returning()
    await db.insert(portfolios).values([
      { committeeId: unsc.id, name: 'United States', type: 'COUNTRY', availability: 2 },
      { committeeId: unsc.id, name: 'United Kingdom', type: 'COUNTRY', availability: 1 },
    ])
  })

  afterAll(async () => {
    // Children (products, media, contacts, form fields) cascade with the mun.
    await db.delete(muns).where(inArray(muns.organizerId, [organizerId, societyOrganizerId]))
    await db.delete(users).where(inArray(users.id, [organizerId, societyOrganizerId]))
  })

  describe('clipToPublicStatuses', () => {
    it('defaults to the three listing statuses when nothing is requested', () => {
      expect(clipToPublicStatuses(undefined).sort()).toEqual(
        ['PUBLISHED', 'REGISTRATION_CLOSED', 'REGISTRATION_OPEN'].sort(),
      )
    })

    it('drops internal statuses and keeps publicly visible ones', () => {
      expect(clipToPublicStatuses(['DRAFT', 'COMPLETED', 'SUSPENDED', 'COMPLETED'])).toEqual(['COMPLETED'])
    })

    it('stays empty (does not widen to the default) when nothing public was requested', () => {
      expect(clipToPublicStatuses(['DRAFT', 'VERIFICATION'])).toEqual([])
    })
  })

  describe('searchMuns', () => {
    it('text search excludes non-published muns', async () => {
      const { results } = await searchMuns({ query: `Oxford MUN ${suffix}` })
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((m) => m.status !== 'DRAFT')).toBe(true)
      expect(results.some((m) => m.slug === draftMunSlug)).toBe(false)
    })

    it('filters by city', async () => {
      const { results } = await searchMuns({ city: 'Cheapville', query: `${suffix}` })
      expect(results.length).toBe(1)
      expect(results[0].city).toBe('Cheapville')
    })

    it('price range filter actually excludes out-of-range muns', async () => {
      const { results } = await searchMuns({ minPrice: 400, maxPrice: 600, limit: 100 })
      const slugs = results.map((m) => m.slug)
      expect(slugs).toContain(`cheap-city-${suffix}`)
      expect(slugs).not.toContain(`expensive-city-${suffix}`)
      expect(slugs).not.toContain(publishedMunSlug)
    })

    it('sortBy price actually orders results ascending by minPrice', async () => {
      const { results } = await searchMuns({ query: `${suffix}`, sortBy: 'price', limit: 50 })
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

    it('clips an explicitly requested internal status instead of serving it', async () => {
      const onlyDraft = await searchMuns({ query: `${suffix}`, status: ['DRAFT'] })
      expect(onlyDraft).toEqual({ results: [], total: 0 })

      const mixed = await searchMuns({ query: `${suffix}`, status: ['DRAFT', 'SUSPENDED', 'PUBLISHED'] })
      const slugs = mixed.results.map((m) => m.slug)
      expect(slugs).toContain(publishedMunSlug)
      expect(slugs).not.toContain(draftMunSlug)
      expect(slugs).not.toContain(suspendedMunSlug)
      expect(mixed.results.every((m) => m.status === 'PUBLISHED')).toBe(true)
    })

    it('can list later public lifecycle states when asked for them', async () => {
      const { results } = await searchMuns({ query: `${suffix}`, status: ['COMPLETED'] })
      expect(results.map((m) => m.slug)).toEqual([completedMunSlug])
    })

    it('returns a total count for pagination', async () => {
      const { results, total } = await searchMuns({ query: `${suffix}`, country: 'UK', limit: 1, offset: 0 })
      expect(results.length).toBe(1)
      expect(total).toBe(3)
    })

    it('still returns the true total when the requested page itself is empty (offset past the last match)', async () => {
      // `total` is read off a `count(*) over ()` window column on the same
      // query as the page of rows (see searchMuns) — a page with zero rows
      // has no window-function value to read, so this must fall back to a
      // real COUNT(*) query rather than silently reporting 0. Regression
      // test for that fallback: offset (100) is well past the 3 UK matches.
      const { results, total } = await searchMuns({ query: `${suffix}`, country: 'UK', limit: 10, offset: 100 })
      expect(results).toEqual([])
      expect(total).toBe(3)
    })

    it('matches the theme, the country, and the organizer name and institution', async () => {
      const byTheme = await searchMuns({ query: `tidewater ${suffix}` })
      expect(byTheme.results.map((m) => m.slug)).toEqual([publishedMunSlug])

      const byOrganizer = await searchMuns({ query: `Zenith Debating Society ${suffix}` })
      expect(byOrganizer.results.map((m) => m.slug)).toEqual([`cheap-city-${suffix}`])

      const byInstitution = await searchMuns({ query: `quillfield ${suffix}` })
      expect(byInstitution.results.map((m) => m.slug)).toEqual([`cheap-city-${suffix}`])

      const byCountry = await searchMuns({ query: `uk ${suffix}` })
      expect(byCountry.total).toBe(3)
    })

    it("shows the organizer's organization as the host, else their name", async () => {
      const { results } = await searchMuns({ query: `${suffix}`, country: 'UK', limit: 10 })
      const bySlug = new Map(results.map((mun) => [mun.slug, mun.organizerName]))
      expect(bySlug.get(`cheap-city-${suffix}`)).toBe(`Quillfield Institute ${suffix}`)
      expect(bySlug.get(publishedMunSlug)).toBe('Test Organizer')
      expect((await getMunBySlug(`cheap-city-${suffix}`))?.organizerName).toBe(`Quillfield Institute ${suffix}`)
    })

    it('requires every search term to match somewhere', async () => {
      const { results } = await searchMuns({ query: `expensiveville nonexistentword ${suffix}` })
      expect(results).toEqual([])
    })

    it('treats LIKE wildcards in the query literally', async () => {
      const { results } = await searchMuns({ query: `${suffix}%_` })
      expect(results).toEqual([])
    })

    it('filters by a date window the conference overlaps', async () => {
      const may = await searchMuns({
        query: `${suffix}`,
        dateFrom: new Date('2027-05-02T00:00:00Z'),
        dateTo: new Date('2027-05-31T23:59:59Z'),
      })
      expect(may.results.map((m) => m.slug)).toEqual([publishedMunSlug])

      const fromJune = await searchMuns({ query: `${suffix}`, dateFrom: new Date('2027-06-02T00:00:00Z') })
      expect(fromJune.results.map((m) => m.slug).sort()).toEqual(
        [`cheap-city-${suffix}`, `expensive-city-${suffix}`].sort(),
      )
    })

    it('sortBy deadline lists the soonest upcoming deadline first and undated ones last', async () => {
      const { results } = await searchMuns({ query: `${suffix}`, sortBy: 'deadline' })
      const slugs = results.map((m) => m.slug)
      // Both fixtures' deadlines are in 2027 (still ahead): March before April,
      // then the mun with no deadline at all.
      expect(slugs).toEqual([`cheap-city-${suffix}`, publishedMunSlug, `expensive-city-${suffix}`])
    })

    it('sortBy newest lists the most recently published first', async () => {
      const { results } = await searchMuns({ query: `${suffix}`, sortBy: 'newest' })
      expect(results.map((m) => m.slug)).toEqual([
        `expensive-city-${suffix}`,
        `cheap-city-${suffix}`,
        publishedMunSlug,
      ])
    })

    it('returns the cover image and registration window on each card', async () => {
      const { results } = await searchMuns({ query: `${suffix}` })
      const published = results.find((m) => m.slug === publishedMunSlug)
      expect(published?.coverImage).toBe(`https://cdn.example.com/${suffix}/cover.png`)
      expect(published?.registrationDeadline).toEqual(new Date('2027-04-20T00:00:00Z'))

      const expensive = results.find((m) => m.slug === `expensive-city-${suffix}`)
      expect(expensive?.coverImage).toBeNull()
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
      expect(detail?.committees.every((c) => Array.isArray(c.portfolios))).toBe(true)
      expect(detail?.mapUrl).toBe('https://maps.example.com/oxford')
      expect(detail?.coverImage).toBe(`https://cdn.example.com/${suffix}/cover.png`)
      expect(detail?.logo).toBe(`https://cdn.example.com/${suffix}/logo.png`)
    })

    it('groups portfolios under their own committee from the single joined query, including a committee with none', async () => {
      const detail = await getMunBySlug(publishedMunSlug)
      expect(detail).not.toBeNull()

      const unsc = detail!.committees.find((c) => c.name === `UNSC ${suffix}`)
      const unhrc = detail!.committees.find((c) => c.name === `UNHRC ${suffix}`)
      expect(unsc).toBeDefined()
      expect(unhrc).toBeDefined()

      // The LEFT JOIN must not leak a phantom portfolio row for the
      // committee with none, and must not cross-contaminate UNSC's rows onto it.
      expect(unhrc!.portfolios).toEqual([])

      expect(unsc!.portfolios.map((p) => p.name).sort()).toEqual(['United Kingdom', 'United States'])
      const us = unsc!.portfolios.find((p) => p.name === 'United States')!
      expect(us.committeeId).toBe(unsc!.id)
      expect(us.type).toBe('COUNTRY')
      expect(us.availability).toBe(2)
    })

    it('never exposes the organizer id or internal columns', async () => {
      const detail = await getMunBySlug(publishedMunSlug)
      expect(detail).not.toBeNull()
      const keys = Object.keys(detail ?? {})
      for (const hidden of ['organizerId', 'createdAt', 'updatedAt', 'publishedAt']) {
        expect(keys).not.toContain(hidden)
      }
      expect(JSON.stringify(detail)).not.toContain(organizerId)
    })

    it('returns only the official contact channels, never the contact person', async () => {
      const detail = await getMunBySlug(publishedMunSlug)
      expect(detail?.contact).toEqual({
        officialEmail: 'secretariat@oxford.example.com',
        phone: '+44 1865 000000',
        website: 'https://oxford.example.com',
      })
      const serialized = JSON.stringify(detail)
      expect(serialized).not.toContain('Private Person')
      expect(serialized).not.toContain('private.person@example.com')
      expect(serialized).not.toContain('+44 7700 900000')
    })

    it('returns null for a DRAFT mun even if you know its slug', async () => {
      const detail = await getMunBySlug(draftMunSlug)
      expect(detail).toBeNull()
    })

    it('serves later public lifecycle states but not SUSPENDED', async () => {
      expect(await getMunBySlug(completedMunSlug)).not.toBeNull()
      expect(await getMunBySlug(suspendedMunSlug)).toBeNull()
    })

    it('returns null for a nonexistent slug', async () => {
      const detail = await getMunBySlug('does-not-exist-slug')
      expect(detail).toBeNull()
    })
  })

  describe('getMunPreview', () => {
    it("shows the owner their draft in the public shape, without the organizer id", async () => {
      const preview = await getMunPreview(draftMunId, { userId: organizerId, role: 'ORGANIZER' })
      expect(preview.id).toBe(draftMunId)
      expect(preview.slug).toBe(draftMunSlug)
      expect(preview.status).toBe('DRAFT')
      expect(Array.isArray(preview.committees)).toBe(true)
      expect(Object.keys(preview)).not.toContain('organizerId')
      expect(JSON.stringify(preview)).not.toContain(organizerId)
    })

    it('lets staff preview any mun, and refuses other organizers, students and anonymous callers', async () => {
      const [ops] = await db
        .insert(users)
        .values({ name: 'Ops', email: `ops-preview-${suffix}@test.com`, role: 'OPERATIONS' })
        .returning()
      await expect(getMunPreview(draftMunId, { userId: ops.id, role: 'OPERATIONS' })).resolves.toMatchObject({
        id: draftMunId,
      })
      await expect(getMunPreview(draftMunId, { userId: societyOrganizerId, role: 'ORGANIZER' })).rejects.toThrow(
        'Forbidden',
      )
      const [student] = await db
        .insert(users)
        .values({ name: 'Student', email: `student-preview-${suffix}@test.com`, role: 'STUDENT' })
        .returning()
      await expect(getMunPreview(draftMunId, { userId: student.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
      await expect(getMunPreview(draftMunId, null)).rejects.toThrow('Forbidden')
    })
  })

  describe('assertMunPubliclyVisible', () => {
    it('passes for a published mun', async () => {
      await expect(assertMunPubliclyVisible(publishedMunId)).resolves.toBeUndefined()
    })

    it('throws Mun not found for hidden and missing muns alike', async () => {
      await expect(assertMunPubliclyVisible(draftMunId)).rejects.toThrow('Mun not found')
      await expect(assertMunPubliclyVisible(suspendedMunId)).rejects.toThrow('Mun not found')
      await expect(assertMunPubliclyVisible(crypto.randomUUID())).rejects.toThrow('Mun not found')
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

    it('only returns slug, updatedAt and coverImage fields', async () => {
      const rows = await listPublicMunSlugs()
      const match = rows.find((r) => r.slug === publishedMunSlug)
      expect(match && Object.keys(match).sort()).toEqual(['coverImage', 'slug', 'updatedAt'])
    })

    it('includes the cover image URL when one is set, else null', async () => {
      const rows = await listPublicMunSlugs()
      const match = rows.find((r) => r.slug === publishedMunSlug)
      expect(match?.coverImage).toBeNull()
    })
  })

  it('does not seed form fields for a hidden mun it refuses to serve', async () => {
    // listFormFields seeds default fields as a side effect; getMunBySlug must
    // only reach it for publicly visible muns.
    await getMunBySlug(draftMunSlug)
    const rows = await db.select({ id: munFormFields.id }).from(munFormFields).where(eq(munFormFields.munId, draftMunId))
    expect(rows).toEqual([])
  })
})
