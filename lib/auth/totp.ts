import crypto from 'node:crypto'

// TOTP (RFC 6238) over HOTP (RFC 4226), HMAC-SHA1, node:crypto only — same
// "no new dependency" choice lib/auth/password.ts made for scrypt. Standard
// parameters throughout (30s step, 6 digits, SHA1) so every authenticator
// app (Google Authenticator, Authy, 1Password, ...) works without asking the
// user to pick anything.

const STEP_SECONDS = 30
const DIGITS = 6
const SECRET_BYTES = 20 // 160 bits — RFC 4226's recommended HMAC-SHA1 key size
const DEFAULT_WINDOW_STEPS = 1 // accepts the previous/next 30s step too, for clock drift

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, unpadded — the form every authenticator app's "enter manually" field expects. */
function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return output
}

/** Inverse of base32Encode. Accepts optional `=` padding and is case-insensitive. */
function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.trim().toUpperCase().replace(/=+$/, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A fresh random TOTP secret, base32-encoded for display/QR use. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(SECRET_BYTES))
}

/** RFC 4226 HOTP: HMAC-SHA1 over an 8-byte big-endian counter, dynamically truncated to `digits`. */
function hotp(key: Buffer, counter: number, digits: number = DIGITS): string {
  const counterBuffer = Buffer.alloc(8)
  // counter fits in the low 32 bits for millennia at a 30s step; write via
  // two 32-bit halves since Buffer has no native 64-bit big-endian writer.
  counterBuffer.writeUInt32BE(0, 0)
  counterBuffer.writeUInt32BE(counter, 4)

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The current 30s time-step counter for `at` (RFC 6238's T = floor((unixTime - T0) / X), T0 = 0). */
export function totpCounter(at: Date = new Date(), stepSeconds: number = STEP_SECONDS): number {
  return Math.floor(at.getTime() / 1000 / stepSeconds)
}

/** The 6-digit code for `secretBase32` at the step containing `at`. */
export function totp(secretBase32: string, at: Date = new Date(), stepSeconds: number = STEP_SECONDS, digits: number = DIGITS): string {
  return hotp(base32Decode(secretBase32), totpCounter(at, stepSeconds), digits)
}

/**
 * Checks `code` against the steps in `[counter - window, counter + window]`
 * around `at`, skipping any step at or before `lastUsedStep` (replay
 * protection — a code, once accepted, can never be accepted again even
 * within its own validity window). Returns the matched step (to persist as
 * the new `lastUsedStep`) or null. Constant-time compares each candidate so
 * response time doesn't leak how close a guess was.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { at?: Date; stepSeconds?: number; digits?: number; window?: number; lastUsedStep?: number | null } = {},
): number | null {
  const { at = new Date(), stepSeconds = STEP_SECONDS, digits = DIGITS, window = DEFAULT_WINDOW_STEPS, lastUsedStep = null } = options

  if (!/^\d+$/.test(code) || code.length !== digits) return null

  const key = base32Decode(secretBase32)
  const counter = totpCounter(at, stepSeconds)
  const codeBuffer = Buffer.from(code, 'utf8')

  for (let offset = -window; offset <= window; offset += 1) {
    const step = counter + offset
    if (step < 0 || (lastUsedStep !== null && step <= lastUsedStep)) continue

    const candidate = Buffer.from(hotp(key, step, digits), 'utf8')
    if (candidate.length === codeBuffer.length && crypto.timingSafeEqual(candidate, codeBuffer)) {
      return step
    }
  }
  return null
}

/** The `otpauth://` URI authenticator apps scan as a QR code (RFC — de facto standard, Google Authenticator's Key URI Format). */
export function buildOtpauthUri(secretBase32: string, accountLabel: string, issuer = 'MUN Hub'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}`
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
