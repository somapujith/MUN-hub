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
// is worse than a crash. This is validated and decoded ONCE, cached, and
// reused (see getEncryptionKey below) so a misconfigured deployment fails
// loudly on first real use rather than silently encrypting with a bad key.
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
// Hyperdrive-bridge solves. Local Node dev/tests are unaffected: this still
// runs the exact same synchronous, cached logic, just on first use rather
// than on import, reading real `process.env.PAYMENT_FIELD_KEY` there.

const KEY_BYTE_LENGTH = 32
const IV_BYTE_LENGTH = 12
const SEPARATOR = ':'

function loadKey(): Buffer {
  const raw = getRuntimeEnv('PAYMENT_FIELD_KEY')
  if (!raw) {
    throw new Error('PAYMENT_FIELD_KEY environment variable is not set — refusing to start without a field-encryption key')
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new Error(
      `PAYMENT_FIELD_KEY must decode to exactly ${KEY_BYTE_LENGTH} bytes (base64-encoded); got ${key.length} bytes`,
    )
  }

  return key
}

let cachedKey: Buffer | undefined

function getEncryptionKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey()
  return cachedKey
}

/**
 * Encrypts `plaintext` with AES-256-GCM using a fresh random 12-byte IV.
 * Output is `base64(iv):base64(authTag):base64(ciphertext)` as one string.
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(SEPARATOR)
}

/**
 * Decrypts a string produced by `encryptField`. Throws if the format is
 * malformed or if the GCM auth tag doesn't verify (tampering).
 *
 * NOTHING IN THIS CODEBASE CALLS THIS FUNCTION YET. It is exported and
 * tested (round-trip + tamper detection) so the encryption format is proven
 * correct ahead of a future settlement-integration slice, but there is
 * deliberately no read path anywhere that decrypts payment ciphertext back
 * to plaintext (design doc Section 2.3: "a decrypt path with no consumer is
 * pure attack surface"). Do NOT delete this as dead code, and do NOT wire it
 * into any action or query without a dedicated threat review first.
 */
export function decryptField(ciphertext: string): string {
  const parts = ciphertext.split(SEPARATOR)
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext: expected iv:authTag:ciphertext')
  }
  const [ivB64, authTagB64, dataB64] = parts

  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
  return plaintext.toString('utf8')
}
