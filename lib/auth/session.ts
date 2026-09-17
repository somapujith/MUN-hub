import { and, eq, gt, lt, ne } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token'
import type { Session } from './adapter'

export const SESSION_COOKIE_NAME = 'mun_hub_session'

/**
 * Session lifetime, without a schema change:
 *
 * - Idle expiry: `sessions.expiresAt` is a sliding deadline, set to "now +
 *   SESSION_IDLE_TIMEOUT_MS" at creation and pushed forward as the session is
 *   used. A session nobody uses for 7 days dies.
 * - Absolute cap: however active, no session outlives
 *   SESSION_MAX_LIFETIME_MS from `sessions.createdAt`; the sliding deadline
 *   never moves past that point and lookups reject anything older.
 * - The deadline is extended at most once per SESSION_EXTEND_INTERVAL_MS, so
 *   an active session costs one UPDATE an hour rather than one per request.
 *
 * The cookie itself is given the absolute cap as its lifetime
 * (server/routes/auth.ts); the server-side deadline is what actually decides.
 */
export const SESSION_IDLE_TIMEOUT_MS = 1000 * 60 * 60 * 24 * 7 // 7 days
export const SESSION_MAX_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
export const SESSION_EXTEND_INTERVAL_MS = 1000 * 60 * 60 // 1 hour

/** The sliding deadline for a session created at `createdAt`, as of `now`. */
export function slidingSessionExpiry(createdAt: Date, now: Date): Date {
  return new Date(Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, createdAt.getTime() + SESSION_MAX_LIFETIME_MS))
}

/**
 * Looks up a session TOKEN (never a raw userId) in the `sessions` table
 * joined to `users`, and returns the actor's identity — or null if there's
 * no valid, unexpired session, or if the user has been suspended (a
 * suspended user's existing session tokens are rejected immediately, not
 * just blocked at future sign-in).
 *
 * Tokens are stored hashed (lib/auth/opaque-token.ts): the presented token is
 * hashed and the digest is what gets looked up. Rows written before hashing
 * was introduced hold the raw token and so match nothing — those sessions
 * simply ended (users sign in again) and the rows age out at their old
 * `expiresAt`.
 *
 * A successful lookup may extend the session's sliding deadline (see the
 * constants above).
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

  const now = new Date()
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      role: users.role,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
      suspended: users.suspended,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.token, hashOpaqueToken(token)),
        gt(sessions.expiresAt, now),
        gt(sessions.createdAt, new Date(now.getTime() - SESSION_MAX_LIFETIME_MS)),
      ),
    )
    .limit(1)

  if (!row || row.suspended) return null

  const nextExpiry = slidingSessionExpiry(row.createdAt, now)
  if (nextExpiry.getTime() - row.expiresAt.getTime() >= SESSION_EXTEND_INTERVAL_MS) {
    try {
      // Conditional so two concurrent requests can't move the deadline backwards.
      await db
        .update(sessions)
        .set({ expiresAt: nextExpiry })
        .where(and(eq(sessions.id, row.sessionId), lt(sessions.expiresAt, nextExpiry)))
    } catch (error) {
      // The session is valid either way; a failed extension only means it
      // idles out sooner. Never fail the request over it.
      console.error('[session] could not extend session expiry', { error })
    }
  }

  return { userId: row.userId, role: row.role }
}

/** Creates a new session row for a user and returns the raw token (stored only as its hash) + idle deadline. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken()
  const now = new Date()
  const expiresAt = slidingSessionExpiry(now, now)

  await db.insert(sessions).values({ userId, token: hashOpaqueToken(token), expiresAt, createdAt: now })

  return { token, expiresAt }
}

/** Invalidates a session by token (sign-out). Idempotent — no-op if already gone. */
export async function destroySession(token: string): Promise<void> {
  if (!token) return
  await db.delete(sessions).where(eq(sessions.token, hashOpaqueToken(token)))
}

/**
 * The `sessions` rows belonging to `userId` other than the one `keepToken`
 * identifies — for "sign out everywhere else" deletes, e.g.
 * `tx.delete(sessions).where(otherSessionsOf(userId, token))`.
 */
export function otherSessionsOf(userId: string, keepToken: string) {
  return and(eq(sessions.userId, userId), ne(sessions.token, hashOpaqueToken(keepToken)))
}
