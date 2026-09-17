import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DUMMY_PASSWORD_HASH, SCRYPT_PARAMS, hashPassword, needsRehash, verifyPassword } from './password'

/** A hash in the pre-2026-09-17 `salt:hash` format (Node scrypt defaults, hex salt string as the salt). */
function legacyHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}

describe('hashPassword', () => {
  it('produces a different string each time for the same password (random salt)', async () => {
    const hashA = await hashPassword('correct-horse-battery-staple')
    const hashB = await hashPassword('correct-horse-battery-staple')

    expect(hashA).not.toBe(hashB)
  })

  it('writes the self-describing scrypt$N$r$p$salt$hash format at the current cost', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    const [scheme, N, r, p, salt, key] = hash.split('$')

    expect(scheme).toBe('scrypt')
    expect(Number(N)).toBe(SCRYPT_PARAMS.N)
    expect(Number(N)).toBeGreaterThanOrEqual(2 ** 15)
    expect(Number(r)).toBe(SCRYPT_PARAMS.r)
    expect(Number(p)).toBe(SCRYPT_PARAMS.p)
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(key).toMatch(/^[0-9a-f]{128}$/)
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

  it('still verifies legacy salt:hash values', async () => {
    const hash = legacyHash('legacy-password-1')

    await expect(verifyPassword('legacy-password-1', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('honours the parameters recorded in the hash, not the current defaults', async () => {
    const salt = crypto.randomBytes(16)
    const key = crypto.scryptSync('older-cost', salt, 64, { N: 2 ** 14, r: 8, p: 1 })
    const stored = ['scrypt', 2 ** 14, 8, 1, salt.toString('hex'), key.toString('hex')].join('$')

    await expect(verifyPassword('older-cost', stored)).resolves.toBe(true)
  })

  it('returns false (does not throw) for an empty stored value', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false)
  })

  it('returns false (does not throw) for a stored value with no ":" separator', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false)
  })

  it('returns false (does not throw) for malformed or out-of-bounds scrypt$ values', async () => {
    const salt = '00'.repeat(16)
    const key = '00'.repeat(64)
    for (const stored of [
      `scrypt$32768$8$1$${salt}`, // missing key
      `scrypt$30000$8$1$${salt}$${key}`, // N not a power of two
      `scrypt$${2 ** 24}$8$1$${salt}$${key}`, // N above the memory bound
      `scrypt$32768$0$1$${salt}$${key}`, // r out of range
      `scrypt$32768$8$1$not-hex$${key}`,
      `scrypt$32768$8$1$${salt}$zz`,
    ]) {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false)
    }
  })

  it('never matches the dummy hash used for unknown accounts', async () => {
    await expect(verifyPassword('', DUMMY_PASSWORD_HASH)).resolves.toBe(false)
    await expect(verifyPassword('munhub-demo', DUMMY_PASSWORD_HASH)).resolves.toBe(false)
  })
})

describe('needsRehash', () => {
  it('flags legacy hashes', () => {
    expect(needsRehash(legacyHash('whatever-password'))).toBe(true)
  })

  it('flags hashes at a different cost', () => {
    const stored = ['scrypt', 2 ** 14, 8, 1, '00'.repeat(16), '00'.repeat(64)].join('$')
    expect(needsRehash(stored)).toBe(true)
  })

  it('leaves current hashes alone', async () => {
    expect(needsRehash(await hashPassword('current-password'))).toBe(false)
    expect(needsRehash(DUMMY_PASSWORD_HASH)).toBe(false)
  })

  it('returns false for values it cannot parse', () => {
    expect(needsRehash('')).toBe(false)
    expect(needsRehash('garbage')).toBe(false)
  })
})

describe('DUMMY_PASSWORD_HASH', () => {
  it('uses the current parameters, so verifying against it costs the same as a real hash', () => {
    const [, N, r, p] = DUMMY_PASSWORD_HASH.split('$')
    expect([Number(N), Number(r), Number(p)]).toEqual([SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p])
  })
})
