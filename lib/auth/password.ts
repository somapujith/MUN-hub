import crypto from 'node:crypto'

// scrypt, not bcrypt/argon2 — no new dependency needed (Node's built-in
// crypto, which Cloudflare Workers' nodejs_compat also implements) and it
// has no native binding to compile on any platform.
//
// Stored format (self-describing, so the cost can be raised later without
// breaking existing hashes):
//
//   scrypt$<N>$<r>$<p>$<salt hex>$<derived key hex>
//
// Hashes written before this format existed look like `<salt>:<key hex>` —
// Node's scrypt defaults (N=2^14, r=8, p=1), with the 32-char hex salt
// string itself (not its decoded bytes) as the salt input. They still
// verify, and `needsRehash` flags them so sign-in upgrades them in place.
//
// Cost choice: N=2^15, r=8, p=1 (~32 MiB, twice the old N=2^14). Measured on
// a dev machine (Node 24): 2^14 ≈ 35 ms, 2^15 ≈ 65 ms, 2^16 ≈ 130 ms per
// hash. The API runs on Cloudflare Workers, where every request is billed
// against a CPU-time limit and an isolate has 128 MiB of memory shared by
// concurrent requests; 2^16 (64 MiB per hash) would leave room for only one
// concurrent sign-in per isolate. 2^15 roughly doubles an offline
// attacker's work while keeping a sign-in well inside both limits.
// Raise SCRYPT_PARAMS.N here when that trade-off changes; old hashes keep
// verifying and are upgraded on the next successful sign-in.

const KEY_LENGTH = 64
const SALT_BYTES = 16
const FORMAT_PREFIX = 'scrypt'

interface ScryptParams {
  N: number
  r: number
  p: number
}

export const SCRYPT_PARAMS: Readonly<ScryptParams> = { N: 2 ** 15, r: 8, p: 1 }
const LEGACY_PARAMS: Readonly<ScryptParams> = { N: 2 ** 14, r: 8, p: 1 }

// Bounds for parameters read back from storage, so a corrupted row can't ask
// for gigabytes of memory.
const MAX_N = 2 ** 17
const MAX_R = 32
const MAX_P = 16

function scryptAsync(password: string, salt: string | Buffer, params: ScryptParams, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      // maxmem must exceed 128 * N * r (Node's default cap is exactly 32 MiB,
      // which N=2^15, r=8 would hit).
      { N: params.N, r: params.r, p: params.p, maxmem: 2 * 128 * params.N * params.r },
      (error, derivedKey) => {
        if (error) reject(error)
        else resolve(derivedKey)
      },
    )
  })
}

/** Hashes a plaintext password into a self-describing `scrypt$N$r$p$salt$hash` string for `users.passwordHash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES)
  const { N, r, p } = SCRYPT_PARAMS
  const derivedKey = await scryptAsync(password, salt, SCRYPT_PARAMS, KEY_LENGTH)
  return [FORMAT_PREFIX, N, r, p, salt.toString('hex'), derivedKey.toString('hex')].join('$')
}

interface ParsedHash {
  params: ScryptParams
  salt: string | Buffer
  key: Buffer
  legacy: boolean
}

const HEX = /^(?:[0-9a-f]{2})+$/i

function parsePositiveInt(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return parsed >= 1 && parsed <= max ? parsed : null
}

function parseStoredHash(stored: string): ParsedHash | null {
  if (!stored) return null

  if (stored.startsWith(`${FORMAT_PREFIX}$`)) {
    const parts = stored.split('$')
    if (parts.length !== 6) return null
    const [, nText, rText, pText, saltHex, keyHex] = parts
    const N = parsePositiveInt(nText, MAX_N)
    const r = parsePositiveInt(rText, MAX_R)
    const p = parsePositiveInt(pText, MAX_P)
    // scrypt requires N to be a power of two greater than 1.
    if (!N || N < 2 || (N & (N - 1)) !== 0 || !r || !p) return null
    if (!HEX.test(saltHex) || !HEX.test(keyHex)) return null
    return {
      params: { N, r, p },
      salt: Buffer.from(saltHex, 'hex'),
      key: Buffer.from(keyHex, 'hex'),
      legacy: false,
    }
  }

  const parts = stored.split(':')
  if (parts.length !== 2) return null
  const [salt, keyHex] = parts
  if (!salt || !HEX.test(keyHex)) return null
  return { params: LEGACY_PARAMS, salt, key: Buffer.from(keyHex, 'hex'), legacy: true }
}

/**
 * Verifies a plaintext password against a stored hash in either the current
 * `scrypt$…` format or the legacy `salt:hash` one. Uses a timing-safe
 * comparison so response time doesn't leak how close a guess was. Returns
 * false (never throws) for a malformed stored value.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored)
  if (!parsed) return false

  const derivedKey = await scryptAsync(password, parsed.salt, parsed.params, parsed.key.length)
  if (derivedKey.length !== parsed.key.length) return false

  return crypto.timingSafeEqual(derivedKey, parsed.key)
}

/**
 * True when a stored hash that just verified should be replaced with a fresh
 * `hashPassword` result: the legacy format, or parameters/key length that
 * differ from the current ones.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseStoredHash(stored)
  if (!parsed) return false
  if (parsed.legacy) return true
  return (
    parsed.params.N !== SCRYPT_PARAMS.N ||
    parsed.params.r !== SCRYPT_PARAMS.r ||
    parsed.params.p !== SCRYPT_PARAMS.p ||
    parsed.key.length !== KEY_LENGTH
  )
}

/**
 * A well-formed hash at the current cost that no password matches (its key
 * is all zeros, which scrypt won't produce in practice). Sign-in verifies
 * against it when the email has no account, or the account has no password,
 * so that path costs the same scrypt work as a real wrong password and
 * response time doesn't reveal which emails are registered.
 */
export const DUMMY_PASSWORD_HASH = [
  FORMAT_PREFIX,
  SCRYPT_PARAMS.N,
  SCRYPT_PARAMS.r,
  SCRYPT_PARAMS.p,
  '00'.repeat(SALT_BYTES),
  '00'.repeat(KEY_LENGTH),
].join('$')
