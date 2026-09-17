import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { isEmailNotificationsEnabled } from './email-preference'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

/**
 * Welcome email — sent once, right after a new account is created (self-serve
 * student signup, or an organizer/admin account provisioned some other way).
 * Optional per `users.emailNotificationsEnabled`, same as the other delegate
 * emails in this directory. Throws if `userId` doesn't resolve to a real row
 * — a caller invoking this right after its own insert has a real bug if that
 * lookup fails, not something to silently skip.
 */
export async function notifyWelcome(userId: string, adapter: NotificationsAdapter = getNotificationsAdapter()): Promise<void> {
  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('User not found')

  if (!(await isEmailNotificationsEnabled(userId))) return

  try {
    await adapter.send({
      to: user.email,
      subject: 'Welcome to MUN Hub',
      body:
        `Hi ${user.name},\n\n` +
        `Welcome to MUN Hub! Browse conferences, register for committees, and manage your delegate profile all in one place.\n\n` +
        `Glad to have you here.`,
    })
  } catch (error) {
    console.error('[welcome-email] delivery failed', { userId, error })
  }
}
