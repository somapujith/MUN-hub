import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { createSession, destroySession } from '@/lib/auth/session'
import type { Role } from '@/lib/db/schema-enums'

/**
 * MVP mock "sign in": no password check, just look up a seeded user by
 * email. Throws `Error('User not found')` if the email doesn't match a
 * seeded user — this is a dev/demo mock, not real auth, so there is no
 * separate "invalid credentials" case to hide a valid email behind.
 * Throws `Error('Account suspended')` if the matched user is suspended.
 *
 * Creates a session row via `createSession` and returns the raw token +
 * expiry. Does NOT touch cookies — the caller (an HTTP-layer route
 * handler) is responsible for setting the session cookie using the
 * returned `token`/`expiresAt`.
 */
export async function signIn(
  email: string
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user) {
    throw new Error('User not found')
  }

  if (user.suspended) {
    throw new Error('Account suspended')
  }

  const { token, expiresAt } = await createSession(user.id)

  return { userId: user.id, role: user.role, token, expiresAt }
}

/**
 * Invalidates a session by its token via `destroySession` (idempotent —
 * no-op if the token is empty/missing or the session is already gone).
 * Does NOT touch cookies — the caller is responsible for reading the
 * token out of the request and clearing the cookie itself.
 */
export async function signOut(token: string): Promise<void> {
  if (token) {
    await destroySession(token)
  }
}
