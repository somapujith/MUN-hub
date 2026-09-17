import crypto from 'node:crypto'

// Opaque bearer tokens (session cookies, password-reset links) are stored at
// rest only as a SHA-256 digest of the value handed to the client. A leaked
// `sessions` / `password_reset_tokens` table therefore can't be replayed:
// presenting a stored digest hashes it again, which matches nothing.
//
// A plain (unsalted, fast) hash is enough here — unlike passwords, these
// tokens carry 256 bits of randomness, so there is nothing to brute-force,
// and the digest must be deterministic so the presented token can be looked
// up by it.

/** A fresh 256-bit random token, hex-encoded. Hand this to the client; store only `hashOpaqueToken(token)`. */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** The at-rest form of an opaque token: lowercase hex SHA-256 of its UTF-8 bytes. */
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}
