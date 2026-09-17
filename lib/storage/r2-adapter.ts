import type { StorageAdapter, StoredObject } from './adapter'
import type { R2BucketLike } from './bindings'
import { assertSafeStorageKey, publicFileUrl } from './keys'
import { buildObjectMetadata, toArrayBuffer } from './object-metadata'

/**
 * Stores uploads in an R2 bucket (binding UPLOADS_BUCKET). Same semantics as
 * the KV adapter: the content type goes in httpMetadata, sha256 and
 * uploadedAt in customMetadata. The sha256 is also passed to `put`, so R2
 * rejects the write if the bytes arrive corrupted.
 *
 * R2 is not enabled on the Cloudflare account yet (API error 10042). Once
 * it is, adding the UPLOADS_BUCKET binding switches new uploads to R2
 * automatically; see docs/autonomous-run/changes/lane-storage.md.
 */
export function createR2StorageAdapter(bucket: R2BucketLike): StorageAdapter {
  return {
    async upload(file, key, contentType) {
      assertSafeStorageKey(key)
      const metadata = await buildObjectMetadata(file, contentType)
      await bucket.put(key, toArrayBuffer(file), {
        httpMetadata: { contentType },
        customMetadata: { sha256: metadata.sha256, uploadedAt: metadata.uploadedAt },
        sha256: metadata.sha256,
      })
      return { url: publicFileUrl(key) }
    },

    async get(key): Promise<StoredObject | null> {
      assertSafeStorageKey(key)
      const object = await bucket.get(key)
      if (!object) return null
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
        size: object.size,
        sha256: object.customMetadata?.sha256,
        uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded?.toISOString(),
      }
    },

    async delete(key) {
      assertSafeStorageKey(key)
      await bucket.delete(key)
    },
  }
}
