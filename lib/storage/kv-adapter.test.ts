import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runWithStorageBindings } from './bindings'
import { createInMemoryKv, readBody, SAMPLE_FILES } from './in-memory-bindings'
import { createKvStorageAdapter, KV_MAX_VALUE_BYTES } from './kv-adapter'

const KEY = 'muns/mun-1/branding/6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('createKvStorageAdapter', () => {
  it('stores the bytes with contentType, size, sha256 and uploadedAt as KV metadata', async () => {
    const kv = createInMemoryKv()
    const adapter = createKvStorageAdapter(kv)

    const result = await adapter.upload(SAMPLE_FILES.png, KEY, 'image/png')

    expect(result.url).toBe(`/api/v1/files/${KEY}`)
    const entry = kv.entries.get(KEY)
    expect(Buffer.from(entry!.value).equals(SAMPLE_FILES.png)).toBe(true)
    expect(entry!.metadata).toMatchObject({
      contentType: 'image/png',
      size: SAMPLE_FILES.png.byteLength,
      sha256: sha256(SAMPLE_FILES.png),
    })
    expect(Date.parse((entry!.metadata as { uploadedAt: string }).uploadedAt)).not.toBeNaN()
    // KV caps metadata at 1024 bytes once serialized.
    expect(JSON.stringify(entry!.metadata).length).toBeLessThan(1024)
  })

  it('returns an absolute URL built from the request origin inside a request', async () => {
    const adapter = createKvStorageAdapter(createInMemoryKv())
    const result = await runWithStorageBindings({ requestOrigin: 'http://localhost:3001' }, () =>
      adapter.upload(SAMPLE_FILES.png, KEY, 'image/png'),
    )
    expect(result.url).toBe(`http://localhost:3001/api/v1/files/${KEY}`)
  })

  it('stores only the file bytes when the Buffer is a view into a larger pool', async () => {
    const kv = createInMemoryKv()
    const pooled = Buffer.from('xxxx%PDF-1.7 pooled').subarray(4)
    expect(pooled.byteOffset).toBeGreaterThan(0)

    await createKvStorageAdapter(kv).upload(pooled, KEY, 'application/pdf')

    expect(Buffer.from(kv.entries.get(KEY)!.value).toString()).toBe('%PDF-1.7 pooled')
  })

  it('reads the object back as a stream with its metadata', async () => {
    const adapter = createKvStorageAdapter(createInMemoryKv())
    await adapter.upload(SAMPLE_FILES.pdf, KEY, 'application/pdf')

    const object = await adapter.get(KEY)

    expect(object).toMatchObject({
      contentType: 'application/pdf',
      size: SAMPLE_FILES.pdf.byteLength,
      sha256: sha256(SAMPLE_FILES.pdf),
    })
    expect(object!.body).toBeInstanceOf(ReadableStream)
    expect((await readBody(object!.body)).equals(SAMPLE_FILES.pdf)).toBe(true)
  })

  it('returns null for a missing key', async () => {
    expect(await createKvStorageAdapter(createInMemoryKv()).get(KEY)).toBeNull()
  })

  it('serves a value stored without metadata as opaque bytes with its real size', async () => {
    const kv = createInMemoryKv()
    await kv.put(KEY, 'hand-written value')

    const object = await createKvStorageAdapter(kv).get(KEY)

    expect(object).toMatchObject({ contentType: 'application/octet-stream', size: 18 })
    expect((await readBody(object!.body)).toString()).toBe('hand-written value')
  })

  it('deletes the object, and deleting a missing key is not an error', async () => {
    const kv = createInMemoryKv()
    const adapter = createKvStorageAdapter(kv)
    await adapter.upload(SAMPLE_FILES.png, KEY, 'image/png')

    await adapter.delete(KEY)
    expect(kv.entries.has(KEY)).toBe(false)
    await expect(adapter.delete(KEY)).resolves.toBeUndefined()
  })

  it('rejects unsafe keys on every operation', async () => {
    const kv = createInMemoryKv()
    const adapter = createKvStorageAdapter(kv)
    await expect(adapter.upload(SAMPLE_FILES.png, '../escape', 'image/png')).rejects.toThrow('Invalid storage key')
    await expect(adapter.get('muns/../x')).rejects.toThrow('Invalid storage key')
    await expect(adapter.delete('')).rejects.toThrow('Invalid storage key')
    expect(kv.entries.size).toBe(0)
  })

  it('refuses values over the 25 MiB KV limit', async () => {
    const kv = createInMemoryKv()
    await expect(
      createKvStorageAdapter(kv).upload(Buffer.alloc(KV_MAX_VALUE_BYTES + 1), KEY, 'application/pdf'),
    ).rejects.toThrow(/^File too large/)
    expect(kv.entries.size).toBe(0)
  })
})
