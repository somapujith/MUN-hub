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
