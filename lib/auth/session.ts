import crypto from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import type { Session } from './adapter'

export const SESSION_COOKIE_NAME = 'mun_hub_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

/**
 * Looks up a session TOKEN (never a raw userId) in the `sessions` table
 * joined to `users`, and returns the actor's identity — or null if there's
 * no valid, unexpired session, or if the user has been suspended (a
 * suspended user's existing session tokens are rejected immediately, not
 * just blocked at future sign-in).
 *
 * The caller (HTTP-layer middleware) is responsible for reading the token
 * out of the `mun_hub_session` cookie — this function has no ambient
 * request context and never reads cookies itself.
 *
 * Every server action that reads/writes a specific user's data MUST derive
 * the actor from a session resolved this way, never from a client-supplied
 * parameter.
 */
export async function getSessionByToken(token: string): Promise<Session | null> {
  if (!token) return null

  const [row] = await db
    .select({
      userId: users.id,
      role: users.role,
      expiresAt: sessions.expiresAt,
      suspended: users.suspended,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1)

  if (!row || row.suspended) return null

  return { userId: row.userId, role: row.role }
}

/** Creates a new session row for a user and returns the raw token + expiry. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(sessions).values({ userId, token, expiresAt })

  return { token, expiresAt }
}

/** Invalidates a session by token (sign-out). Idempotent — no-op if already gone. */
export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token))
}
