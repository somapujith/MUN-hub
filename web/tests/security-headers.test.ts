// Runs under the repo-root Vitest config (`npx vitest run web/tests`). Kept
// outside web/src so the web app's own tsc/vite builds, which have no test
// runner installed, never pick it up.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_API_ORIGIN, resolveApiOrigin, withApiOrigin } from '../build/security-headers.ts'

const STAGING_API_ORIGIN = 'https://munhub-api-staging.somapujith.workers.dev'

const headersFile = path.resolve(import.meta.dirname, '../public/_headers')
const committedHeaders = fs.readFileSync(headersFile, 'utf8')

function csp(headersText: string): string {
  const match = headersText.match(/^\s*Content-Security-Policy:\s*(.*)$/m)
  if (!match) throw new Error('no Content-Security-Policy header')
  return match[1]
}

function connectSrc(headersText: string): string {
  const match = csp(headersText).match(/connect-src[^;]*/)
  if (!match) throw new Error('no connect-src directive')
  return match[0]
}

describe('resolveApiOrigin', () => {
  it('takes the origin of a full API base URL', () => {
    expect(resolveApiOrigin(`${STAGING_API_ORIGIN}/api/v1`)).toBe(STAGING_API_ORIGIN)
  })

  it('returns null when unset or not a URL, so the committed CSP is left alone', () => {
    expect(resolveApiOrigin(undefined)).toBeNull()
    expect(resolveApiOrigin('')).toBeNull()
    expect(resolveApiOrigin('/api/v1')).toBeNull()
  })
})

describe('withApiOrigin', () => {
  it('points connect-src at the API the bundle was built against', () => {
    const rewritten = withApiOrigin(committedHeaders, STAGING_API_ORIGIN)

    expect(connectSrc(rewritten)).toContain(STAGING_API_ORIGIN)
    // A bundle only ever talks to the API it was built against.
    expect(connectSrc(rewritten)).not.toContain(PRODUCTION_API_ORIGIN)
  })

  it('keeps the rest of connect-src, so Turnstile and self still work', () => {
    const directive = connectSrc(withApiOrigin(committedHeaders, STAGING_API_ORIGIN))
    expect(directive).toContain("'self'")
    expect(directive).toContain('https://challenges.cloudflare.com')
  })

  it('never rewrites the file\'s `#` comments, only its CSP lines', () => {
    const rewritten = withApiOrigin(committedHeaders, STAGING_API_ORIGIN)
    const comments = (text: string) => text.split('\n').filter((line) => line.startsWith('#')).join('\n')
    expect(comments(rewritten)).toBe(comments(committedHeaders))
  })

  it('leaves the file alone for a production build', () => {
    expect(withApiOrigin(committedHeaders, PRODUCTION_API_ORIGIN)).toBe(committedHeaders)
    expect(withApiOrigin(committedHeaders, null)).toBe(committedHeaders)
  })

  it('appends the origin when connect-src does not name the production API', () => {
    const headers = "  Content-Security-Policy: default-src 'self'; connect-src 'self'; object-src 'none'\n"
    expect(withApiOrigin(headers, STAGING_API_ORIGIN)).toContain(`connect-src 'self' ${STAGING_API_ORIGIN};`)
  })

  it('rewrites the actual dist file byte-for-byte apart from the origin', () => {
    const rewritten = withApiOrigin(committedHeaders, STAGING_API_ORIGIN)
    expect(rewritten.split(STAGING_API_ORIGIN).join(PRODUCTION_API_ORIGIN)).toBe(committedHeaders)
  })
})

describe('committed web/public/_headers', () => {
  it('allows the production API, which is what a plain build ships', () => {
    expect(connectSrc(committedHeaders)).toContain(PRODUCTION_API_ORIGIN)
  })

  it('matches the CSP web/vercel.json serves for the same bundle', () => {
    const vercel = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../vercel.json'), 'utf8')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>
    }
    const vercelCsp = vercel.headers
      .flatMap((entry) => entry.headers)
      .find((header) => header.key === 'Content-Security-Policy')

    const fileCsp = committedHeaders.match(/^\s*Content-Security-Policy:\s*(.*)$/m)?.[1]
    expect(vercelCsp?.value).toBe(fileCsp)
  })
})
