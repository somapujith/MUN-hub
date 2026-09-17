import type { StorageAdapter, StoredObject, UploadResult } from './adapter'

/** Every URL the mock hands out starts with this; nothing serves it. */
export const MOCK_STORAGE_URL_PREFIX = '/mock-storage/'

/**
 * Whether a stored media/document URL came from the mock adapter, i.e. the
 * row has no bytes behind it. Rows like this were written in production
 * while the mock was still the fallback; the go-live validators treat them
 * as missing so the organizer uploads the file again.
 */
export function isMockStorageUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(MOCK_STORAGE_URL_PREFIX)
}

/**
 * Test-only adapter: returns a placeholder URL and discards the bytes, so
 * `get` always returns null. selectStorageAdapter() returns it only when
 * STORAGE_ADAPTER=mock (as .env.test sets); with no binding and no
 * STORAGE_ADAPTER it throws instead.
 */
export const mockStorageAdapter: StorageAdapter = {
  async upload(_file: Buffer, key: string, _contentType: string): Promise<UploadResult> {
    return { url: `${MOCK_STORAGE_URL_PREFIX}${key}` }
  },

  async get(_key: string): Promise<StoredObject | null> {
    return null
  },

  async delete(_key: string): Promise<void> {
    return
  },
}
