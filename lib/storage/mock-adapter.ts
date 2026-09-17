import type { StorageAdapter, StoredObject, UploadResult } from './adapter'

/**
 * Test-only adapter: returns a placeholder URL and discards the bytes, so
 * `get` always returns null. selectStorageAdapter() falls back to it when no
 * binding is present and STORAGE_ADAPTER is not `local` (logging an error if
 * that happens in production).
 */
export const mockStorageAdapter: StorageAdapter = {
  async upload(_file: Buffer, key: string, _contentType: string): Promise<UploadResult> {
    return { url: `/mock-storage/${key}` }
  },

  async get(_key: string): Promise<StoredObject | null> {
    return null
  },

  async delete(_key: string): Promise<void> {
    return
  },
}
