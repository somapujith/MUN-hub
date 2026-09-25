import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getRuntimeEnv } from '@/lib/runtime-env'

// -----------------------------------------------------------------------------
// field-encryption — AES-256-GCM helpers for at-rest field encryption
// -----------------------------------------------------------------------------
//
// Used by lib/actions/payment-settlement.ts to encrypt the full PAN and bank
// account number before they ever touch the database. Design doc Section 2.3
// / Section 8 invariant #7: payment plaintext is write-only and structurally
// unreachable by any read path in this slice.
//
// Key handling: PAYMENT_FIELD_KEY must be a base64-encoded 32-byte value.
// There is deliberately NO default key and NO fallback — a silently-weak key
// is worse than a crash. A misconfigured key fails loudly on first real use
// rather than silently encrypting with a bad key.
//
// Key rotation: set the new key as PAYMENT_FIELD_KEY and move the old one to
// PAYMENT_FIELD_KEY_PREVIOUS. New ciphertexts always use PAYMENT_FIELD_KEY;
// the previous key is decrypt-only (tried when the current key's GCM tag
// doesn't verify), so rows written before the rotation stay readable until
// they are re-encrypted.
//
// Multiple key domains: `encryptField`/`decryptField` take an optional
// `FieldEncryptionKeyNames` so a second caller can use its own key pair
// without sharing PAYMENT_FIELD_KEY's blast radius — e.g. `TOTP_KEY_NAMES`
// below, used by lib/actions/staff-mfa.ts to encrypt TOTP secrets under
// TOTP_FIELD_KEY/TOTP_FIELD_KEY_PREVIOUS. Omitting the argument keeps every
// existing call site's behavior (PAYMENT_FIELD_KEY) unchanged.
//
// Ciphertext format:
//   v1:base64(iv):base64(authTag):base64(ciphertext)   ← written now
//   base64(iv):base64(authTag):base64(ciphertext)      ← legacy, still read
// The version prefix leaves room to change the scheme later without
// guessing. Both use a 12-byte IV and a full 16-byte tag; decryption pins
// the tag length, so a truncated tag (which would weaken GCM's forgery
// resistance) is rejected rather than accepted.
//
// Loaded lazily rather than at module top-level: under Cloudflare Workers
// this module is evaluated once at cold start, before any request (and
// therefore before `env`/secrets) exists, so eagerly reading the key at
// import time always saw it as unset and failed Wrangler's deploy-time
// validation. And even lazily, Workers never populate custom vars/secrets
// into `process.env` at all (only `NODE_ENV` is special-cased) — so this
// reads via `getRuntimeEnv` (lib/runtime-env.ts), not `process.env` directly,
// or the key would still silently be missing on every real request in
// production despite being correctly configured as a Workers secret. Same
// class of problem `lib/db/client.ts`'s `resolveConnectionString`/
// Hyperdrive-bridge solves. Local Node dev/tests are unaffected: they read
// real `process.env.PAYMENT_FIELD_KEY` on first use.

const KEY_BYTE_LENGTH = 32
const IV_BYTE_LENGTH = 12
const AUTH_TAG_BYTE_LENGTH = 16
const SEPARATOR = ':'
const CURRENT_VERSION = 'v1'

/** Which env vars hold a key domain's current/previous key. See "Multiple key domains" above. */
export interface FieldEncryptionKeyNames {
  currentKeyEnvVar: string
  previousKeyEnvVar: string
}

const PAYMENT_KEY_NAMES: FieldEncryptionKeyNames = {
  currentKeyEnvVar: 'PAYMENT_FIELD_KEY',
  previousKeyEnvVar: 'PAYMENT_FIELD_KEY_PREVIOUS',
}

/** lib/actions/staff-mfa.ts's key domain — separate from PAYMENT_KEY_NAMES on purpose. */
export const TOTP_KEY_NAMES: FieldEncryptionKeyNames = {
  currentKeyEnvVar: 'TOTP_FIELD_KEY',
  previousKeyEnvVar: 'TOTP_FIELD_KEY_PREVIOUS',
}

const decodedKeys = new Map<string, Buffer>()

function decodeKey(name: string, raw: string): Buffer {
  const cached = decodedKeys.get(raw)
  if (cached) return cached

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new Error(
      `${name} must decode to exactly ${KEY_BYTE_LENGTH} bytes (base64-encoded); got ${key.length} bytes`,
    )
  }
  decodedKeys.set(raw, key)
  return key
}

