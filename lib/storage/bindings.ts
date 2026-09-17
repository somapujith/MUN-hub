import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Hands Cloudflare storage bindings (and the current request's origin) to
 * lib/ code that has no access to Hono's `c.env`, following the same
 * pattern as lib/db/hyperdrive-bridge.ts.
 *
 * `server/middleware/storage.ts` reads `c.env.UPLOADS_BUCKET` /
 * `c.env.UPLOADS_KV` and runs the rest of the request inside
 * `runWithStorageBindings`. The store is scoped to that request's async call
 * graph with AsyncLocalStorage, never to a module-level variable: Workers
 * ties I/O to the request that started it, and one isolate serves many
 * requests, sometimes at the same time. Nothing here outlives the request.
 *
 * Local Node dev and tests normally run outside any scope, so
 * `getStorageBindings()` returns undefined and `selectStorageAdapter()`
 * falls back to STORAGE_ADAPTER (local or mock).
 */

/** The subset of Cloudflare's `KVNamespace` the KV adapter uses. */
export interface KvNamespaceLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { metadata?: unknown },
  ): Promise<void>
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: { type: 'stream' },
  ): Promise<{ value: ReadableStream<Uint8Array> | null; metadata: Metadata | null }>
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: { type: 'arrayBuffer' },
  ): Promise<{ value: ArrayBuffer | null; metadata: Metadata | null }>
  delete(key: string): Promise<void>
}

/** The subset of Cloudflare's `R2ObjectBody` the R2 adapter reads. */
export interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array>
  size: number
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
  uploaded?: Date
}

/** The subset of Cloudflare's `R2Bucket` the R2 adapter uses. */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
      sha256?: string
    },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
  delete(key: string): Promise<void>
}

export interface StorageBindings {
  r2?: R2BucketLike
  kv?: KvNamespaceLike
  /** Origin of the current request, e.g. http://localhost:3001 (used to build file URLs in dev). */
  requestOrigin?: string
}

const storageContext = new AsyncLocalStorage<StorageBindings>()

export function runWithStorageBindings<T>(bindings: StorageBindings, fn: () => T): T {
  return storageContext.run(bindings, fn)
}

export function getStorageBindings(): StorageBindings | undefined {
  return storageContext.getStore()
}
