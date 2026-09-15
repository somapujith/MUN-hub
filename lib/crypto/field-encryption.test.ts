import { describe, expect, it } from 'vitest'
import { decryptField, encryptField } from './field-encryption'

describe('field-encryption', () => {
  it('round-trips: decrypting an encrypted value returns the original plaintext', () => {
    const plaintext = 'ABCDE1234F'
    const ciphertext = encryptField(plaintext)
    expect(decryptField(ciphertext)).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext on repeated calls (random IV per call)', () => {
    const plaintext = '1234567890123456'
    const first = encryptField(plaintext)
    const second = encryptField(plaintext)

    expect(first).not.toBe(second)
    // Both must still decrypt back to the same plaintext.
    expect(decryptField(first)).toBe(plaintext)
    expect(decryptField(second)).toBe(plaintext)
  })

  it('throws on decrypt when the ciphertext string has been tampered with', () => {
    const plaintext = 'sensitive-account-number'
    const ciphertext = encryptField(plaintext)
    const parts = ciphertext.split(':')
    const [ivB64, authTagB64, dataB64] = parts

    // Flip a character in the ciphertext portion (last segment) so the GCM
    // auth tag no longer verifies against it.
    const dataBuf = Buffer.from(dataB64, 'base64')
    dataBuf[0] = dataBuf[0] ^ 0xff
    const tamperedCiphertext = [ivB64, authTagB64, dataBuf.toString('base64')].join(':')

    expect(() => decryptField(tamperedCiphertext)).toThrow()
  })

  it('throws on decrypt when the auth tag itself has been tampered with', () => {
    const plaintext = 'another-sensitive-value'
    const ciphertext = encryptField(plaintext)
    const [ivB64, authTagB64, dataB64] = ciphertext.split(':')

    const tagBuf = Buffer.from(authTagB64, 'base64')
    tagBuf[0] = tagBuf[0] ^ 0xff
    const tamperedCiphertext = [ivB64, tagBuf.toString('base64'), dataB64].join(':')

    expect(() => decryptField(tamperedCiphertext)).toThrow()
  })

  it('throws on a malformed ciphertext string', () => {
    expect(() => decryptField('not-a-valid-format')).toThrow()
  })
})
