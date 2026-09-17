import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBody, SAMPLE_FILES } from './in-memory-bindings'
import { createLocalStorageAdapter, resolveLocalUploadsRoot } from './local-adapter'

const KEY = 'muns/mun-1/branding/6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  )
}

describe('createLocalStorageAdapter', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'munhub-uploads-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes the bytes under objects/ and the metadata under meta/', async () => {
    const adapter = createLocalStorageAdapter(root)

    const result = await adapter.upload(SAMPLE_FILES.jpeg, KEY, 'image/jpeg')

    expect(result.url).toBe(`/api/v1/files/${KEY}`)
    const bytes = await readFile(path.join(root, 'objects', ...KEY.split('/')))
    expect(bytes.equals(SAMPLE_FILES.jpeg)).toBe(true)
    const metadata = JSON.parse(await readFile(path.join(root, 'meta', ...KEY.split('/')) + '.json', 'utf8'))
    expect(metadata).toMatchObject({ contentType: 'image/jpeg', size: SAMPLE_FILES.jpeg.byteLength })
    expect(metadata.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads the object back with its metadata', async () => {
    const adapter = createLocalStorageAdapter(root)
    await adapter.upload(SAMPLE_FILES.pdf, KEY, 'application/pdf')

    const object = await adapter.get(KEY)

    expect(object).toMatchObject({ contentType: 'application/pdf', size: SAMPLE_FILES.pdf.byteLength })
    expect((await readBody(object!.body)).equals(SAMPLE_FILES.pdf)).toBe(true)
  })

  it('returns null for a missing key', async () => {
    expect(await createLocalStorageAdapter(root).get(KEY)).toBeNull()
  })

  it('deletes both files, and deleting a missing key is not an error', async () => {
    const adapter = createLocalStorageAdapter(root)
    await adapter.upload(SAMPLE_FILES.png, KEY, 'image/png')

    await adapter.delete(KEY)

    expect(await exists(path.join(root, 'objects', ...KEY.split('/')))).toBe(false)
    expect(await exists(path.join(root, 'meta', ...KEY.split('/')) + '.json')).toBe(false)
    expect(await adapter.get(KEY)).toBeNull()
    await expect(adapter.delete(KEY)).resolves.toBeUndefined()
  })

  it('never writes outside its root', async () => {
    const adapter = createLocalStorageAdapter(path.join(root, 'inner'))
    await expect(adapter.upload(SAMPLE_FILES.png, '../outside/file', 'image/png')).rejects.toThrow(
      'Invalid storage key',
    )
    await expect(adapter.upload(SAMPLE_FILES.png, 'muns/..\\..\\x', 'image/png')).rejects.toThrow(
      'Invalid storage key',
    )
    await expect(adapter.get('muns/../../etc')).rejects.toThrow('Invalid storage key')
    expect(await exists(path.join(root, 'outside'))).toBe(false)
  })
})

describe('resolveLocalUploadsRoot', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.LOCAL_UPLOADS_DIR
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.LOCAL_UPLOADS_DIR
    else process.env.LOCAL_UPLOADS_DIR = saved
  })

  it('uses LOCAL_UPLOADS_DIR when set', async () => {
    process.env.LOCAL_UPLOADS_DIR = path.join(tmpdir(), 'custom-uploads')
    expect(await resolveLocalUploadsRoot()).toBe(path.join(tmpdir(), 'custom-uploads'))
  })

  it('defaults to .local-uploads in the repo root', async () => {
    delete process.env.LOCAL_UPLOADS_DIR
    const root = await resolveLocalUploadsRoot()
    expect(path.basename(root)).toBe('.local-uploads')
    expect(await exists(path.join(path.dirname(root), 'drizzle.config.ts'))).toBe(true)
  })
})
