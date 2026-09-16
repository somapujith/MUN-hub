import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { changePassword, signIn, signOut, signUp } from './auth'

const DEFAULT_TEST_PASSWORD = 'test-password-123'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN', password: string | null = DEFAULT_TEST_PASSWORD) {
  const email = `signin-${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`
  const passwordHash = password ? await hashPassword(password) : undefined
  const [user] = await db.insert(users).values({ name: `Test ${role}`, email, role, passwordHash }).returning()
  return user
}

describe('signUp', () => {
  it('creates a STUDENT-role user, returns a valid session, and a matching sessions row exists', async () => {
    const email = `signup-${Date.now()}-${Math.random()}@test.com`

    const result = await signUp('New Student', email, 'a-good-password')

    expect(result.role).toBe('STUDENT')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.expiresAt).toBeInstanceOf(Date)

    const rows = await db.select().from(sessions).where(eq(sessions.token, result.token))
    expect(rows.length).toBe(1)
    expect(rows[0].userId).toBe(result.userId)
  })

  it('rejects a duplicate email with "An account with that email already exists"', async () => {
    const existing = await makeUser('STUDENT')

    await expect(signUp('Another Name', existing.email, 'a-good-password')).rejects.toThrow(
      'An account with that email already exists',
    )
  })

  it('rejects a password shorter than 8 characters', async () => {
    const email = `signup-shortpw-${Date.now()}-${Math.random()}@test.com`

    await expect(signUp('Short Password', email, 'short')).rejects.toThrow(
      'Password must be at least 8 characters',
    )
  })

  it('rejects a blank/whitespace-only name', async () => {
    const email = `signup-blankname-${Date.now()}-${Math.random()}@test.com`

    await expect(signUp('   ', email, 'a-good-password')).rejects.toThrow('Name is required')
  })
})

describe('signIn', () => {
  it('succeeds with the correct password, returns a valid session, and a new sessions row exists', async () => {
    const email = `signin-ok-${Date.now()}-${Math.random()}@test.com`
    const { userId } = await signUp('Sign In User', email, 'a-good-password')

    const result = await signIn(email, 'a-good-password')

    expect(result.userId).toBe(userId)
    expect(result.role).toBe('STUDENT')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.expiresAt).toBeInstanceOf(Date)

    const rows = await db.select().from(sessions).where(eq(sessions.token, result.token))
    expect(rows.length).toBe(1)
    expect(rows[0].userId).toBe(userId)
  })

  it('rejects an unknown email with "Invalid email or password"', async () => {
    await expect(signIn(`nobody-${Date.now()}@test.com`, 'whatever')).rejects.toThrow(
      'Invalid email or password',
    )
  })

  it('rejects a wrong password for a known email with the same "Invalid email or password" message', async () => {
    const user = await makeUser('STUDENT')

    await expect(signIn(user.email, 'totally-wrong-password')).rejects.toThrow(
      'Invalid email or password',
    )
  })

  it('rejects sign-in for a user with no passwordHash set, without crashing', async () => {
    const user = await makeUser('STUDENT', null)

    await expect(signIn(user.email, 'anything')).rejects.toThrow('Invalid email or password')
  })

  it('rejects a suspended user with "Account suspended" and creates no session row', async () => {
    const email = `signin-suspended-${Date.now()}-${Math.random()}@test.com`
    const passwordHash = await hashPassword(DEFAULT_TEST_PASSWORD)
    const [user] = await db
      .insert(users)
      .values({ name: 'Suspended User', email, role: 'ORGANIZER', passwordHash, suspended: true })
      .returning()

    await expect(signIn(user.email, DEFAULT_TEST_PASSWORD)).rejects.toThrow('Account suspended')

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows.length).toBe(0)
  })
})

describe('signOut', () => {
  it('destroys the session for the given token', async () => {
    const user = await makeUser('ADMIN')
    const { token } = await signIn(user.email, DEFAULT_TEST_PASSWORD)

    await signOut(token)

    const rows = await db.select().from(sessions).where(eq(sessions.token, token))
    expect(rows.length).toBe(0)
  })

  it('is a no-op when given an empty token', async () => {
    await expect(signOut('')).resolves.toBeUndefined()
  })

  it('is a no-op when given a token that does not exist', async () => {
    await expect(signOut('this-token-does-not-exist')).resolves.toBeUndefined()
  })
})

describe('changePassword', () => {
  it('succeeds with the correct current password: signs in with the new one, and the old one no longer works', async () => {
    const user = await makeUser('STUDENT', 'old-password-123')

    await changePassword('old-password-123', 'new-password-456', { userId: user.id, role: user.role })

    await expect(signIn(user.email, 'new-password-456')).resolves.toMatchObject({ userId: user.id })
    await expect(signIn(user.email, 'old-password-123')).rejects.toThrow('Invalid email or password')
  })

  it('rejects a wrong current password with "Current password is incorrect" and leaves the password unchanged', async () => {
    const user = await makeUser('STUDENT', 'correct-password-1')

    await expect(
      changePassword('totally-wrong-password', 'new-password-456', { userId: user.id, role: user.role }),
    ).rejects.toThrow('Current password is incorrect')

    await expect(signIn(user.email, 'correct-password-1')).resolves.toMatchObject({ userId: user.id })
  })

  it('rejects a too-short new password with "Password must be at least 8 characters"', async () => {
    const user = await makeUser('STUDENT', 'correct-password-1')

    await expect(
      changePassword('correct-password-1', 'short', { userId: user.id, role: user.role }),
    ).rejects.toThrow('Password must be at least 8 characters')
  })

  it('rejects for a user with no password set with "Current password is incorrect", without crashing', async () => {
    const user = await makeUser('STUDENT', null)

    await expect(
      changePassword('anything', 'new-password-456', { userId: user.id, role: user.role }),
    ).rejects.toThrow('Current password is incorrect')
  })
})

afterAll(async () => {
  await db.$client.end()
})
