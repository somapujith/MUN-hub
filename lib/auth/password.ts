import crypto from 'node:crypto'

// scrypt, not bcrypt/argon2 — no new dependency needed (Node's built-in
// crypto is already used for session tokens in lib/auth/session.ts) and it
// has no native binding to compile on any platform.
const KEY_LENGTH = 64

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

/** Hashes a plaintext password into a `salt:hash` string safe to store in `users.passwordHash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = await scryptAsync(password, salt)
  return `${salt}:${derivedKey.toString('hex')}`
}

/**
 * Verifies a plaintext password against a stored `salt:hash` string.
 * Uses a timing-safe comparison so response time doesn't leak how close a
 * guess was.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false

  const derivedKey = await scryptAsync(password, salt)
  const storedKey = Buffer.from(hashHex, 'hex')
  if (storedKey.length !== derivedKey.length) return false

  return crypto.timingSafeEqual(derivedKey, storedKey)
}
