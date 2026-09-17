import type { StorageAdapter, StoredObject, StoredObjectMetadata } from './adapter'
import type { KvNamespaceLike } from './bindings'
import { assertSafeStorageKey, publicFileUrl } from './keys'
import { buildObjectMetadata, parseObjectMetadata, toArrayBuffer } from './object-metadata'

/** Workers KV rejects values over 25 MiB. Upload caps (lib/storage/validate.ts) are far below this. */
export const KV_MAX_VALUE_BYTES = 25 * 1024 * 1024

/**
 * Stores uploads in a Workers KV namespace (binding UPLOADS_KV). The bytes
 * are the value; contentType, size, sha256 and uploadedAt are the KV
 * metadata (well under KV's 1024-byte metadata limit).
 *
 * KV is eventually consistent: a new key can take up to ~60 seconds to be
 * readable from other Cloudflare locations. Keys are never overwritten (each
 * upload gets a fresh UUID), so readers only ever see "missing" or "the
 * final bytes", never a stale version.
 */
export function createKvStorageAdapter(kv: KvNamespaceLike): StorageAdapter {
  return {
    async upload(file, key, contentType) {
      assertSafeStorageKey(key)
      if (file.byteLength > KV_MAX_VALUE_BYTES) {
        throw new Error(`File too large (${file.byteLength} bytes) — maximum allowed size is 25MB`)
      }
      const data = toArrayBuffer(file)
      const metadata = await buildObjectMetadata(file, contentType)
      await kv.put(key, data, { metadata })
      return { url: publicFileUrl(key) }
    },

    async get(key): Promise<StoredObject | null> {
      assertSafeStorageKey(key)
      const { value, metadata } = await kv.getWithMetadata<StoredObjectMetadata>(key, { type: 'stream' })
      if (!value) return null

      const parsed = parseObjectMetadata(metadata)
      if (parsed) {
        return { body: value, ...parsed }
      }

      // Written without our metadata (e.g. by hand through the dashboard):
      // read it whole so the size is known, and serve it as opaque bytes.
      await value.cancel()
      const whole = await kv.getWithMetadata(key, { type: 'arrayBuffer' })
      if (!whole.value) return null
      return {
        body: new Uint8Array(whole.value),
        contentType: 'application/octet-stream',
        size: whole.value.byteLength,
      }
    },

    async delete(key) {
      assertSafeStorageKey(key)
      await kv.delete(key)
    },
  }
}
