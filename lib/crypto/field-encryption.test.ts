import { createCipheriv, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptField, encryptField } from './field-encryption'

const ORIGINAL_KEY = process.env.PAYMENT_FIELD_KEY
const OTHER_KEY = randomBytes(32).toString('base64')

afterEach(() => {
  process.env.PAYMENT_FIELD_KEY = ORIGINAL_KEY
  delete process.env.PAYMENT_FIELD_KEY_PREVIOUS
})

/** Builds a ciphertext the way the pre-versioning encryptField did (no prefix). */
function legacyEncrypt(plaintext: string, keyB64: string, tagLength = 16): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv, { authTagLength: tagLength })
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':')
}

describe('field-encryption', () => {
  it('round-trips: decrypting an encrypted value returns the original plaintext', () => {
    const plaintext = 'ABCDE1234F'
    const ciphertext = encryptField(plaintext)
    expect(decryptField(ciphertext)).toBe(plaintext)
  })

  it('writes the v1-prefixed format with a 12-byte IV and a 16-byte tag', () => {
    const [version, ivB64, tagB64, dataB64] = encryptField('1234567890').split(':')
    expect(version).toBe('v1')
    expect(Buffer.from(ivB64, 'base64')).toHaveLength(12)
    expect(Buffer.from(tagB64, 'base64')).toHaveLength(16)
    expect(dataB64.length).toBeGreaterThan(0)
  })

  it('still decrypts legacy unprefixed ciphertexts', () => {
    const legacy = legacyEncrypt('legacy-account-number', ORIGINAL_KEY!)
    expect(legacy.split(':')).toHaveLength(3)
    expect(decryptField(legacy)).toBe('legacy-account-number')
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
    const [version, ivB64, authTagB64, dataB64] = encryptField(plaintext).split(':')

    // Flip a byte in the ciphertext portion so the GCM auth tag no longer
    // verifies against it.
    const dataBuf = Buffer.from(dataB64, 'base64')
    dataBuf[0] = dataBuf[0] ^ 0xff
    const tamperedCiphertext = [version, ivB64, authTagB64, dataBuf.toString('base64')].join(':')

    expect(() => decryptField(tamperedCiphertext)).toThrow()
  })

  it('throws on decrypt when the auth tag itself has been tampered with', () => {
    const [version, ivB64, authTagB64, dataB64] = encryptField('another-sensitive-value').split(':')

    const tagBuf = Buffer.from(authTagB64, 'base64')
    tagBuf[0] = tagBuf[0] ^ 0xff
    const tamperedCiphertext = [version, ivB64, tagBuf.toString('base64'), dataB64].join(':')

    expect(() => decryptField(tamperedCiphertext)).toThrow()
  })

  it('rejects a truncated auth tag instead of verifying fewer bytes', () => {
    const [version, ivB64, authTagB64, dataB64] = encryptField('truncated-tag').split(':')
    const shortTag = Buffer.from(authTagB64, 'base64').subarray(0, 12).toString('base64')

    expect(() => decryptField([version, ivB64, shortTag, dataB64].join(':'))).toThrow(/auth tag must be 16 bytes/)
    // Same for a legacy ciphertext produced with a genuinely short tag.
    expect(() => decryptField(legacyEncrypt('short', ORIGINAL_KEY!, 12))).toThrow(/auth tag must be 16 bytes/)
  })

  it('throws on a malformed ciphertext string', () => {
    expect(() => decryptField('not-a-valid-format')).toThrow()
    expect(() => decryptField('v2:a:b:c')).toThrow(/Malformed ciphertext/)
  })

  describe('key rotation', () => {
    it('decrypts with PAYMENT_FIELD_KEY_PREVIOUS after the current key has been rotated', () => {
      const written = encryptField('rotate-me')
      const legacyWritten = legacyEncrypt('rotate-me-too', ORIGINAL_KEY!)

      process.env.PAYMENT_FIELD_KEY_PREVIOUS = ORIGINAL_KEY
      process.env.PAYMENT_FIELD_KEY = OTHER_KEY

      expect(decryptField(written)).toBe('rotate-me')
      expect(decryptField(legacyWritten)).toBe('rotate-me-too')
    })

    it('encrypts only with the current key — the previous key is decrypt-only', () => {
      process.env.PAYMENT_FIELD_KEY_PREVIOUS = ORIGINAL_KEY
      process.env.PAYMENT_FIELD_KEY = OTHER_KEY
      const written = encryptField('new-key-only')

      // Drop the new key from the rotation: the old key alone can't read it.
      process.env.PAYMENT_FIELD_KEY = ORIGINAL_KEY
      delete process.env.PAYMENT_FIELD_KEY_PREVIOUS
      expect(() => decryptField(written)).toThrow()
    })

    it('fails once a key has been rotated out entirely', () => {
      const written = encryptField('gone')
      process.env.PAYMENT_FIELD_KEY = OTHER_KEY
      expect(() => decryptField(written)).toThrow()
    })

    it('rejects a malformed previous key rather than ignoring it', () => {
      const written = encryptField('bad-previous')
      process.env.PAYMENT_FIELD_KEY_PREVIOUS = Buffer.from('too-short').toString('base64')
      expect(() => decryptField(written)).toThrow(/PAYMENT_FIELD_KEY_PREVIOUS must decode to exactly 32 bytes/)
    })
  })
})