function getEncryptionKey(keyNames: FieldEncryptionKeyNames): Buffer {
  const raw = getRuntimeEnv(keyNames.currentKeyEnvVar)
  if (!raw) {
    throw new Error(`${keyNames.currentKeyEnvVar} environment variable is not set — refusing to start without a field-encryption key`)
  }
  return decodeKey(keyNames.currentKeyEnvVar, raw)
}

/** Current key first, then the decrypt-only previous key when one is configured. */
function getDecryptionKeys(keyNames: FieldEncryptionKeyNames): Buffer[] {
  const keys = [getEncryptionKey(keyNames)]
  const previous = getRuntimeEnv(keyNames.previousKeyEnvVar)
  if (previous) keys.push(decodeKey(keyNames.previousKeyEnvVar, previous))
  return keys
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `keyNames.currentKeyEnvVar`
 * (PAYMENT_FIELD_KEY unless overridden), using a fresh random 12-byte IV.
 * Output is `v1:base64(iv):base64(authTag):base64(ciphertext)` as one string.
 */
export function encryptField(plaintext: string, keyNames: FieldEncryptionKeyNames = PAYMENT_KEY_NAMES): string {
  const iv = randomBytes(IV_BYTE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(keyNames), iv, { authTagLength: AUTH_TAG_BYTE_LENGTH })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [CURRENT_VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    SEPARATOR,
  )
}

function parseCiphertext(value: string): { iv: Buffer; authTag: Buffer; data: Buffer } {
  const parts = value.split(SEPARATOR)
  let segments: string[]
  if (parts.length === 4 && parts[0] === CURRENT_VERSION) {
    segments = parts.slice(1)
  } else if (parts.length === 3) {
    segments = parts
  } else {
    throw new Error('Malformed ciphertext: expected v1:iv:authTag:ciphertext')
  }

  const [ivB64, authTagB64, dataB64] = segments
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  if (iv.length !== IV_BYTE_LENGTH) {
    throw new Error(`Malformed ciphertext: IV must be ${IV_BYTE_LENGTH} bytes`)
  }
  if (authTag.length !== AUTH_TAG_BYTE_LENGTH) {
    throw new Error(`Malformed ciphertext: auth tag must be ${AUTH_TAG_BYTE_LENGTH} bytes`)
  }
  return { iv, authTag, data: Buffer.from(dataB64, 'base64') }
}

function decryptWithKey(key: Buffer, iv: Buffer, authTag: Buffer, data: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTE_LENGTH })
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/**
 * Decrypts a string produced by `encryptField` (current `v1:` format or the
 * legacy unprefixed one), trying `keyNames.currentKeyEnvVar` and then
 * `keyNames.previousKeyEnvVar`. Throws if the format is malformed (including
 * a tag that isn't 16 bytes) or if no configured key verifies the GCM tag
 * (tampering, or a key that has been rotated out).
 *
 * For the PAYMENT_FIELD_KEY domain: this was write-only until 2026-09-26
 * (design doc Section 2.3: "a decrypt path with no consumer is pure attack
 * surface") — still the right default. The one deliberate, audited exception
 * is `lib/actions/organizer-admin.ts#getOrganizerBankDetails`, which staff
 * use to set an organizer up as a payout beneficiary in the real gateway
 * (explicit user instruction); every call logs an
 * `ORGANIZER_BANK_DETAILS_REVEALED` admin_actions row before returning the
 * plaintext, and it is STAFF-role-gated. Do NOT add another payment decrypt
 * call site without the same audit-logging discipline and a reason to
 * believe this one doesn't already cover it. lib/actions/staff-mfa.ts's
 * TOTP_KEY_NAMES domain is unrelated: decrypting the TOTP secret on every
 * code check is the whole point, and is its own legitimate caller.
 */
export function decryptField(ciphertext: string, keyNames: FieldEncryptionKeyNames = PAYMENT_KEY_NAMES): string {
  const { iv, authTag, data } = parseCiphertext(ciphertext)

  let lastError: unknown
  for (const key of getDecryptionKeys(keyNames)) {
    try {
      return decryptWithKey(key, iv, authTag, data)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to decrypt field')
}
