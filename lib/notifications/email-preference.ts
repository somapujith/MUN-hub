import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

/**
 * Whether `userId` wants to receive optional (non-transactional) email —
 * `users.emailNotificationsEnabled`, defaulting to `true` for safety if the
 * row is somehow missing (never silently suppress a real user's email over
 * a lookup gap). Used to gate the delegate-facing "optional" emails
 * (registration confirmed, payment failed, seat hold expired, support
 * reply, welcome) — NOT used for OTP, password reset, or any other email
 * whose delivery the user can't opt out of.
 */
export async function isEmailNotificationsEnabled(userId: string): Promise<boolean> {
  const [row] = await db.select({ enabled: users.emailNotificationsEnabled }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.enabled ?? true
}
