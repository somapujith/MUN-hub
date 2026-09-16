import { describe, expect, it } from 'vitest'
import { makeCorsOriginMatcher } from './app'

describe('makeCorsOriginMatcher', () => {
  it('allows the explicit dev-origin allowlist', () => {
    const matcher = makeCorsOriginMatcher()
    expect(matcher('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('allows munhub.in and any of its subdomains', () => {
    const matcher = makeCorsOriginMatcher()
    expect(matcher('https://munhub.in')).toBe('https://munhub.in')
    expect(matcher('https://www.munhub.in')).toBe('https://www.munhub.in')
    expect(matcher('https://app.munhub.in')).toBe('https://app.munhub.in')
    expect(matcher('https://organize.munhub.in')).toBe('https://organize.munhub.in')
    expect(matcher('https://admin.munhub.in')).toBe('https://admin.munhub.in')
    expect(matcher('https://oxford-mun-2027.munhub.in')).toBe('https://oxford-mun-2027.munhub.in')
  })

  it('rejects unrelated origins, including near-miss domains', () => {
    const matcher = makeCorsOriginMatcher()
    expect(matcher('https://evil.com')).toBeUndefined()
    expect(matcher('https://munhub.in.evil.com')).toBeUndefined()
    expect(matcher('https://notmunhub.in')).toBeUndefined()
  })

  it('rejects http:// for munhub.in (only https is allowed in prod)', () => {
    const matcher = makeCorsOriginMatcher()
    expect(matcher('http://munhub.in')).toBeUndefined()
  })
})
