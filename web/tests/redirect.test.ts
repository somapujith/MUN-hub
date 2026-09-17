// Runs under the repo-root Vitest config (`npx vitest run web/tests`). Kept
// outside web/src so the web app's own tsc/vite builds, which have no test
// runner installed, never pick it up.
import { describe, expect, it } from 'vitest'
import { safeRedirectTo } from '../src/lib/redirect'

describe('safeRedirectTo', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/muns?city=Hyderabad#top', '/muns?city=Hyderabad#top'],
    ['/register/oxford-mun-2027', '/register/oxford-mun-2027'],
    ['/profile/../dashboard', '/dashboard'],
    ['/%5Cevil.com', '/%5Cevil.com'],
    ['/', '/'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(safeRedirectTo(input)).toBe(expected)
  })

  it.each([
    // Not a path at all.
    null,
    undefined,
    '',
    'dashboard',
    'https://evil.com',
    'javascript:alert(1)',
    // Protocol-relative before normalization.
    '//evil.com',
    '//evil.com/dashboard',
    '/\\evil.com',
    '/\\/evil.com',
    // Protocol-relative only after normalization (dot segments, %2e, tabs).
    '/.//evil.com',
    '/%2e//evil.com',
    '/%2E//evil.com',
    '/././/evil.com',
    '/a/..//evil.com',
    '/.\\/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
  ])('rejects %j', (input) => {
    expect(safeRedirectTo(input)).toBe('/')
  })

  it('never returns anything protocol-relative for a batch of odd inputs', () => {
    const prefixes = ['/', '/.', '/..', '/%2e', '/%2E', '/./', '/\\', '/\t', '/a/..']
    const middles = ['/', '//', '\\', '\\\\', '/\\', '%2F', '%5C']
    for (const prefix of prefixes) {
      for (const middle of middles) {
        const result = safeRedirectTo(`${prefix}${middle}evil.com`)
        expect(result.startsWith('/')).toBe(true)
        expect(result.startsWith('//')).toBe(false)
        expect(result.startsWith('/\\')).toBe(false)
        expect(new URL(result, 'https://munhub.in').origin).toBe('https://munhub.in')
      }
    }
  })
})
