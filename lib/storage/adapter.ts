export interface UploadResult {
  url: string
}

/** What every real adapter records next to the bytes (KV metadata, R2 customMetadata, local sidecar). */
export interface StoredObjectMetadata {
  contentType: string
  size: number
  /** Lowercase hex SHA-256 of the stored bytes. */
  sha256: string
  /** ISO-8601 timestamp of the upload. */
  uploadedAt: string
}

export interface StoredObject {
  body: ReadableStream<Uint8Array> | Uint8Array
  contentType: string
  size: number
  sha256?: string
  uploadedAt?: string
}

/**
 * Storage provider interface. Call sites get an implementation from
 * `selectStorageAdapter()` (lib/storage/select-adapter.ts), which picks R2,
 * Workers KV, the local filesystem, or the mock, per request.
 *
 * Keys are always server-generated (never derived from a caller-supplied
 * filename) and must pass `isSafeStorageKey` (lib/storage/keys.ts).
 */
export interface StorageAdapter {
  upload(file: Buffer, key: string, contentType: string): Promise<UploadResult>
  /** Returns null when no object exists under `key`. */
  get(key: string): Promise<StoredObject | null>
  /** Deleting a key that does not exist is not an error. */
  delete(key: string): Promise<void>
}

/**
 * Message thrown when no storage backend is configured for this environment.
 * server/middleware/error.ts maps it to 503 UNAVAILABLE.
 */
export const STORAGE_NOT_CONFIGURED = 'File storage is not configured'

/**
 * Thrown by `selectStorageAdapter()` when there is no R2/KV binding and
 * STORAGE_ADAPTER names neither `local` nor `mock`.
 *
 * Uploads fail closed on purpose. Falling back to the mock adapter accepted
 * the bytes, threw them away and still wrote a row pointing at a
 * `/mock-storage/...` URL nothing serves — which then passed the go-live
 * validators, so a MUN could be published with a broken logo and an
 * unreachable rules PDF, and adding the binding later did not repair the rows.
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(STORAGE_NOT_CONFIGURED)
    this.name = 'StorageNotConfiguredError'
  }
}
