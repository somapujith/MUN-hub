import { STORAGE_UNAVAILABLE_MESSAGE, type StorageAdapter } from './adapter'
import { getStorageBindings } from './bindings'
import { createKvStorageAdapter } from './kv-adapter'
import { createLocalStorageAdapter } from './local-adapter'
import { mockStorageAdapter } from './mock-adapter'
import { createR2StorageAdapter } from './r2-adapter'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { isProductionRuntime } from '@/lib/runtime-platform'

/**
 * Used in production when there is no storage binding. Uploads fail with
 * STORAGE_UNAVAILABLE_MESSAGE (503) before any row is written, so a module
 * never counts as complete with a file that was never stored. Reads find
 * nothing and deletes do nothing, so rows written before this change can
 * still be removed.
 */
export const unavailableStorageAdapter: StorageAdapter = {
  async upload() {
    throw new Error(STORAGE_UNAVAILABLE_MESSAGE)
  },
  async get() {
    return null
  },
  async delete() {
    return
  },
}

/**
 * Picks the storage backend for the current request, in this order:
 *   1. R2      — the UPLOADS_BUCKET binding, when present (reads fall back
 *                to KV while an UPLOADS_KV binding is also present)
 *   2. KV      — the UPLOADS_KV binding, when present (production today:
 *                R2 is not enabled on the Cloudflare account yet)
 *   3. local   — the filesystem, when STORAGE_ADAPTER=local (Node dev)
 *   4. unavailable — production (Workers, or NODE_ENV=production) with none
 *                of the above: uploads fail with 503
 *   5. mock    — everything else (tests); discards the bytes
 *
 * Bindings come from server/middleware/storage.ts via lib/storage/bindings.ts.
 * Production must have one of them. The mock is never used there: it would
 * report a successful upload while discarding the bytes.
 *
 * Called per operation, never cached: the adapters wrap request-scoped
 * binding objects and are cheap to build.
 */
export function selectStorageAdapter(): StorageAdapter {
  const bindings = getStorageBindings()
  if (bindings?.r2 && bindings.kv) {
    return withReadFallback(createR2StorageAdapter(bindings.r2), createKvStorageAdapter(bindings.kv))
  }
  if (bindings?.r2) return createR2StorageAdapter(bindings.r2)
  if (bindings?.kv) return createKvStorageAdapter(bindings.kv)

  const configured = getRuntimeEnv('STORAGE_ADAPTER')
  if (configured === 'local') return createLocalStorageAdapter()

  if (isProductionRuntime()) {
    console.error(
      '[storage] No UPLOADS_BUCKET or UPLOADS_KV binding in production — uploads are refused (503) until ' +
        'the binding is added in server/wrangler.jsonc.',
    )
    return unavailableStorageAdapter
  }
  return mockStorageAdapter
}

/**
 * The KV → R2 migration path: while both bindings exist, new uploads go to
 * `primary` (R2), reads try `primary` then `fallback` (KV) so files uploaded
 * before the switch keep working, and deletes remove the key from both.
 */
export function withReadFallback(primary: StorageAdapter, fallback: StorageAdapter): StorageAdapter {
  return {
    upload: (file, key, contentType) => primary.upload(file, key, contentType),
    async get(key) {
      return (await primary.get(key)) ?? fallback.get(key)
    },
    async delete(key) {
      await Promise.all([primary.delete(key), fallback.delete(key)])
    },
  }
}

/**
 * Deletes a stored object without failing the caller. Used after the row
 * that referenced the object is gone (or was never written): a leftover
 * object costs storage, not correctness, so it is logged, not thrown.
 */
export async function deleteStoredObjectQuietly(storage: StorageAdapter, key: string, context: string): Promise<void> {
  try {
    await storage.delete(key)
  } catch (error) {
    console.error(`[storage] ${context}: could not delete object "${key}"`, error)
  }
}
