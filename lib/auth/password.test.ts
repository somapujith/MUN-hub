import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('hashPassword', () => {
  it('produces a different string each time for the same password (random salt)', async () => {
    const hashA = await hashPassword('correct-horse-battery-staple')
    const hashB = await hashPassword('correct-horse-battery-staple')

    expect(hashA).not.toBe(hashB)
  })
})

describe('verifyPassword', () => {
  it('returns true for the correct password against its own hash', async () => {
    const password = 'correct-horse-battery-staple'
    const hash = await hashPassword(password)

    await expect(verifyPassword(password, hash)).resolves.toBe(true)
  })

  it('returns false for a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')

    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('returns false (does not throw) for an empty stored value', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false)
  })

  it('returns false (does not throw) for a stored value with no ":" separator', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false)
  })
})
