import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import type { AuthAdapter, Session } from './adapter'
import { hashOpaqueToken } from './opaque-token'
import { createSession, destroySession } from './session'
import { verifyPassword } from './password'

/**
 * Mock auth adapter — local dev/demo implementation of `AuthAdapter`. A real
 * adapter (provider TBD) implements the same interface later; call sites
 * never change. Verifies the password against `users.passwordHash` (see
 * `lib/actions/auth.ts` for the actual call path this app uses today — this
 * adapter object exists to satisfy the interface but isn't wired into any
 * route yet) rather than skipping the check, so it can't regress into a
 * passwordless bypass sitting unused next to the real check.
 */
export const mockAuthAdapter: AuthAdapter = {
  async signIn(email: string, password: string): Promise<{ session: Session; token: string; expiresAt: Date }> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new Error('Invalid credentials')
    }

    const { token, expiresAt } = await createSession(user.id)

    return { session: { userId: user.id, role: user.role }, token, expiresAt }
  },

  async signOut(sessionToken: string): Promise<void> {
    await destroySession(sessionToken)
  },

  async getCurrentUserId(sessionToken: string): Promise<string | null> {
    const [row] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.token, hashOpaqueToken(sessionToken)))
      .limit(1)

    return row?.userId ?? null
  },
}

export { createSession }
