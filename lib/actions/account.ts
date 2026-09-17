import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'

export interface AccountSettings {
  name: string
  email: string
  phone: string | null
  institution: string | null
  emailNotificationsEnabled: boolean
}

/** Reads the signed-in user's account-level info + preferences. */
export async function getAccountSettings(session: Session): Promise<AccountSettings> {
  const [user] = await db
    .select({
      name: users.name,
      email: users.email,
      phone: users.phone,
      institution: users.institution,
      emailNotificationsEnabled: users.emailNotificationsEnabled,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!user) {
    throw new Error('Account not found')
  }

  return user
}

/**
 * Sets the signed-in user's email-notifications preference. A single boolean
 * column, not a generic preferences system — see the column's comment in
 * lib/db/schema.ts for why.
 */
export async function setEmailNotificationsEnabled(enabled: boolean, session: Session): Promise<void> {
  await db.update(users).set({ emailNotificationsEnabled: enabled }).where(eq(users.id, session.userId))
}
