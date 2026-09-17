import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createInMemoryR2, readBody, SAMPLE_FILES } from './in-memory-bindings'
import { createR2StorageAdapter } from './r2-adapter'

const KEY = 'muns/mun-1/documents/6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('createR2StorageAdapter', () => {
  it('puts the bytes with the content type, custom metadata and a sha256 integrity check', async () => {
    const bucket = createInMemoryR2()
    const adapter = createR2StorageAdapter(bucket)

    const result = await adapter.upload(SAMPLE_FILES.pdf, KEY, 'application/pdf')

    expect(result.url).toBe(`/api/v1/files/${KEY}`)
    const stored = bucket.objects.get(KEY)!
    expect(Buffer.from(stored.value).equals(SAMPLE_FILES.pdf)).toBe(true)
    expect(stored.httpMetadata).toEqual({ contentType: 'application/pdf' })
    expect(stored.customMetadata).toMatchObject({
      sha256: createHash('sha256').update(SAMPLE_FILES.pdf).digest('hex'),
    })
    expect(Date.parse(stored.customMetadata!.uploadedAt)).not.toBeNaN()
  })

  it('reads the object back with its metadata', async () => {
    const adapter = createR2StorageAdapter(createInMemoryR2())
    await adapter.upload(SAMPLE_FILES.webp, KEY, 'image/webp')

    const object = await adapter.get(KEY)

    expect(object).toMatchObject({
      contentType: 'image/webp',
      size: SAMPLE_FILES.webp.byteLength,
      sha256: createHash('sha256').update(SAMPLE_FILES.webp).digest('hex'),
    })
    expect((await readBody(object!.body)).equals(SAMPLE_FILES.webp)).toBe(true)
  })

  it('falls back to octet-stream and the object upload time when metadata is missing', async () => {
    const bucket = createInMemoryR2()
    await bucket.put(KEY, 'raw')

    const object = await createR2StorageAdapter(bucket).get(KEY)

    expect(object).toMatchObject({ contentType: 'application/octet-stream', size: 3, sha256: undefined })
    expect(Date.parse(object!.uploadedAt!)).not.toBeNaN()
  })

  it('returns null for a missing key and deletes idempotently', async () => {
    const bucket = createInMemoryR2()
    const adapter = createR2StorageAdapter(bucket)
    expect(await adapter.get(KEY)).toBeNull()

    await adapter.upload(SAMPLE_FILES.png, KEY, 'image/png')
    await adapter.delete(KEY)
    expect(bucket.objects.has(KEY)).toBe(false)
    await expect(adapter.delete(KEY)).resolves.toBeUndefined()
  })

  it('rejects unsafe keys on every operation', async () => {
    const bucket = createInMemoryR2()
    const adapter = createR2StorageAdapter(bucket)
    await expect(adapter.upload(SAMPLE_FILES.png, 'a/../b', 'image/png')).rejects.toThrow('Invalid storage key')
    await expect(adapter.get('/abs/path')).rejects.toThrow('Invalid storage key')
    await expect(adapter.delete('x')).rejects.toThrow('Invalid storage key')
    expect(bucket.objects.size).toBe(0)
  })
})
