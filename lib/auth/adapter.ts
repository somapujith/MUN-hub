import type { Role } from '@/lib/db/schema-enums'

export interface Session {
  userId: string
  role: Role
}

/**
 * Auth provider interface. Mock implementation now; a real provider
 * (Supabase Auth or other, TBD) implements this same interface later
 * without touching call sites.
 *
 * `signIn` returns the raw token + expiry (not just the `Session`) because
 * the HTTP layer (a route handler / Hono middleware) needs them to set the
 * session cookie itself — cookie handling stays entirely out of this
 * interface, which is deliberately transport-agnostic.
 */
export interface AuthAdapter {
  signIn(email: string, password: string): Promise<{ session: Session; token: string; expiresAt: Date }>
  signOut(sessionToken: string): Promise<void>
  getCurrentUserId(sessionToken: string): Promise<string | null>
}
