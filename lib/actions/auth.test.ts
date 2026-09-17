import crypto from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, studentProfiles, userConsents, userMfa, users } from '@/lib/db/schema'
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password'
import { hashOpaqueToken } from '@/lib/auth/opaque-token'
import { createSession, getSessionByToken } from '@/lib/auth/session'
import { GUARDIAN_CONSENT_REQUIRED, changePassword, isUnderAdultAge, signIn, signOut, signUp } from './auth'
import type { SignUpInput } from './auth'

// Real implementation, wrapped so tests can see which hash sign-in checked against.
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})

function sessionRowsFor(token: string) {
  return db.select().from(sessions).where(eq(sessions.token, hashOpaqueToken(token)))
}

/** A hash in the pre-2026-09-17 `salt:hash` format. */
function legacyHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}

/** `YYYY-MM-DD` for the date `years` years (and `days` days) before today, UTC. */
function birthDate(years: number, days = 0): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - days))
  return date.toISOString().slice(0, 10)
}

const DEFAULT_TEST_PASSWORD = 'test-password-123'

/**
 * Every field `signUp` requires (PRD §9-16), so individual tests only have
 * to spell out the one field they're actually exercising.
 */
function signUpInput(overrides: Partial<SignUpInput> = {}): SignUpInput {
  return {
    name: 'New Student',
    email: `signup-${Date.now()}-${Math.random()}@test.com`,
    password: 'a-good-password',
    gender: 'Prefer not to say',
    phone: '9990001111',
    institution: 'Test University',
    dateOfBirth: '2006-04-01',
    gradeOrYear: '2nd year',
    residentialAddress: '1 Test Street, Test City',
    emergencyContactName: 'Test Guardian',
    emergencyContactPhone: '9990002222',
    emergencyContactRelation: 'Parent',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
    ...overrides,
  }
}

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN', password: string | null = DEFAULT_TEST_PASSWORD) {
  const email = `signin-${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`
  const passwordHash = password ? await hashPassword(password) : undefined
  const [user] = await db.insert(users).values({ name: `Test ${role}`, email, role, passwordHash }).returning()
  return user
}

describe('signUp', () => {
  it('creates a STUDENT-role user, returns a valid session, and a matching sessions row exists', async () => {
    const result = await signUp(signUpInput())

    expect(result.role).toBe('STUDENT')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.expiresAt).toBeInstanceOf(Date)

    const rows = await sessionRowsFor(result.token)
    expect(rows.length).toBe(1)
    expect(rows[0].userId).toBe(result.userId)
  })

  it('creates the student_profiles row and required consent rows in the same transaction', async () => {
    const { userId } = await signUp(
      signUpInput({ gender: 'Female', previousAchievements: 'Best Delegate, 2025' }),
    )

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
    expect(profile).toBeDefined()
    expect(profile.gender).toBe('Female')
    expect(profile.previousAchievements).toBe('Best Delegate, 2025')
    // Opt-in only (PRD §14) — never defaults to visible.
    expect(profile.isPublicProfileVisible).toBe(false)

    const consents = await db.select().from(userConsents).where(eq(userConsents.userId, userId))
    expect(consents.map((row) => row.consentType).sort()).toEqual([
      'PRIVACY_POLICY',
      'TERMS_OF_SERVICE',
    ])
    expect(consents.every((row) => row.policyVersion.length > 0)).toBe(true)
  })

  it('sets phone/institution on the user row so isProfileComplete passes immediately', async () => {
    const { userId } = await signUp(signUpInput({ phone: '9876543210', institution: 'KLH University' }))

    const [user] = await db
      .select({ phone: users.phone, institution: users.institution })
      .from(users)
      .where(eq(users.id, userId))
    expect(user.phone).toBe('9876543210')
    expect(user.institution).toBe('KLH University')
  })

  it('records a guardian acknowledgement only when it was actually given', async () => {
    const withAck = await signUp(signUpInput({ acceptedGuardianAcknowledgement: true }))
    const withoutAck = await signUp(signUpInput({ acceptedGuardianAcknowledgement: false }))

    const ackRows = await db.select().from(userConsents).where(eq(userConsents.userId, withAck.userId))
    expect(ackRows.some((row) => row.consentType === 'GUARDIAN_ACKNOWLEDGEMENT')).toBe(true)

    const noAckRows = await db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, withoutAck.userId))
    expect(noAckRows.some((row) => row.consentType === 'GUARDIAN_ACKNOWLEDGEMENT')).toBe(false)
  })

  it('rejects an under-18 signup without the guardian acknowledgement, creating no user', async () => {
    const email = `signup-minor-${Date.now()}-${Math.random()}@test.com`

    for (const acceptedGuardianAcknowledgement of [undefined, false]) {
      await expect(
        signUp(signUpInput({ email, dateOfBirth: birthDate(15), acceptedGuardianAcknowledgement })),
      ).rejects.toThrow(GUARDIAN_CONSENT_REQUIRED)
    }

    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    expect(rows.length).toBe(0)
  })

  it('accepts an under-18 signup with the guardian acknowledgement and records it', async () => {
    const { userId } = await signUp(
      signUpInput({ dateOfBirth: birthDate(17, 364), acceptedGuardianAcknowledgement: true }),
    )

    const consents = await db.select().from(userConsents).where(eq(userConsents.userId, userId))
    expect(consents.some((row) => row.consentType === 'GUARDIAN_ACKNOWLEDGEMENT')).toBe(true)
  })

  it('does not require the guardian acknowledgement from someone turning 18 today', async () => {
    await expect(signUp(signUpInput({ dateOfBirth: birthDate(18) }))).resolves.toMatchObject({ role: 'STUDENT' })
  })

  it('rejects a duplicate email with "An account with that email already exists"', async () => {
    const existing = await makeUser('STUDENT')

    await expect(signUp(signUpInput({ email: existing.email }))).rejects.toThrow(
      'An account with that email already exists',
    )
  })

  it('rejects a password shorter than 8 characters', async () => {
    await expect(signUp(signUpInput({ password: 'short' }))).rejects.toThrow(
      'Password must be at least 8 characters',
    )
  })

  it('rejects a blank/whitespace-only name', async () => {
    await expect(signUp(signUpInput({ name: '   ' }))).rejects.toThrow('Name is required')
  })

  it('rejects missing consent, and creates no user at all when it does', async () => {
    const email = `signup-noconsent-${Date.now()}-${Math.random()}@test.com`

    await expect(signUp(signUpInput({ email, acceptedTermsOfService: false }))).rejects.toThrow(
      'You must accept the Terms of Service',
    )
    await expect(signUp(signUpInput({ email, acceptedPrivacyPolicy: false }))).rejects.toThrow(
      'You must accept the Privacy Policy',
    )

    // PRD §16: no misleading half-created account left behind.
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    expect(rows.length).toBe(0)
  })

  it('rejects a missing required profile field (gender) without creating a user', async () => {
    const email = `signup-nogender-${Date.now()}-${Math.random()}@test.com`

    await expect(signUp(signUpInput({ email, gender: '' }))).rejects.toThrow('Gender is required')

    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    expect(rows.length).toBe(0)
  })
})

