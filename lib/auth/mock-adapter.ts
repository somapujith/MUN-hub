import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import type { AuthAdapter, Session } from './adapter'
import { createSession, destroySession } from './session'

/**
 * Mock auth adapter — email-only "sign in" (no password check) for local
 * dev/demo. A real adapter (Supabase Auth or other, TBD) implements the
 * same `AuthAdapter` interface later; call sites never change.
 */
export const mockAuthAdapter: AuthAdapter = {
  async signIn(email: string): Promise<{ session: Session; token: string; expiresAt: Date }> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!user) {
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
      .where(eq(sessions.token, sessionToken))
      .limit(1)

    return row?.userId ?? null
  },
}

export { createSession }
