import type { StorageAdapter, StoredObject } from './adapter'
import { assertSafeStorageKey, publicFileUrl } from './keys'
import { buildObjectMetadata, parseObjectMetadata } from './object-metadata'
import { getRuntimeEnv } from '@/lib/runtime-env'

/**
 * Filesystem storage for local Node dev (STORAGE_ADAPTER=local). Never used
 * on Workers: selectStorageAdapter() prefers the R2/KV bindings, and Workers
 * has no writable filesystem.
 *
 * Layout under the root directory (default `<repo>/.local-uploads`, which is
 * gitignored; override with LOCAL_UPLOADS_DIR):
 *   objects/<key>      the bytes
 *   meta/<key>.json    contentType, size, sha256, uploadedAt
 * Keeping the two in separate trees means no key can collide with another
 * key's metadata file.
 *
 * node:fs and node:path are imported lazily so the Worker bundle never
 * evaluates them at startup.
 */

export const DEFAULT_LOCAL_UPLOADS_DIRNAME = '.local-uploads'

/** LOCAL_UPLOADS_DIR if set, else `.local-uploads` in the repo root (found by walking up to drizzle.config.ts). */
export async function resolveLocalUploadsRoot(): Promise<string> {
  const path = await import('node:path')
  const configured = getRuntimeEnv('LOCAL_UPLOADS_DIR')
  if (configured) return path.resolve(configured)

  const { existsSync } = await import('node:fs')
  const start = process.cwd()
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, 'drizzle.config.ts'))) return path.join(dir, DEFAULT_LOCAL_UPLOADS_DIRNAME)
    const parent = path.dirname(dir)
    if (parent === dir) return path.join(start, DEFAULT_LOCAL_UPLOADS_DIRNAME)
    dir = parent
  }
}

async function pathsFor(rootDir: string | undefined, key: string) {
  assertSafeStorageKey(key)
  const path = await import('node:path')
  const root = path.resolve(rootDir ?? (await resolveLocalUploadsRoot()))
  const objectsDir = path.join(root, 'objects')
  const metaDir = path.join(root, 'meta')
  const segments = key.split('/')
  const objectPath = path.resolve(objectsDir, ...segments)
  const metaPath = `${path.resolve(metaDir, ...segments)}.json`
  // isSafeStorageKey already rules out `..`; this is a second, independent check.
  if (!objectPath.startsWith(objectsDir + path.sep) || !metaPath.startsWith(metaDir + path.sep)) {
    throw new Error('Invalid storage key')
  }
  return { path, objectPath, metaPath }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function createLocalStorageAdapter(rootDir?: string): StorageAdapter {
  return {
    async upload(file, key, contentType) {
      const { path, objectPath, metaPath } = await pathsFor(rootDir, key)
      const fs = await import('node:fs/promises')
      const metadata = await buildObjectMetadata(file, contentType)
      await fs.mkdir(path.dirname(objectPath), { recursive: true })
      await fs.mkdir(path.dirname(metaPath), { recursive: true })
      await fs.writeFile(objectPath, file)
      await fs.writeFile(metaPath, JSON.stringify(metadata))
      return { url: publicFileUrl(key) }
    },

    async get(key): Promise<StoredObject | null> {
      const { objectPath, metaPath } = await pathsFor(rootDir, key)
      const fs = await import('node:fs/promises')
      try {
        const metadata = parseObjectMetadata(JSON.parse(await fs.readFile(metaPath, 'utf8')))
        const bytes = await fs.readFile(objectPath)
        const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        if (!metadata) return { body, contentType: 'application/octet-stream', size: bytes.byteLength }
        return { body, ...metadata, size: bytes.byteLength }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    async delete(key) {
      const { objectPath, metaPath } = await pathsFor(rootDir, key)
      const fs = await import('node:fs/promises')
      await fs.rm(objectPath, { force: true })
      await fs.rm(metaPath, { force: true })
    },
  }
}
