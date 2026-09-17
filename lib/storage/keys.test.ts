import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runWithStorageBindings } from './bindings'
import { isSafeStorageKey, publicFileUrl } from './keys'

const UUID = '6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('isSafeStorageKey', () => {
  it('accepts the keys upload actions generate, and seeded keys', () => {
    expect(isSafeStorageKey(`muns/${UUID}/branding/${UUID}`)).toBe(true)
    expect(isSafeStorageKey(`muns/${UUID}/documents/${UUID}`)).toBe(true)
    expect(isSafeStorageKey(`seed/${UUID}/logo.png`)).toBe(true)
  })

  it('rejects traversal, empty segments, absolute paths and odd characters', () => {
    for (const key of [
      '',
      'single-segment',
      '../etc/passwd',
      'muns/../../etc/passwd',
      'muns/./x',
      'muns/.hidden',
      'muns//x',
      '/muns/x',
      'muns/x/',
      'muns\\x\\y',
      'muns/x%2F..',
      'muns/x y',
      'muns/ünïcode',
      'muns/x\0y',
    ]) {
      expect(isSafeStorageKey(key), JSON.stringify(key)).toBe(false)
    }
  })

  it('rejects keys longer than the 512-byte KV limit', () => {
    expect(isSafeStorageKey(`a/${'b'.repeat(250)}/${'c'.repeat(250)}`)).toBe(true)
    expect(isSafeStorageKey(`a/${'b'.repeat(255)}/${'c'.repeat(255)}`)).toBe(false)
  })
})

describe('publicFileUrl', () => {
  const key = `muns/${UUID}/branding/${UUID}`
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.PUBLIC_API_URL
    delete process.env.PUBLIC_API_URL
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLIC_API_URL
    else process.env.PUBLIC_API_URL = saved
  })

  it('uses PUBLIC_API_URL when set, keeping only its origin', () => {
    process.env.PUBLIC_API_URL = 'https://api.munhub.in'
    expect(publicFileUrl(key)).toBe(`https://api.munhub.in/api/v1/files/${key}`)

    process.env.PUBLIC_API_URL = 'https://api.munhub.in/api/v1/'
    expect(publicFileUrl(key)).toBe(`https://api.munhub.in/api/v1/files/${key}`)
  })

  it('prefers PUBLIC_API_URL over the request origin', () => {
    process.env.PUBLIC_API_URL = 'https://api.munhub.in'
    const url = runWithStorageBindings({ requestOrigin: 'http://evil.example' }, () => publicFileUrl(key))
    expect(url).toBe(`https://api.munhub.in/api/v1/files/${key}`)
  })

  it('falls back to the request origin (local dev)', () => {
    const url = runWithStorageBindings({ requestOrigin: 'http://localhost:3001' }, () => publicFileUrl(key))
    expect(url).toBe(`http://localhost:3001/api/v1/files/${key}`)
  })

  it('returns a root-relative path outside a request', () => {
    expect(publicFileUrl(key)).toBe(`/api/v1/files/${key}`)
  })

  it('ignores a PUBLIC_API_URL that is not an http(s) URL', () => {
    process.env.PUBLIC_API_URL = 'javascript:alert(1)'
    expect(publicFileUrl(key)).toBe(`/api/v1/files/${key}`)
    process.env.PUBLIC_API_URL = 'not a url'
    expect(publicFileUrl(key)).toBe(`/api/v1/files/${key}`)
  })
})
