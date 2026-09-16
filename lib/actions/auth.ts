import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { createSession, destroySession } from '@/lib/auth/session'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'

const MIN_PASSWORD_LENGTH = 8

/**
 * Real password sign-in (replaces the old email-only mock). Looks up the
 * user by email and verifies `password` against `users.passwordHash` with a
 * timing-safe scrypt comparison (`lib/auth/password.ts`).
 *
 * Throws the same generic `Error('Invalid email or password')` whether the
 * email doesn't exist or the password is wrong — and also when the account
 * predates real signup and has no `passwordHash` at all — so a caller can
 * never use response differences to enumerate valid emails.
 *
 * Throws `Error('Account suspended')` if the matched user is suspended.
 *
 * Creates a session row via `createSession` and returns the raw token +
 * expiry. Does NOT touch cookies — the caller (an HTTP-layer route handler)
 * is responsible for setting the session cookie using the returned
 * `token`/`expiresAt`.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)

  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error('Invalid email or password')
  }

  if (user.suspended) {
    throw new Error('Account suspended')
  }

  const { token, expiresAt } = await createSession(user.id)

  return { userId: user.id, role: user.role, token, expiresAt }
}

/**
 * Creates a new STUDENT account with a hashed password and signs them in
 * immediately (same return shape as `signIn`, same cookie-setting
 * responsibility left to the caller).
 *
 * Self-serve signup only ever creates STUDENT accounts — organizer accounts
 * are provisioned through the separate organizer-application flow
 * (`lib/actions/organizer-application.ts`), not this path.
 *
 * Throws `Error('An account with that email already exists')` on a
 * duplicate email, and `Error('Password must be at least 8 characters')` for
 * a too-short password.
 */
export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<{ userId: string; role: Role; token: string; expiresAt: Date }> {
  const trimmedName = name.trim()
  const normalizedEmail = email.trim().toLowerCase()

  if (!trimmedName) {
    throw new Error('Name is required')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
  if (existing) {
    throw new Error('An account with that email already exists')
  }

  const passwordHash = await hashPassword(password)
  const [user] = await db
    .insert(users)
    .values({ name: trimmedName, email: normalizedEmail, passwordHash, role: 'STUDENT' })
    .returning()

  const { token, expiresAt } = await createSession(user.id)

  return { userId: user.id, role: user.role, token, expiresAt }
}

/**
 * Changes the signed-in user's password. Requires the current password
 * (re-verified here, not trusted from the client) — this is the in-app
 * "change password while logged in" path, separate from the signed-out
 * "forgot password" recovery flow in `lib/actions/password-reset.ts`.
 *
 * Throws `Error('Current password is incorrect')` if `currentPassword`
 * doesn't match (including the edge case of an account with no password
 * hash at all — same message either way, no information leak).
 * Throws `Error('Password must be at least 8 characters')` for a too-short
 * `newPassword`.
 *
 * Deliberately does NOT invalidate other sessions — the user is actively
 * signed in and choosing this themselves, unlike a reset-token recovery
 * (which does invalidate everything, since that path implies the old
 * credential may be compromised).
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  session: Session,
): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error('Current password is incorrect')
  }

  const passwordHash = await hashPassword(newPassword)
  await db.update(users).set({ passwordHash }).where(eq(users.id, session.userId))
}

/**
 * Invalidates a session by its token via `destroySession` (idempotent —
 * no-op if the token is empty/missing or the session is already gone).
 * Does NOT touch cookies — the caller is responsible for reading the
 * token out of the request and clearing the cookie itself.
 */
export async function signOut(token: string): Promise<void> {
  if (token) {
    await destroySession(token)
  }
}
