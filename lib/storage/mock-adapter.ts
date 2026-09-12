import type { StorageAdapter, UploadResult } from './adapter'

export const mockStorageAdapter: StorageAdapter = {
  async upload(_file: Buffer, key: string, _contentType: string): Promise<UploadResult> {
    return { url: `/mock-storage/${key}` }
  },

  async delete(_key: string): Promise<void> {
    return
  },
}
