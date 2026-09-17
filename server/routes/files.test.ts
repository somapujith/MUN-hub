import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryKv, createInMemoryR2, SAMPLE_FILES, type InMemoryKv } from '@/lib/storage/in-memory-bindings'
import { createKvStorageAdapter } from '@/lib/storage/kv-adapter'
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter'
import { createApp } from '../src/app'

const app = createApp()
const IMAGE_KEY = 'muns/mun-1/branding/6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const PDF_KEY = 'muns/mun-1/documents/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

describe('GET /api/v1/files/:key', () => {
  let kv: InMemoryKv

  beforeEach(async () => {
    kv = createInMemoryKv()
    const storage = createKvStorageAdapter(kv)
    await storage.upload(SAMPLE_FILES.png, IMAGE_KEY, 'image/png')
    await storage.upload(SAMPLE_FILES.pdf, PDF_KEY, 'application/pdf')
  })

  function get(path: string, headers: Record<string, string> = {}, env: Record<string, unknown> = { UPLOADS_KV: kv }) {
    return app.request(path, { headers }, env)
  }

  it('serves an image with its stored type and locked-down headers', async () => {
    const res = await get(`/api/v1/files/${IMAGE_KEY}`)

    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(SAMPLE_FILES.png)).toBe(true)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Content-Length')).toBe(String(SAMPLE_FILES.png.byteLength))
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('Content-Disposition')).toBe(
      'inline; filename="6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.png"',
    )
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin')
    expect(res.headers.get('ETag')).toBe(`"${createHash('sha256').update(SAMPLE_FILES.png).digest('hex')}"`)
  })

  it('serves a PDF inline, with a CSP that still lets the browser PDF viewer load', async () => {
    const res = await get(`/api/v1/files/${PDF_KEY}`)

    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(SAMPLE_FILES.pdf)).toBe(true)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe(
      'inline; filename="0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.pdf"',
    )
    const csp = res.headers.get('Content-Security-Policy')!
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('sandbox')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('serves anything with an unexpected stored type as a sandboxed download', async () => {
    const key = 'muns/mun-1/branding/html-smuggled'
    await kv.put(key, SAMPLE_FILES.html, { metadata: { contentType: 'text/html', size: SAMPLE_FILES.html.byteLength } })

    const res = await get(`/api/v1/files/${key}`)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="html-smuggled"')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
  })

  it('returns 404 with no-store for a missing key', async () => {
    const res = await get('/api/v1/files/muns/mun-1/branding/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'File not found' } })
  })

  it('returns 404 for unsafe or malformed keys', async () => {
    for (const path of [
      '/api/v1/files/single-segment',
      '/api/v1/files/muns/..%2F..%2Fetc%2Fpasswd',
      '/api/v1/files/muns/%2E%2E/secret',
      '/api/v1/files/muns/x%00y',
      '/api/v1/files/muns//x',
    ]) {
      const res = await get(path)
      expect(res.status, path).toBe(404)
    }
  })

  it('returns 404 when no storage binding is configured (mock adapter keeps nothing)', async () => {
    const res = await app.request(`/api/v1/files/${IMAGE_KEY}`)
    expect(res.status).toBe(404)
  })

  it('answers a matching If-None-Match with 304', async () => {
    const first = await get(`/api/v1/files/${IMAGE_KEY}`)
    const etag = first.headers.get('ETag')!

    const res = await get(`/api/v1/files/${IMAGE_KEY}`, { 'If-None-Match': `"other", W/${etag}` })

    expect(res.status).toBe(304)
    expect(res.headers.get('ETag')).toBe(etag)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })

  it('reads from R2 when both R2 and KV bindings are present', async () => {
    const r2 = createInMemoryR2()
    await createR2StorageAdapter(r2).upload(SAMPLE_FILES.webp, IMAGE_KEY, 'image/webp')

    const res = await get(`/api/v1/files/${IMAGE_KEY}`, {}, { UPLOADS_KV: kv, UPLOADS_BUCKET: r2 })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(Buffer.from(await res.arrayBuffer()).equals(SAMPLE_FILES.webp)).toBe(true)
  })

  it('is not handled for mutating methods', async () => {
    const res = await app.request(`/api/v1/files/${IMAGE_KEY}`, { method: 'DELETE' }, { UPLOADS_KV: kv })
    expect(res.status).toBe(404)
    expect(kv.entries.has(IMAGE_KEY)).toBe(true)
  })
})
