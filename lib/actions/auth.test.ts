import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, studentProfiles, userConsents, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { changePassword, signIn, signOut, signUp, signUpOrganizer } from './auth'
import type { OrganizerSignUpInput, SignUpInput } from './auth'

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

function organizerSignUpInput(overrides: Partial<OrganizerSignUpInput> = {}): OrganizerSignUpInput {
  return {
    name: 'New Organizer',
    email: `org-signup-${Date.now()}-${Math.random()}@test.com`,
    password: 'a-good-password',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
    ...overrides,
  }
}

describe('signUpOrganizer', () => {
  it('creates an ORGANIZER-role user with a live session and can sign in with the same password', async () => {
    const input = organizerSignUpInput({ phone: ' 9990003333 ' })
    const result = await signUpOrganizer(input)

    expect(result.role).toBe('ORGANIZER')
    const rows = await db.select().from(sessions).where(eq(sessions.token, result.token))
    expect(rows[0]?.userId).toBe(result.userId)

    const [user] = await db.select().from(users).where(eq(users.id, result.userId))
    expect(user.role).toBe('ORGANIZER')
    expect(user.phone).toBe('9990003333')

    const signedIn = await signIn(input.email, input.password)
    expect(signedIn.userId).toBe(result.userId)
    expect(signedIn.role).toBe('ORGANIZER')
  })

  it('records Terms + Privacy consent and never creates a student profile', async () => {
    const { userId } = await signUpOrganizer(organizerSignUpInput())

    const consents = await db.select().from(userConsents).where(eq(userConsents.userId, userId))
    expect(consents.map((row) => row.consentType).sort()).toEqual(['PRIVACY_POLICY', 'TERMS_OF_SERVICE'])

    const profiles = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId))
    expect(profiles).toHaveLength(0)
  })

  it('refuses an email that already belongs to a delegate account, and leaves that account a STUDENT', async () => {
    const student = await makeUser('STUDENT')

    await expect(signUpOrganizer(organizerSignUpInput({ email: student.email }))).rejects.toThrow(
      'An account with that email already exists',
    )

    const [unchanged] = await db.select({ role: users.role }).from(users).where(eq(users.id, student.id))
    expect(unchanged.role).toBe('STUDENT')
  })

  it('matches the email case-insensitively when checking for duplicates', async () => {
    const student = await makeUser('STUDENT')

    await expect(
      signUpOrganizer(organizerSignUpInput({ email: `  ${student.email.toUpperCase()} ` })),
    ).rejects.toThrow('An account with that email already exists')
  })

  it('rejects a short password, a blank name, and missing consent', async () => {
    await expect(signUpOrganizer(organizerSignUpInput({ password: 'short' }))).rejects.toThrow(
      'Password must be at least 8 characters',
    )
    await expect(signUpOrganizer(organizerSignUpInput({ name: '  ' }))).rejects.toThrow('Name is required')
    await expect(signUpOrganizer(organizerSignUpInput({ acceptedTermsOfService: false }))).rejects.toThrow(
      'You must accept the Terms of Service to create an account',
    )
    await expect(signUpOrganizer(organizerSignUpInput({ acceptedPrivacyPolicy: false }))).rejects.toThrow(
      'You must accept the Privacy Policy to create an account',
    )
  })
})

describe('signUp', () => {
  it('creates a STUDENT-role user, returns a valid session, and a matching sessions row exists', async () => {
    const result = await signUp(signUpInput())

    expect(result.role).toBe('STUDENT')
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.expiresAt).toBeInstanceOf(Date)

    const rows = await db.select().from(sessions).where(eq(sessions.token, result.token))
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
