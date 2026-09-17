import type { StoredObjectMetadata } from './adapter'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildObjectMetadata(file: Uint8Array, contentType: string): Promise<StoredObjectMetadata> {
  return {
    contentType,
    size: file.byteLength,
    sha256: await sha256Hex(file),
    uploadedAt: new Date().toISOString(),
  }
}

/** Reads metadata written by `buildObjectMetadata`; returns null for anything else. */
export function parseObjectMetadata(value: unknown): StoredObjectMetadata | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const size = typeof record.size === 'number' ? record.size : Number(record.size)
  if (typeof record.contentType !== 'string' || !Number.isFinite(size) || size < 0) return null
  return {
    contentType: record.contentType,
    size,
    sha256: typeof record.sha256 === 'string' ? record.sha256 : '',
    uploadedAt: typeof record.uploadedAt === 'string' ? record.uploadedAt : '',
  }
}

/**
 * An ArrayBuffer holding exactly `bytes`. Small Node Buffers are views into a
 * shared pool, so passing `buffer.buffer` straight to a binding could store
 * the whole pool; those are copied. A view that already spans its whole
 * buffer is returned without copying.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
