import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import {
  base64LengthForBytes,
  MAX_IMAGE_UPLOAD_BYTES,
  UPLOAD_RULES,
} from '@/lib/storage/validate'
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

  it('lets document and media uploads through, up to the base64 size of the largest allowed file', async () => {
    const munId = crypto.randomUUID()
    const twoMb = JSON.stringify({ fileBase64: 'A'.repeat(2 * 1024 * 1024) })

    for (const path of [`/api/v1/muns/${munId}/documents`, `/api/v1/muns/${munId}/media`]) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: twoMb,
      })
      // Past the body limit: the anonymous request is stopped by requireAuth instead.
      expect(res.status, path).toBe(401)
    }

    // The upload limit tracks the 10 MB document cap (~13.3 MB of base64),
    // not the retired 20 MB one — a 30 MB body never reaches a handler now.
    expect(UPLOAD_BODY_LIMIT_BYTES).toBeLessThan(15 * 1024 * 1024)
    expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(base64LengthForBytes(UPLOAD_RULES.DOCUMENT.maxBytes))

    const tooBig = await app.request(`/api/v1/muns/${munId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64: 'A'.repeat(UPLOAD_BODY_LIMIT_BYTES + 1) }),
    })
    expect(tooBig.status).toBe(413)
  })

  // The schema cap is what stops a 13 MB base64 string being decoded into a
  // Buffer for a MUN the caller doesn't own; the byte cap in
  // lib/storage/validate.ts only applies after that Buffer exists.
  it('rejects an over-cap fileBase64 on the schema, before any decode', async () => {
    const student = await makeUser('STUDENT')
    const cookie = await authHeaders(student.id)
    const munId = crypto.randomUUID()

    const overImageCap = await app.request(`/api/v1/muns/${munId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({
        kind: 'LOGO',
        contentType: 'image/png',
        fileBase64: 'A'.repeat(base64LengthForBytes(MAX_IMAGE_UPLOAD_BYTES) + 4),
      }),
    })
    expect(overImageCap.status).toBe(400)
    expect((await overImageCap.json()).error.code).toBe('VALIDATION_FAILED')

    const overDocumentCap = await app.request(`/api/v1/muns/${munId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({
        kind: 'RULES',
        title: 'Rules',
        contentType: 'application/pdf',
        fileBase64: 'A'.repeat(base64LengthForBytes(UPLOAD_RULES.DOCUMENT.maxBytes) + 4),
      }),
    })
    expect(overDocumentCap.status).toBe(400)
    expect((await overDocumentCap.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('keeps the 1 MB limit on other routes under /muns/:munId', async () => {
    const res = await app.request(`/api/v1/muns/${crypto.randomUUID()}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(2 * 1024 * 1024) }),
    })
    expect(res.status).toBe(413)
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
