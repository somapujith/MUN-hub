import { describe, expect, it } from 'vitest'
import { buildOtpauthUri, generateTotpSecret, totp, totpCounter, verifyTotp } from './totp'

// RFC 4226 Appendix D's HOTP test vectors (secret = ASCII "12345678901234567890",
// SHA1, 6 digits) reused here via the TOTP wrapper by picking `at` so
// totpCounter(at) equals each HOTP counter (stepSeconds=1 makes the step
// counter equal to the unix second, so `at = counter * 1000` gives step = counter).
const RFC4226_SECRET_ASCII = '12345678901234567890'
const RFC4226_CODES = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']

// Small local base32 encoder mirroring totp.ts's alphabet, so the RFC
// vectors (given as raw ASCII bytes) can be handed to the base32-only API.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function toBase32(ascii: string): string {
  const bytes = Buffer.from(ascii, 'ascii')
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f]
  return out
}

const RFC4226_SECRET_B32 = toBase32(RFC4226_SECRET_ASCII)

describe('totp', () => {
  it('matches every RFC 4226 Appendix D test vector at stepSeconds=1 (counter = index)', () => {
    for (const [counter, expected] of RFC4226_CODES.entries()) {
      const at = new Date(counter * 1000)
      expect(totp(RFC4226_SECRET_B32, at, 1)).toBe(expected)
    }
  })

  it('matches the published RFC 6238 SHA1 test vector at Time=59s (T=1, 8 digits)', () => {
    // RFC 6238 Appendix B: T0=0, X=30, Time=59 -> T=1 -> "94287082" (SHA1, 8 digits).
    // Same key/counter as RFC 4226 counter=1 ("287082"); 8-digit and 6-digit
    // truncation share the same trailing digits, so this cross-checks hotp().
    expect(totp(RFC4226_SECRET_B32, new Date(59_000), 30, 8)).toBe('94287082')
  })

  it('base32 round-trips through generateTotpSecret -> totp -> verifyTotp', () => {
    const secret = generateTotpSecret()
    const at = new Date('2026-01-01T00:00:00Z')
    const code = totp(secret, at)
    expect(verifyTotp(secret, code, { at })).toBe(totpCounter(at))
  })
})

describe('verifyTotp', () => {
  const secret = toBase32('a-fixed-test-secret-value')
  const at = new Date('2026-06-15T12:00:30Z')

  it('accepts the current step', () => {
    const code = totp(secret, at)
    expect(verifyTotp(secret, code, { at })).toBe(totpCounter(at))
  })

  it('accepts the previous step within the default window (clock drift tolerance)', () => {
    const previousStepAt = new Date(at.getTime() - 30_000)
    const code = totp(secret, previousStepAt)
    expect(verifyTotp(secret, code, { at })).toBe(totpCounter(previousStepAt))
  })

  it('accepts the next step within the default window', () => {
    const nextStepAt = new Date(at.getTime() + 30_000)
    const code = totp(secret, nextStepAt)
    expect(verifyTotp(secret, code, { at })).toBe(totpCounter(nextStepAt))
  })

  it('rejects a step two windows away', () => {
    const farAt = new Date(at.getTime() + 90_000)
    const code = totp(secret, farAt)
    expect(verifyTotp(secret, code, { at })).toBeNull()
  })

  it('rejects a well-formed but wrong code', () => {
    expect(verifyTotp(secret, '000000', { at })).toBeNull()
  })

  it('rejects a malformed code without throwing', () => {
    expect(verifyTotp(secret, 'abcdef', { at })).toBeNull()
    expect(verifyTotp(secret, '12345', { at })).toBeNull()
  })

  it('replay protection: rejects a step at or before lastUsedStep even if otherwise in window', () => {
    const code = totp(secret, at)
    const currentStep = totpCounter(at)

    expect(verifyTotp(secret, code, { at, lastUsedStep: currentStep })).toBeNull()
    expect(verifyTotp(secret, code, { at, lastUsedStep: currentStep - 1 })).toBe(currentStep)
  })
})

describe('buildOtpauthUri', () => {
  it('produces an otpauth URI carrying the secret, issuer and account label', () => {
    const uri = buildOtpauthUri('JBSWY3DPEHPK3PXP', 'ops@munhub.in', 'MUN Hub')

    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain(encodeURIComponent('ops@munhub.in'))
    expect(uri).toContain('issuer=MUN')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })
})
