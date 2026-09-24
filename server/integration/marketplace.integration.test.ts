import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munContacts, munFaqs, muns, users } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

describe('public marketplace routes', () => {
  const tag = `mkt${crypto.randomUUID().slice(0, 8)}`
  const organizerIds: string[] = []
  let ownerId: string
  let publishedMun: { id: string; slug: string }
  let draftMun: { id: string; slug: string }

  beforeAll(async () => {
    const owner = await makeUser('ORGANIZER')
    ownerId = owner.id
    organizerIds.push(owner.id)

    const inserted = await db
      .insert(muns)
      .values([
        {
          organizerId: owner.id,
          name: `Route Published ${tag}`,
          slug: `route-published-${tag}`,
          status: 'REGISTRATION_OPEN',
          city: 'Hyderabad',
          country: 'India',
          startDate: new Date('2027-01-10T04:00:00Z'),
          endDate: new Date('2027-01-11T12:00:00Z'),
          registrationDeadline: new Date('2027-01-01T00:00:00Z'),
        },
        {
          organizerId: owner.id,
          name: `Route Draft ${tag}`,
          slug: `route-draft-${tag}`,
          status: 'DRAFT',
          city: 'Hyderabad',
          country: 'India',
        },
      ])
      .returning({ id: muns.id, slug: muns.slug })
    ;[publishedMun, draftMun] = inserted

    await db.insert(munContacts).values({
      munId: publishedMun.id,
      officialEmail: 'desk@route.example.com',
      contactPersonName: 'Hidden Person',
      contactPersonEmail: 'hidden.person@route.example.com',
      contactPersonPhone: '9000000000',
    })

    await db.insert(munFaqs).values([
      { munId: publishedMun.id, question: 'Public question?', answer: 'Public answer.', displayOrder: 0 },
      { munId: draftMun.id, question: 'Draft question?', answer: 'Draft answer.', displayOrder: 0 },
    ])
  })

  afterAll(async () => {
    await db.delete(muns).where(inArray(muns.organizerId, organizerIds))
    await db.delete(users).where(inArray(users.id, organizerIds))
  })

  describe('GET /api/v1/muns', () => {
    it('never lists a draft, even when ?status=DRAFT is requested', async () => {
      const res = await app.request(`/api/v1/muns?query=${tag}&status=DRAFT`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ results: [], total: 0 })
    })

    it('clips a mixed status list to its public part', async () => {
      const res = await app.request(`/api/v1/muns?query=${tag}&status=DRAFT,REGISTRATION_OPEN,SUSPENDED`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { results: { slug: string }[]; total: number }
      expect(body.results.map((m) => m.slug)).toEqual([publishedMun.slug])
      expect(body.total).toBe(1)
    })

    it('accepts date-window and deadline-sort params', async () => {
      const inside = await app.request(
        `/api/v1/muns?query=${tag}&dateFrom=2027-01-01T00:00:00.000Z&dateTo=2027-01-31T23:59:59.999Z&sortBy=deadline`,
      )
      expect(inside.status).toBe(200)
      const insideBody = (await inside.json()) as { results: { slug: string; registrationDeadline: string }[] }
      expect(insideBody.results.map((m) => m.slug)).toEqual([publishedMun.slug])
      expect(insideBody.results[0].registrationDeadline).toBe('2027-01-01T00:00:00.000Z')

      const outside = await app.request(`/api/v1/muns?query=${tag}&dateFrom=2027-02-01T00:00:00.000Z`)
      expect(((await outside.json()) as { total: number }).total).toBe(0)
    })

    it('ignores empty filter params instead of matching empty strings', async () => {
      const res = await app.request(`/api/v1/muns?query=${tag}&city=&country=&status=`)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { total: number }).total).toBe(1)
    })

    it('rejects an unknown sort and a malformed date with 400', async () => {
      expect((await app.request('/api/v1/muns?sortBy=popularity')).status).toBe(400)
      expect((await app.request('/api/v1/muns?dateFrom=not-a-date')).status).toBe(400)
    })

    it('is publicly cacheable — same response for every caller, so it carries a shared Cache-Control', async () => {
      const res = await app.request(`/api/v1/muns?query=${tag}`)
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300, stale-while-revalidate=600')
    })
  })

  describe('GET /api/v1/muns/facets', () => {
    it('is publicly cacheable with a longer TTL than the listing', async () => {
      const res = await app.request('/api/v1/muns/facets')
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=300, s-maxage=3600, stale-while-revalidate=7200',
      )
    })
  })

  describe('GET /api/v1/muns/:slug', () => {
    it('serves the public shape with no organizer id or contact person', async () => {
      const res = await app.request(`/api/v1/muns/${publishedMun.slug}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.slug).toBe(publishedMun.slug)
      expect(body).not.toHaveProperty('organizerId')
      expect(body.contact).toEqual({ officialEmail: 'desk@route.example.com', phone: null, website: null })

      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain(ownerId)
      expect(serialized).not.toContain('hidden.person@route.example.com')
      expect(serialized).not.toContain('Hidden Person')
    })

    it('answers 404 for a draft slug', async () => {
      const res = await app.request(`/api/v1/muns/${draftMun.slug}`)
      expect(res.status).toBe(404)
    })

    it('is publicly cacheable, with a longer TTL than the listing since detail content changes less often', async () => {
      const res = await app.request(`/api/v1/muns/${publishedMun.slug}`)
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=120, s-maxage=600, stale-while-revalidate=1800',
      )
    })
  })

  describe('GET /api/v1/muns/:slug/products', () => {
    it('is publicly cacheable when no includeInactive param is present', async () => {
      const res = await app.request(`/api/v1/muns/${publishedMun.slug}/products`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300, stale-while-revalidate=600')
    })

    it('never caches the ?includeInactive=true URL — it can serve two different bodies for the same URL', async () => {
      const anonymous = await app.request(`/api/v1/muns/${publishedMun.slug}/products?includeInactive=true`)
      expect(anonymous.status).toBe(200)
      expect(anonymous.headers.get('Cache-Control')).toBe('no-store')

      const headers = await authHeaders(ownerId)
      const asOwner = await app.request(`/api/v1/muns/${publishedMun.slug}/products?includeInactive=true`, {
        headers,
      })
      expect(asOwner.status).toBe(200)
      expect(asOwner.headers.get('Cache-Control')).toBe('no-store')
    })
  })

  describe('FAQ routes', () => {
    it('serves a published mun’s FAQs publicly, cacheably', async () => {
      const res = await app.request(`/api/v1/muns/${publishedMun.id}/faqs`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600',
      )
      const faqs = (await res.json()) as { question: string }[]
      expect(faqs.map((f) => f.question)).toEqual(['Public question?'])
    })

    it('answers 404 for a draft mun’s FAQs, even to its owner on the public path', async () => {
      expect((await app.request(`/api/v1/muns/${draftMun.id}/faqs`)).status).toBe(404)
      const headers = await authHeaders(ownerId)
      expect((await app.request(`/api/v1/muns/${draftMun.id}/faqs`, { headers })).status).toBe(404)
    })

    it('lets the owner manage FAQs through the authenticated endpoints', async () => {
      const headers = { ...(await authHeaders(ownerId)), 'Content-Type': 'application/json' }

      const manage = await app.request(`/api/v1/muns/${draftMun.id}/faqs/manage`, { headers })
      expect(manage.status).toBe(200)
      expect(((await manage.json()) as unknown[]).length).toBe(1)

      const created = await app.request(`/api/v1/muns/${publishedMun.id}/faqs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: 'Is there a delegate kit?', answer: 'Yes.' }),
      })
      expect(created.status).toBe(201)
      const faq = (await created.json()) as { id: string; displayOrder: number }
      expect(faq.displayOrder).toBe(1)

      const patched = await app.request(`/api/v1/faqs/${faq.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ answer: 'Yes, at registration.' }),
      })
      expect(patched.status).toBe(200)
      expect(((await patched.json()) as { answer: string }).answer).toBe('Yes, at registration.')

      const deleted = await app.request(`/api/v1/faqs/${faq.id}`, { method: 'DELETE', headers })
      expect(deleted.status).toBe(204)

      const missing = await app.request(`/api/v1/faqs/${faq.id}`, { method: 'DELETE', headers })
      expect(missing.status).toBe(404)
    })

    it('validates FAQ bodies', async () => {
      const headers = { ...(await authHeaders(ownerId)), 'Content-Type': 'application/json' }
      const res = await app.request(`/api/v1/muns/${publishedMun.id}/faqs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: '   ', answer: 'x' }),
      })
      expect(res.status).toBe(400)

      const tooLong = await app.request(`/api/v1/muns/${publishedMun.id}/faqs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: 'q'.repeat(301), answer: 'x' }),
      })
      expect(tooLong.status).toBe(400)
    })

    it('requires auth to write and ownership to manage', async () => {
      const anonymous = await app.request(`/api/v1/muns/${publishedMun.id}/faqs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Q?', answer: 'A.' }),
      })
      expect(anonymous.status).toBe(401)

      const stranger = await makeUser('ORGANIZER')
      organizerIds.push(stranger.id)
      const strangerHeaders = { ...(await authHeaders(stranger.id)), 'Content-Type': 'application/json' }

      const forbiddenWrite = await app.request(`/api/v1/muns/${publishedMun.id}/faqs`, {
        method: 'POST',
        headers: strangerHeaders,
        body: JSON.stringify({ question: 'Q?', answer: 'A.' }),
      })
      expect(forbiddenWrite.status).toBe(403)

      const forbiddenRead = await app.request(`/api/v1/muns/${draftMun.id}/faqs/manage`, { headers: strangerHeaders })
      expect(forbiddenRead.status).toBe(403)
    })
  })
})
