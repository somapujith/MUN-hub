export interface UploadResult {
  url: string
}

/**
 * Storage provider interface. Mock local-URL implementation now; a real R2
 * adapter implements the same interface later, call sites unchanged.
 */
export interface StorageAdapter {
  upload(file: Buffer, key: string, contentType: string): Promise<UploadResult>
  delete(key: string): Promise<void>
}
