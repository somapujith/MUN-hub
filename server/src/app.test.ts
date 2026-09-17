import { afterEach, describe, expect, it, vi } from 'vitest'
import { passesCsrfCheck, requestOrigin } from '../middleware/csrf'
import { isPublicReadOrigin, isTrustedOrigin, TRUSTED_WEB_ORIGINS } from '../lib/origins'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isTrustedOrigin', () => {
  it('trusts exactly the production web hosts', () => {
    expect(TRUSTED_WEB_ORIGINS).toEqual([
      'https://munhub.in',
      'https://www.munhub.in',
      'https://app.munhub.in',
      'https://publish.munhub.in',
      'https://organize.munhub.in',
      'https://admin.munhub.in',
    ])
    for (const origin of TRUSTED_WEB_ORIGINS) {
      expect(isTrustedOrigin(origin), origin).toBe(true)
    }
  })

  it('does not trust per-MUN slug hosts', () => {
    expect(isTrustedOrigin('https://oxford-mun-2027.munhub.in')).toBe(false)
    expect(isTrustedOrigin('https://api.munhub.in')).toBe(false)
  })

  it('rejects unrelated origins, near-miss domains, http and ports', () => {
    for (const origin of [
      'https://evil.com',
      'https://munhub.in.evil.com',
      'https://notmunhub.in',
      'http://munhub.in',
      'https://app.munhub.in:8443',
      'null',
      '',
    ]) {
      expect(isTrustedOrigin(origin), origin).toBe(false)
    }
  })

  it('trusts localhost only when ALLOW_LOCALHOST_ORIGINS is "true"', () => {
    vi.stubEnv('ALLOW_LOCALHOST_ORIGINS', '')
    vi.stubEnv('CORS_ORIGINS', '')
    expect(isTrustedOrigin('http://localhost:5173')).toBe(false)
    expect(isTrustedOrigin('http://127.0.0.1:5174')).toBe(false)

    vi.stubEnv('ALLOW_LOCALHOST_ORIGINS', 'true')
    expect(isTrustedOrigin('http://localhost:5173')).toBe(true)
    expect(isTrustedOrigin('http://localhost')).toBe(true)
    expect(isTrustedOrigin('http://127.0.0.1:5174')).toBe(true)
    expect(isTrustedOrigin('http://localhost.evil.com')).toBe(false)
    expect(isTrustedOrigin('http://localhost:5173.evil.com')).toBe(false)
    expect(isTrustedOrigin('https://evil.com')).toBe(false)
  })

  it('trusts extra exact origins from CORS_ORIGINS', () => {
    vi.stubEnv('ALLOW_LOCALHOST_ORIGINS', '')
    vi.stubEnv('CORS_ORIGINS', 'https://preview.example.com, http://localhost:5175')
    expect(isTrustedOrigin('https://preview.example.com')).toBe(true)
    expect(isTrustedOrigin('http://localhost:5175')).toBe(true)
    expect(isTrustedOrigin('http://localhost:5176')).toBe(false)
    expect(isTrustedOrigin('https://other.example.com')).toBe(false)
  })
})

describe('isPublicReadOrigin', () => {
  it('matches single-label munhub.in subdomains that are not trusted hosts', () => {
    expect(isPublicReadOrigin('https://oxford-mun-2027.munhub.in')).toBe(true)
    expect(isPublicReadOrigin('https://app.munhub.in')).toBe(false)
    expect(isPublicReadOrigin('https://munhub.in')).toBe(false)
  })

  it('rejects multi-label, http, ported and foreign hosts', () => {
    for (const origin of [
      'https://a.b.munhub.in',
      'http://oxford.munhub.in',
      'https://oxford.munhub.in:444',
      'https://oxford.munhub.in.evil.com',
      'https://evil.com',
    ]) {
      expect(isPublicReadOrigin(origin), origin).toBe(false)
    }
  })
})

describe('requestOrigin', () => {
  it('prefers the Origin header', () => {
    expect(requestOrigin('https://app.munhub.in', 'https://evil.com/x')).toBe('https://app.munhub.in')
  })

  it('falls back to the origin of the Referer URL', () => {
    expect(requestOrigin(undefined, 'https://app.munhub.in/dashboard/a?b=c')).toBe('https://app.munhub.in')
    expect(requestOrigin(undefined, 'https://evil.com/https://app.munhub.in')).toBe('https://evil.com')
    expect(requestOrigin(undefined, 'https://app.munhub.in.evil.com/')).toBe('https://app.munhub.in.evil.com')
  })

  it('returns null without a usable header', () => {
    expect(requestOrigin(undefined, undefined)).toBeNull()
    expect(requestOrigin(undefined, 'not a url')).toBeNull()
  })
})

describe('passesCsrfCheck', () => {
  it('lets every read through', () => {
    expect(passesCsrfCheck('GET', undefined, undefined)).toBe(true)
    expect(passesCsrfCheck('HEAD', 'https://evil.com', undefined)).toBe(true)
    expect(passesCsrfCheck('OPTIONS', 'https://evil.com', undefined)).toBe(true)
  })

  it('requires a trusted origin for mutating methods', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(passesCsrfCheck(method, 'https://app.munhub.in', undefined), method).toBe(true)
      expect(passesCsrfCheck(method, undefined, undefined), method).toBe(false)
      expect(passesCsrfCheck(method, 'https://evil.com', undefined), method).toBe(false)
      expect(passesCsrfCheck(method, 'null', 'https://app.munhub.in/'), method).toBe(false)
    }
  })

  it('rejects writes from per-MUN slug hosts', () => {
    expect(passesCsrfCheck('POST', 'https://oxford.munhub.in', undefined)).toBe(false)
    expect(passesCsrfCheck('POST', undefined, 'https://oxford.munhub.in/')).toBe(false)
  })

  it('accepts a trusted Referer and rejects look-alikes when Origin is absent', () => {
    expect(passesCsrfCheck('POST', undefined, 'https://admin.munhub.in/admin/review')).toBe(true)
    expect(passesCsrfCheck('POST', undefined, 'https://admin.munhub.in.evil.com/admin')).toBe(false)
    expect(passesCsrfCheck('POST', undefined, 'https://evil.com/https://admin.munhub.in')).toBe(false)
  })
})
