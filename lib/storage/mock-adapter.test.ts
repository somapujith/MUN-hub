import { describe, expect, it } from 'vitest'
import { mockStorageAdapter } from './mock-adapter'

describe('mockStorageAdapter', () => {
  it('uploads and returns a stable local URL', async () => {
    const result = await mockStorageAdapter.upload(Buffer.from('test'), 'logos/test.png', 'image/png')
    expect(result.url).toBe('/mock-storage/logos/test.png')
  })

  it('discards the bytes, so get returns null', async () => {
    await mockStorageAdapter.upload(Buffer.from('test'), 'logos/test.png', 'image/png')
    await expect(mockStorageAdapter.get('logos/test.png')).resolves.toBeNull()
  })

  it('delete resolves without throwing', async () => {
    await expect(mockStorageAdapter.delete('logos/test.png')).resolves.toBeUndefined()
  })
})
