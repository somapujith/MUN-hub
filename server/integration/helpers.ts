import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

export async function makeUser(role: 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

export async function authHeaders(userId: string): Promise<Record<string, string>> {
  const { token } = await createSession(userId)
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
}
