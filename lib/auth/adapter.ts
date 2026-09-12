import type { Role } from '@/lib/db/schema-enums'

export interface Session {
  userId: string
  role: Role
}

/**
 * Auth provider interface. Mock implementation now; a real provider
 * (Supabase Auth or other, TBD) implements this same interface later
 * without touching call sites.
 */
export interface AuthAdapter {
  signIn(email: string, password: string): Promise<Session>
  signOut(sessionToken: string): Promise<void>
  getCurrentUserId(sessionToken: string): Promise<string | null>
}
