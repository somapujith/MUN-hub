import { StorageNotConfiguredError, type StorageAdapter } from './adapter'
import { getStorageBindings } from './bindings'
import { createKvStorageAdapter } from './kv-adapter'
import { createLocalStorageAdapter } from './local-adapter'
import { mockStorageAdapter } from './mock-adapter'
import { createR2StorageAdapter } from './r2-adapter'
import { getRuntimeEnv } from '@/lib/runtime-env'

/**
 * Picks the storage backend for the current request, in this order:
 *   1. R2      — the UPLOADS_BUCKET binding, when present (reads fall back
 *                to KV while an UPLOADS_KV binding is also present)
 *   2. KV      — the UPLOADS_KV binding, when present (production today:
 *                R2 is not enabled on the Cloudflare account yet)
 *   3. local   — the filesystem, when STORAGE_ADAPTER=local (Node dev)
 *   4. mock    — only when STORAGE_ADAPTER=mock (tests); discards the bytes
 *
 * Bindings come from server/middleware/storage.ts via lib/storage/bindings.ts.
 * Anything else — production without a binding included — throws
 * `StorageNotConfiguredError`, which the API answers with 503, so the upload
 * is refused and no row is written.
 *
 * This fails closed on purpose. Quietly returning the mock meant an upload
 * answered 201 while the bytes were dropped, and the `/mock-storage/...` URL
 * it wrote into mun_media/mun_documents passed the go-live validators: a MUN
 * could be published with a logo that 404s and a rules PDF delegates can't
 * open, and adding the binding afterwards did not repair those rows.
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
  if (configured === 'mock') return mockStorageAdapter

  console.error(
    '[storage] No UPLOADS_BUCKET or UPLOADS_KV binding and STORAGE_ADAPTER is ' +
      `"${configured ?? 'unset'}" — refusing the request instead of discarding the file. ` +
      'Add the binding in server/wrangler.jsonc, or set STORAGE_ADAPTER=local (Node dev) / mock (tests).',
  )
  throw new StorageNotConfiguredError()
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