describe('signIn', () => {
  it('succeeds with the correct password, returns a valid session, and a new sessions row exists', async () => {
    const email = `signin-ok-${Date.now()}-${Math.random()}@test.com`
    const { userId } = await signUp(signUpInput({ name: 'Sign In User', email }))

    const result = await signIn(email, 'a-good-password')
    if (result.status !== 'SIGNED_IN') throw new Error('expected SIGNED_IN')

    expect(result.userId).toBe(userId)
    expect(result.role).toBe('STUDENT')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.expiresAt).toBeInstanceOf(Date)

    const rows = await sessionRowsFor(result.token)
    expect(rows.length).toBe(1)
    expect(rows[0].userId).toBe(userId)
  })

  it('rejects an unknown email with "Invalid email or password"', async () => {
    await expect(signIn(`nobody-${Date.now()}@test.com`, 'whatever')).rejects.toThrow(
      'Invalid email or password',
    )
  })

  it('still runs a full scrypt verification for an unknown email (against the dummy hash)', async () => {
    vi.mocked(verifyPassword).mockClear()

    await expect(signIn(`nobody-${Date.now()}@test.com`, 'whatever')).rejects.toThrow('Invalid email or password')

    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledWith('whatever', DUMMY_PASSWORD_HASH)
  })

  it('upgrades a legacy password hash on successful sign-in, and the password keeps working', async () => {
    const email = `signin-legacy-${Date.now()}-${Math.random()}@test.com`
    const oldHash = legacyHash('legacy-password-1')
    const [user] = await db
      .insert(users)
      .values({ name: 'Legacy User', email, role: 'STUDENT', passwordHash: oldHash })
      .returning()

    await expect(signIn(email, 'legacy-password-1')).resolves.toMatchObject({ userId: user.id })

    const [after] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id))
    expect(after.passwordHash).not.toBe(oldHash)
    expect(after.passwordHash).toMatch(/^scrypt\$/)
    expect(needsRehash(after.passwordHash!)).toBe(false)
    await expect(signIn(email, 'legacy-password-1')).resolves.toMatchObject({ userId: user.id })
  })

  it('leaves a legacy hash alone when the password is wrong', async () => {
    const email = `signin-legacy-wrong-${Date.now()}-${Math.random()}@test.com`
    const oldHash = legacyHash('legacy-password-2')
    const [user] = await db
      .insert(users)
      .values({ name: 'Legacy User', email, role: 'STUDENT', passwordHash: oldHash })
      .returning()

    await expect(signIn(email, 'wrong-password')).rejects.toThrow('Invalid email or password')

    const [after] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id))
    expect(after.passwordHash).toBe(oldHash)
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

  it('a staff account with no confirmed MFA still signs in directly, unaffected by 2FA existing', async () => {
    const admin = await makeUser('ADMIN')

    const result = await signIn(admin.email, DEFAULT_TEST_PASSWORD)

    expect(result.status).toBe('SIGNED_IN')
  })

  it('a staff account with confirmed MFA gets MFA_REQUIRED instead of a session', async () => {
    const admin = await makeUser('ADMIN')
    await db.insert(userMfa).values({
      userId: admin.id,
      totpSecretCiphertext: 'v1:not-real:not-real:not-real',
      confirmedAt: new Date(),
    })

    const result = await signIn(admin.email, DEFAULT_TEST_PASSWORD)
    if (result.status !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED')

    expect(typeof result.pendingToken).toBe('string')
    expect(result.pendingToken.length).toBeGreaterThan(0)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const rows = await db.select().from(sessions).where(eq(sessions.userId, admin.id))
    expect(rows.length).toBe(0)
  })

  it('a non-staff account is never gated by MFA even with a (hypothetical) confirmed row', async () => {
    const student = await makeUser('STUDENT')
    await db.insert(userMfa).values({
      userId: student.id,
      totpSecretCiphertext: 'v1:not-real:not-real:not-real',
      confirmedAt: new Date(),
    })

    const result = await signIn(student.email, DEFAULT_TEST_PASSWORD)

    expect(result.status).toBe('SIGNED_IN')
  })
})

