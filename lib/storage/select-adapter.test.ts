import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_NOT_CONFIGURED, StorageNotConfiguredError, type StorageAdapter } from './adapter'
import { runWithStorageBindings } from './bindings'
import { createInMemoryKv, createInMemoryR2, SAMPLE_FILES } from './in-memory-bindings'
import { mockStorageAdapter } from './mock-adapter'
import { deleteStoredObjectQuietly, selectStorageAdapter } from './select-adapter'

const KEY = 'muns/mun-1/branding/6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('selectStorageAdapter', () => {
  let savedAdapter: string | undefined
  let savedDir: string | undefined
  let root: string

  beforeEach(async () => {
    savedAdapter = process.env.STORAGE_ADAPTER
    savedDir = process.env.LOCAL_UPLOADS_DIR
    root = await mkdtemp(path.join(tmpdir(), 'munhub-select-'))
    process.env.LOCAL_UPLOADS_DIR = root
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (savedAdapter === undefined) delete process.env.STORAGE_ADAPTER
    else process.env.STORAGE_ADAPTER = savedAdapter
    if (savedDir === undefined) delete process.env.LOCAL_UPLOADS_DIR
    else process.env.LOCAL_UPLOADS_DIR = savedDir
    await rm(root, { recursive: true, force: true })
  })

  it('uses the mock only when STORAGE_ADAPTER is exactly mock', () => {
    process.env.STORAGE_ADAPTER = 'mock'
    expect(selectStorageAdapter()).toBe(mockStorageAdapter)
  })

  it('uses the filesystem when STORAGE_ADAPTER=local', async () => {
    process.env.STORAGE_ADAPTER = 'local'
    const adapter = selectStorageAdapter()
    expect(adapter).not.toBe(mockStorageAdapter)

    await adapter.upload(SAMPLE_FILES.png, KEY, 'image/png')
    expect(await adapter.get(KEY)).toMatchObject({ contentType: 'image/png' })
  })

  it('prefers a KV binding over STORAGE_ADAPTER', async () => {
    process.env.STORAGE_ADAPTER = 'local'
    const kv = createInMemoryKv()
    await runWithStorageBindings({ kv }, () => selectStorageAdapter().upload(SAMPLE_FILES.png, KEY, 'image/png'))
    expect(kv.entries.has(KEY)).toBe(true)
  })

  it('prefers R2 over KV when both bindings are present', async () => {
    const kv = createInMemoryKv()
    const r2 = createInMemoryR2()
    await runWithStorageBindings({ kv, r2 }, () => selectStorageAdapter().upload(SAMPLE_FILES.png, KEY, 'image/png'))
    expect(r2.objects.has(KEY)).toBe(true)
    expect(kv.entries.size).toBe(0)
  })

  it('with both bindings, still reads and deletes files that were uploaded to KV before R2', async () => {
    const kv = createInMemoryKv()
    const r2 = createInMemoryR2()
    const oldKey = 'muns/mun-1/documents/uploaded-before-r2'
    await runWithStorageBindings({ kv }, () => selectStorageAdapter().upload(SAMPLE_FILES.pdf, oldKey, 'application/pdf'))

    await runWithStorageBindings({ kv, r2 }, async () => {
      const storage = selectStorageAdapter()
      expect(await storage.get(oldKey)).toMatchObject({ contentType: 'application/pdf' })
      expect(await storage.get('muns/mun-1/documents/missing')).toBeNull()

      await storage.delete(oldKey)
      expect(await storage.get(oldKey)).toBeNull()
    })
    expect(kv.entries.size).toBe(0)
  })

  it('does not leak bindings between concurrent requests', async () => {
    const kvA = createInMemoryKv()
    const kvB = createInMemoryKv()
    const upload = (kv: typeof kvA, key: string) =>
      runWithStorageBindings({ kv }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await selectStorageAdapter().upload(SAMPLE_FILES.png, key, 'image/png')
      })
    await Promise.all([upload(kvA, 'muns/a/branding/1'), upload(kvB, 'muns/b/branding/2')])
    expect([...kvA.entries.keys()]).toEqual(['muns/a/branding/1'])
    expect([...kvB.entries.keys()]).toEqual(['muns/b/branding/2'])
    expect(selectStorageAdapter()).toBe(mockStorageAdapter)
  })

  // Fails closed: an unconfigured environment used to hand back the mock,
  // which answered 201 and dropped the bytes.
  it('throws instead of discarding the file when nothing is configured', () => {
    delete process.env.STORAGE_ADAPTER
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => selectStorageAdapter()).toThrow(StorageNotConfiguredError)
    expect(() => selectStorageAdapter()).toThrow(STORAGE_NOT_CONFIGURED)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No UPLOADS_BUCKET or UPLOADS_KV binding'))
  })

  it('throws in production too, rather than logging and carrying on', () => {
    delete process.env.STORAGE_ADAPTER
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => selectStorageAdapter()).toThrow(STORAGE_NOT_CONFIGURED)
  })

  it('throws on an unknown STORAGE_ADAPTER value rather than guessing', () => {
    process.env.STORAGE_ADAPTER = 'r2'
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => selectStorageAdapter()).toThrow(STORAGE_NOT_CONFIGURED)
  })

  it('still uses a binding in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const kv = createInMemoryKv()
    await runWithStorageBindings({ kv }, () => selectStorageAdapter().upload(SAMPLE_FILES.png, KEY, 'image/png'))
    expect(kv.entries.has(KEY)).toBe(true)
  })

  it('does not log when a backend is configured', () => {
    process.env.STORAGE_ADAPTER = 'mock'
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    selectStorageAdapter()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('deleteStoredObjectQuietly', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs a failed delete instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing: StorageAdapter = {
      ...mockStorageAdapter,
      delete: async () => {
        throw new Error('storage down')
      },
    }

    await expect(deleteStoredObjectQuietly(failing, KEY, 'test')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`could not delete object "${KEY}"`), expect.any(Error))
  })
})
