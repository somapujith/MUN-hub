'use server'

import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME, createSession, destroySession } from '@/lib/auth/session'
import type { Role } from '@/lib/db/schema-enums'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days, matches session.ts SESSION_TTL_MS

/**
 * MVP mock "sign in": no password check, just look up a seeded user by
 * email. Throws `Error('User not found')` if the email doesn't match a
 * seeded user — this is a dev/demo mock, not real auth, so there is no
 * separate "invalid credentials" case to hide a valid email behind.
 * Throws `Error('Account suspended')` if the matched user is suspended.
 *
 * Creates a session row via `createSession`, sets it as an httpOnly
 * `mun_hub_session` cookie, and returns the session info.
 */
export async function signIn(email: string): Promise<{ userId: string; role: Role }> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user) {
    throw new Error('User not found')
  }

  if (user.suspended) {
    throw new Error('Account suspended')
  }

  const { token, expiresAt } = await createSession(user.id)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    expires: expiresAt,
  })

  return { userId: user.id, role: user.role }
}

/**
 * Reads the current `mun_hub_session` cookie token, invalidates the
 * corresponding session row via `destroySession` (idempotent — no-op if
 * there's no cookie or the session is already gone), and clears the cookie.
 */
export async function signOut(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (token) {
    await destroySession(token)
  }

  cookieStore.delete(SESSION_COOKIE_NAME)
}
