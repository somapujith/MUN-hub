import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import { largestUploadBytes, maxBase64Length, UPLOAD_RULES } from '@/lib/storage/validate'
import { UPLOAD_BODY_LIMIT_BYTES } from '../middleware/body-limit'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

afterEach(() => {
  vi.unstubAllEnvs()
})

const TRUSTED = 'https://app.munhub.in'
const SLUG_HOST = 'https://oxford-mun-2027.munhub.in'

describe('CORS', () => {
  it('gives trusted web hosts credentialed CORS', async () => {
    const res = await app.request('/api/v1/health', { headers: { Origin: TRUSTED } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TRUSTED)
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Vary')).toContain('Origin')
  })

  it('answers a trusted preflight for a write', async () => {
    const res = await app.request('/api/v1/auth/session', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://publish.munhub.in',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://publish.munhub.in')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('gives per-MUN slug hosts non-credentialed CORS on reads', async () => {
    const res = await app.request('/api/v1/health', { headers: { Origin: SLUG_HOST } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SLUG_HOST)
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()

    const preflight = await app.request('/api/v1/muns/facets', {
      method: 'OPTIONS',
      headers: { Origin: SLUG_HOST, 'Access-Control-Request-Method': 'GET' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(SLUG_HOST)
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET,HEAD')
  })

  it('gives per-MUN slug hosts no CORS for writes', async () => {
    const preflight = await app.request('/api/v1/auth/session', {
      method: 'OPTIONS',
      headers: { Origin: SLUG_HOST, 'Access-Control-Request-Method': 'POST' },
    })
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull()

    const write = await app.request('/api/v1/auth/session', {
      method: 'DELETE',
      headers: { Origin: SLUG_HOST },
    })
    expect(write.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(write.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('gives unknown origins no CORS headers at all', async () => {
    const res = await app.request('/api/v1/health', { headers: { Origin: 'https://evil.com' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(res.headers.get('Vary')).toContain('Origin')
  })

  it('trusts localhost only with ALLOW_LOCALHOST_ORIGINS=true', async () => {
    vi.stubEnv('ALLOW_LOCALHOST_ORIGINS', '')
    vi.stubEnv('CORS_ORIGINS', '')
    const denied = await app.request('/api/v1/health', { headers: { Origin: 'http://localhost:5173' } })
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull()

    vi.stubEnv('ALLOW_LOCALHOST_ORIGINS', 'true')
    const allowed = await app.request('/api/v1/health', { headers: { Origin: 'http://localhost:5173' } })
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })
})

describe('security headers', () => {
  function expectSecurityHeaders(res: Response) {
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
  }

  it('are set on JSON responses, 404s, errors and preflights', async () => {
    expectSecurityHeaders(await app.request('/api/v1/health'))
    expectSecurityHeaders(await app.request('/api/v1/does-not-exist'))
    expectSecurityHeaders(await app.request('/api/v1/muns/no-such-slug'))
    expectSecurityHeaders(
      await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: { Origin: TRUSTED, 'Access-Control-Request-Method': 'GET' },
      }),
    )
  })

  it('leave the sitemap and robots content types alone', async () => {
    const sitemap = await app.request('/api/v1/sitemap.xml')
    expect(sitemap.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expectSecurityHeaders(sitemap)

    const robots = await app.request('/api/v1/robots.txt')
    expect(robots.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expectSecurityHeaders(robots)
  })
})

describe('unknown routes', () => {
  it('answer a JSON 404 without internals', async () => {
    for (const path of ['/api/v1/does-not-exist', '/nope', '/api/v2/muns', '/webhooks/nope']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(404)
      expect(res.headers.get('Content-Type'), path).toContain('application/json')
      const body = await res.json()
      expect(body, path).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    }
  })

  it('answer a JSON 404 for an unknown method on a known path', async () => {
    const res = await app.request('/api/v1/health', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  })
})

describe('body limit', () => {
  it('rejects a JSON body over 1 MB with a JSON 413', async () => {
    const res = await app.request('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(1024 * 1024 + 1) }),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
    })
  })

  it('rejects an oversized body even without Content-Length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(256 * 1024))
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 5) return controller.close()
        sent += 1
        controller.enqueue(chunk)
      },
    })
    const res = await app.request('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
  })

  it('sizes the upload body limit to the largest file (a 10 MB PDF, base64-encoded) and no more', () => {
    const largestBase64 = 4 * Math.ceil((10 * 1024 * 1024) / 3)
    expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(largestBase64)
    expect(UPLOAD_BODY_LIMIT_BYTES).toBeLessThan(14 * 1024 * 1024)
  })

  it('lets document and media uploads through up to the upload limit', async () => {
    const munId = crypto.randomUUID()
    const maxDocument = JSON.stringify({ fileBase64: 'A'.repeat(4 * Math.ceil((10 * 1024 * 1024) / 3)) })

    for (const path of [`/api/v1/muns/${munId}/documents`, `/api/v1/muns/${munId}/media`]) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: maxDocument,
      })
      // Past the body limit: the anonymous request is stopped by requireAuth instead.
      expect(res.status, path).toBe(401)
    }

    // The old 30 MB allowance (sized for a 20 MB PDF) is gone.
    for (const size of [UPLOAD_BODY_LIMIT_BYTES + 1, 29 * 1024 * 1024]) {
      const tooBig = await app.request(`/api/v1/muns/${munId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: 'A'.repeat(size) }),
      })
      expect(tooBig.status, String(size)).toBe(413)
    }
  })

  it("refuses an upload to someone else's MUN before parsing the body", async () => {
    const owner = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: owner.id, name: 'Upload Guard Mun', slug: `upload-guard-${crypto.randomUUID()}`, status: 'ONBOARDING' })
      .returning()
    const headers = { ...(await authHeaders(student.id)), 'Content-Type': 'application/json' }

    for (const area of ['media', 'documents']) {
      // Not even valid JSON: a 400 here would mean the body was parsed first.
      const res = await app.request(`/api/v1/muns/${mun.id}/${area}`, { method: 'POST', headers, body: '{"fileBase64": "AAAA' })
      expect(res.status, area).toBe(403)
    }
  })

  it('refuses a base64 string longer than the largest file of its kind', async () => {
    const owner = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: owner.id, name: 'Upload Size Mun', slug: `upload-size-${crypto.randomUUID()}`, status: 'ONBOARDING' })
      .returning()
    const headers = { ...(await authHeaders(owner.id)), 'Content-Type': 'application/json' }

    const media = await app.request(`/api/v1/muns/${mun.id}/media`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'GALLERY',
        contentType: 'image/png',
        fileBase64: 'A'.repeat(4 * Math.ceil((5 * 1024 * 1024) / 3) + 4),
      }),
    })
    expect(media.status).toBe(400)
    expect(await media.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: { fileBase64: ['File too large — maximum allowed size is 5MB'] } },
    })
  })

  it('refuses uploads while the MUN application is still in review', async () => {
    const owner = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: owner.id, name: 'Unapproved Mun', slug: `unapproved-${crypto.randomUUID()}`, status: 'SUBMITTED' })
      .returning()
    const headers = { ...(await authHeaders(owner.id)), 'Content-Type': 'application/json' }

    const res = await app.request(`/api/v1/muns/${mun.id}/media`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'LOGO', contentType: 'image/png', fileBase64: 'iVBORw0KGgo=' }),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { code: 'CONFLICT_STATE', message: 'You can upload files once MUN Hub approves your application' },
    })
  })

  // Ownership (assertCanUploadToMun) now runs as Hono middleware BEFORE
  // zValidator parses the body (server/routes/mun-branding.ts,
  // mun-documents.ts) — a caller who may not upload here is rejected before
  // the JSON body, let alone an oversized fileBase64 inside it, is ever
  // parsed. This subsumes the older "schema cap stops the decode" property:
  // an authorized caller's own oversized payload is covered separately by
  // "refuses a base64 string longer than the largest file of its kind" above.
  it('rejects an oversized payload for an unowned MUN at the ownership check, before parsing it', async () => {
    const student = await makeUser('STUDENT')
    const cookie = await authHeaders(student.id)
    const munId = crypto.randomUUID()

    const overImageCap = await app.request(`/api/v1/muns/${munId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({
        kind: 'LOGO',
        contentType: 'image/png',
        fileBase64: 'A'.repeat(maxBase64Length(largestUploadBytes(['LOGO', 'COVER', 'IMAGE'])) + 4),
      }),
    })
    expect(overImageCap.status).toBe(404)
    expect((await overImageCap.json()).error.code).toBe('NOT_FOUND')

    const overDocumentCap = await app.request(`/api/v1/muns/${munId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({
        kind: 'RULES',
        title: 'Rules',
        contentType: 'application/pdf',
        fileBase64: 'A'.repeat(maxBase64Length(UPLOAD_RULES.DOCUMENT.maxBytes) + 4),
      }),
    })
    expect(overDocumentCap.status).toBe(404)
    expect((await overDocumentCap.json()).error.code).toBe('NOT_FOUND')
  })

  it('keeps the 1 MB limit on other routes under /muns/:munId', async () => {
    const res = await app.request(`/api/v1/muns/${crypto.randomUUID()}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(2 * 1024 * 1024) }),
    })
    expect(res.status).toBe(413)
  })

  // Regression: UPLOAD_ROUTE_PATTERN only matched /muns/:munId/(documents|media)
  // until this route was added to it — an executive-board photo well within
  // UPLOAD_RULES.IMAGE's 5MB cap always 413'd under the 1MB default limit.
  it('gives executive-board photo uploads the upload limit, not the 1 MB default', async () => {
    const memberId = crypto.randomUUID()
    const withinDefaultButOverBase64Header = JSON.stringify({
      contentType: 'image/png',
      fileBase64: 'A'.repeat(2 * 1024 * 1024), // over the 1MB JSON default, well under the upload limit
    })

    const res = await app.request(`/api/v1/executive-board/${memberId}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: withinDefaultButOverBase64Header,
    })
    // Past the body limit: the anonymous request is stopped by requireAuth
    // instead, same as the documents/media case above — proves the body was
    // never rejected as oversized.
    expect(res.status).toBe(401)

    const tooBig = await app.request(`/api/v1/executive-board/${memberId}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png', fileBase64: 'A'.repeat(UPLOAD_BODY_LIMIT_BYTES + 1) }),
    })
    expect(tooBig.status).toBe(413)
  })
})

describe('sitemap and robots', () => {
  async function makePublishedMun(status: 'PUBLISHED' | 'ONBOARDING') {
    const organizer = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Sitemap Mun', slug: `sitemap-${crypto.randomUUID()}`, status })
      .returning()
    return mun
  }

  it('lists the public pages and public MUNs under APP_URL', async () => {
    vi.stubEnv('APP_URL', 'https://www.munhub.in/')
    const published = await makePublishedMun('PUBLISHED')
    const onboarding = await makePublishedMun('ONBOARDING')

    const res = await app.request('/api/v1/sitemap.xml')
    expect(res.status).toBe(200)
    const xml = await res.text()

    for (const path of [
      '/',
      '/muns',
      '/about',
      '/about/curation',
      '/contact',
      '/legal',
      '/legal/terms',
      '/legal/privacy',
      '/legal/refunds',
    ]) {
      expect(xml, path).toContain(`<loc>https://www.munhub.in${path}</loc>`)
    }
    expect(xml).toContain(`<loc>https://www.munhub.in/mun/${published.slug}</loc>`)
    expect(xml).not.toContain(onboarding.slug)
    expect(xml).not.toContain('localhost')
  })

  it('falls back to https://www.munhub.in when APP_URL is unset', async () => {
    vi.stubEnv('APP_URL', '')
    const xml = await (await app.request('/api/v1/sitemap.xml')).text()
    expect(xml).toContain('<loc>https://www.munhub.in/</loc>')
  })

  it('robots.txt points at the absolute sitemap URL', async () => {
    const res = await app.request('https://api.munhub.in/api/v1/robots.txt')
    const text = await res.text()
    expect(text).toContain('Sitemap: https://api.munhub.in/api/v1/sitemap.xml')
    for (const path of ['/admin', '/organizer', '/dashboard', '/register', '/profile']) {
      expect(text).toContain(`Disallow: ${path}\n`)
    }
  })

  it('the API host root robots.txt only allows the sitemap', async () => {
    const res = await app.request('https://api.munhub.in/robots.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    const text = await res.text()
    expect(text).toContain('Allow: /api/v1/sitemap.xml\nDisallow: /\n')
    expect(text).toContain('Sitemap: https://api.munhub.in/api/v1/sitemap.xml')
  })
})