describe('signOut', () => {
  it('destroys the session for the given token', async () => {
    const user = await makeUser('ADMIN')
    const result = await signIn(user.email, DEFAULT_TEST_PASSWORD)
    if (result.status !== 'SIGNED_IN') throw new Error('expected SIGNED_IN')
    const { token } = result

    await signOut(token)

    const rows = await sessionRowsFor(token)
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
  /** A signed-in user plus the token of the session making the change. */
  async function signedInUser(password: string | null) {
    const user = await makeUser('STUDENT', password)
    const { token } = await createSession(user.id)
    return { user, token, session: { userId: user.id, role: user.role } }
  }

  it('succeeds with the correct current password: signs in with the new one, and the old one no longer works', async () => {
    const { user, token, session } = await signedInUser('old-password-123')

    await changePassword('old-password-123', 'new-password-456', session, token)

    await expect(signIn(user.email, 'new-password-456')).resolves.toMatchObject({ userId: user.id })
    await expect(signIn(user.email, 'old-password-123')).rejects.toThrow('Invalid email or password')
  })

  it("signs the user out everywhere else but keeps the caller's own session", async () => {
    const { user, token, session } = await signedInUser('old-password-123')
    const otherDevice = await createSession(user.id)
    const someoneElse = await makeUser('STUDENT')
    const unrelated = await createSession(someoneElse.id)

    await changePassword('old-password-123', 'new-password-456', session, token)

    expect(await getSessionByToken(token)).toEqual(session)
    expect(await getSessionByToken(otherDevice.token)).toBeNull()
    expect(await getSessionByToken(unrelated.token)).not.toBeNull()
  })

  it('rejects a wrong current password with "Current password is incorrect" and leaves the password and sessions unchanged', async () => {
    const { user, token, session } = await signedInUser('correct-password-1')
    const otherDevice = await createSession(user.id)

    await expect(changePassword('totally-wrong-password', 'new-password-456', session, token)).rejects.toThrow(
      'Current password is incorrect',
    )

    await expect(signIn(user.email, 'correct-password-1')).resolves.toMatchObject({ userId: user.id })
    expect(await getSessionByToken(otherDevice.token)).not.toBeNull()
  })

  it('rejects a too-short new password with "Password must be at least 8 characters"', async () => {
    const { token, session } = await signedInUser('correct-password-1')

    await expect(changePassword('correct-password-1', 'short', session, token)).rejects.toThrow(
      'Password must be at least 8 characters',
    )
  })

  it('rejects for a user with no password set with "Current password is incorrect", without crashing', async () => {
    const { token, session } = await signedInUser(null)

    await expect(changePassword('anything', 'new-password-456', session, token)).rejects.toThrow(
      'Current password is incorrect',
    )
  })
})

describe('isUnderAdultAge', () => {
  const now = new Date('2026-09-17T10:00:00Z')

  it('is true the day before the 18th birthday and false on it', () => {
    expect(isUnderAdultAge(new Date('2008-09-18'), now)).toBe(true)
    expect(isUnderAdultAge(new Date('2008-09-17'), now)).toBe(false)
    expect(isUnderAdultAge(new Date('1990-01-01'), now)).toBe(false)
  })

  it('treats a 29 February birthday as reaching 18 on 1 March', () => {
    const leapBaby = new Date('2008-02-29')
    expect(isUnderAdultAge(leapBaby, new Date('2026-02-28T23:59:59Z'))).toBe(true)
    expect(isUnderAdultAge(leapBaby, new Date('2026-03-01T00:00:00Z'))).toBe(false)
  })
})

afterAll(async () => {
  await db.$client.end()
})
