import type { StorageAdapter, StoredObject, UploadResult } from './adapter'

/**
 * Prefix of every URL the mock adapter hands back. Nothing serves these:
 * a row carrying one has no bytes behind it. The go-live validators treat
 * such a row as "not uploaded" so a MUN can't be published with files that
 * don't exist (lib/lifecycle/validators/{content,operations}.ts).
 */
export const MOCK_STORAGE_URL_PREFIX = '/mock-storage/'

/**
 * Whether `url` points at the discarding mock store rather than a real
 * object. Both columns that hold one are NOT NULL; the loose parameter type
 * is only so a hand-built validator fixture without a `url` doesn't throw.
 */
export function isDiscardedUploadUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(MOCK_STORAGE_URL_PREFIX)
}

/**
 * Test-only adapter: returns a placeholder URL and discards the bytes, so
 * `get` always returns null. selectStorageAdapter() only returns it when
 * STORAGE_ADAPTER is explicitly `mock` (`.env.test`); every other
 * unconfigured environment fails closed instead.
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
