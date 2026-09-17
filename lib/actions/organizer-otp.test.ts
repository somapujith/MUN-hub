import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailLoginCodes, sessions, studentProfiles, userConsents, users } from '@/lib/db/schema'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import {
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_MAX_PER_HOUR,
  ORGANIZER_OTP_ERRORS,
  requestOrganizerLoginCode,
  verifyOrganizerLoginCode,
} from './organizer-otp'

const PROFILE = { name: 'New Organizer', acceptedTermsOfService: true, acceptedPrivacyPolicy: true }

let sendSpy: MockInstance<(notification: NotificationPayload) => Promise<void>>

beforeEach(() => {
  sendSpy = vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
})

afterEach(() => {
  sendSpy.mockRestore()
})

function uniqueEmail(label: string) {
  return `otp-${label}-${crypto.randomUUID()}@test.com`
}

/** The code from the most recent email sent to `email`. */
function lastCodeSentTo(email: string): string {
  const call = sendSpy.mock.calls.filter(([payload]) => payload.to === email).at(-1)
  const code = call?.[0].body.match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error(`no code was emailed to ${email}`)
  expect(call![0].subject).not.toContain(code)
  expect(call![0].html).toContain(code)
  return code
}

async function latestRow(email: string) {
  const [row] = await db
    .select()
    .from(emailLoginCodes)
    .where(eq(emailLoginCodes.email, email))
    .orderBy(desc(emailLoginCodes.createdAt))
    .limit(1)
  return row
}

/** Moves every code row for `email` back in time, as if it was sent `ms` ago. */
async function backdate(email: string, ms: number) {
  const rows = await db.select().from(emailLoginCodes).where(eq(emailLoginCodes.email, email))
  for (const row of rows) {
    await db
      .update(emailLoginCodes)
      .set({ createdAt: new Date(row.createdAt.getTime() - ms) })
      .where(eq(emailLoginCodes.id, row.id))
  }
}

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN', extra: { suspended?: boolean } = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `OTP ${role}`, email: uniqueEmail(role.toLowerCase()), role, ...extra })
    .returning()
  return user
}

describe('organizer email-code sign-up', () => {
  it('asks for a profile first, then creates a password-less ORGANIZER with consent and no student profile', async () => {
    const email = uniqueEmail('new')
    await requestOrganizerLoginCode(email)
    const code = lastCodeSentTo(email)
    const stored = await latestRow(email)
    expect(stored.codeHash).not.toContain(code)

    await expect(verifyOrganizerLoginCode({ email, code })).resolves.toEqual({ status: 'PROFILE_REQUIRED' })

    const result = await verifyOrganizerLoginCode({ email, code, profile: { ...PROFILE, phone: ' 9990004444 ' } })
    expect(result.status).toBe('SIGNED_IN')
    if (result.status !== 'SIGNED_IN') return
    expect(result.role).toBe('ORGANIZER')
    expect(result.isNewAccount).toBe(true)

    const [user] = await db.select().from(users).where(eq(users.id, result.userId))
    expect(user).toMatchObject({ email, role: 'ORGANIZER', name: 'New Organizer', phone: '9990004444', passwordHash: null })

    const consents = await db.select().from(userConsents).where(eq(userConsents.userId, user.id))
    expect(consents.map((row) => row.consentType).sort()).toEqual(['PRIVACY_POLICY', 'TERMS_OF_SERVICE'])
    expect(await db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id))).toHaveLength(0)

    const [session] = await db.select().from(sessions).where(eq(sessions.token, result.token))
    expect(session.userId).toBe(user.id)
  })

  it('keeps the code usable when the profile is invalid, so the organizer can fix it and retry', async () => {
    const email = uniqueEmail('bad-profile')
    await requestOrganizerLoginCode(email)
    const code = lastCodeSentTo(email)

    await expect(
      verifyOrganizerLoginCode({ email, code, profile: { ...PROFILE, acceptedPrivacyPolicy: false } }),
    ).rejects.toThrow('You must accept the Privacy Policy to create an account')
    await expect(verifyOrganizerLoginCode({ email, code, profile: { ...PROFILE, name: ' ' } })).rejects.toThrow(
      'Name is required',
    )

    const result = await verifyOrganizerLoginCode({ email, code, profile: PROFILE })
    expect(result.status).toBe('SIGNED_IN')
  })
})

describe('organizer email-code sign-in', () => {
  it('signs an existing organizer straight in, ignoring the email case, and the code works once', async () => {
    const organizer = await makeUser('ORGANIZER')
    await requestOrganizerLoginCode(`  ${organizer.email.toUpperCase()} `)
    const code = lastCodeSentTo(organizer.email)

    const result = await verifyOrganizerLoginCode({ email: organizer.email.toUpperCase(), code })
    expect(result).toMatchObject({ status: 'SIGNED_IN', userId: organizer.id, role: 'ORGANIZER', isNewAccount: false })

    await expect(verifyOrganizerLoginCode({ email: organizer.email, code })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.expired,
    )
  })

  it('never sends a code to a delegate address, and leaves that account a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    await expect(requestOrganizerLoginCode(student.email)).resolves.toBeUndefined()

    const [payload] = sendSpy.mock.calls.at(-1)!
    expect(payload.to).toBe(student.email)
    expect(payload.subject).toBe('MUN Hub organizer sign-in')
    expect(payload.body).not.toMatch(/\d{6}/)

    await expect(verifyOrganizerLoginCode({ email: student.email, code: '123456' })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.expired,
    )
    const [unchanged] = await db.select({ role: users.role }).from(users).where(eq(users.id, student.id))
    expect(unchanged.role).toBe('STUDENT')
  })

  it('treats staff addresses like delegate ones', async () => {
    const admin = await makeUser('ADMIN')
    await requestOrganizerLoginCode(admin.email)
    expect(sendSpy.mock.calls.at(-1)![0].subject).toBe('MUN Hub organizer sign-in')
  })

  it('refuses a suspended organizer after a correct code', async () => {
    const organizer = await makeUser('ORGANIZER', { suspended: true })
    await requestOrganizerLoginCode(organizer.email)
    const code = lastCodeSentTo(organizer.email)

    await expect(verifyOrganizerLoginCode({ email: organizer.email, code })).rejects.toThrow('Account suspended')
  })
})

describe('code guessing and expiry', () => {
  it(`locks the code after ${LOGIN_CODE_MAX_ATTEMPTS} wrong guesses, even for the right code`, async () => {
    const organizer = await makeUser('ORGANIZER')
    await requestOrganizerLoginCode(organizer.email)
    const code = lastCodeSentTo(organizer.email)
    const wrong = code === '000000' ? '111111' : '000000'

    for (let attempt = 1; attempt < LOGIN_CODE_MAX_ATTEMPTS; attempt++) {
      await expect(verifyOrganizerLoginCode({ email: organizer.email, code: wrong })).rejects.toThrow(
        ORGANIZER_OTP_ERRORS.incorrect,
      )
    }
    await expect(verifyOrganizerLoginCode({ email: organizer.email, code: wrong })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.tooManyAttempts,
    )
    await expect(verifyOrganizerLoginCode({ email: organizer.email, code })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.tooManyAttempts,
    )
    expect((await latestRow(organizer.email)).attempts).toBe(LOGIN_CODE_MAX_ATTEMPTS)
  })

  it('rejects a malformed code without spending an attempt', async () => {
    const organizer = await makeUser('ORGANIZER')
    await requestOrganizerLoginCode(organizer.email)

    await expect(verifyOrganizerLoginCode({ email: organizer.email, code: '12ab' })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.incorrect,
    )
    expect((await latestRow(organizer.email)).attempts).toBe(0)
  })

  it('rejects an expired code', async () => {
    const organizer = await makeUser('ORGANIZER')
    await requestOrganizerLoginCode(organizer.email)
    const code = lastCodeSentTo(organizer.email)
    await db
      .update(emailLoginCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailLoginCodes.email, organizer.email))

    await expect(verifyOrganizerLoginCode({ email: organizer.email, code })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.expired,
    )
  })

  it('rejects a code for an address that never requested one', async () => {
    await expect(verifyOrganizerLoginCode({ email: uniqueEmail('nobody'), code: '123456' })).rejects.toThrow(
      ORGANIZER_OTP_ERRORS.expired,
    )
  })
})

describe('resending codes', () => {
  it('enforces a cooldown, and a new code replaces the old one', async () => {
    const organizer = await makeUser('ORGANIZER')
    await requestOrganizerLoginCode(organizer.email)
    const firstCode = lastCodeSentTo(organizer.email)

    await expect(requestOrganizerLoginCode(organizer.email)).rejects.toThrow(ORGANIZER_OTP_ERRORS.cooldown)

    await backdate(organizer.email, 61_000)
    await requestOrganizerLoginCode(organizer.email)
    const secondCode = lastCodeSentTo(organizer.email)

    if (firstCode !== secondCode) {
      await expect(verifyOrganizerLoginCode({ email: organizer.email, code: firstCode })).rejects.toThrow(
        ORGANIZER_OTP_ERRORS.incorrect,
      )
    }
    const result = await verifyOrganizerLoginCode({ email: organizer.email, code: secondCode })
    expect(result.status).toBe('SIGNED_IN')
  })

  it(`caps an address at ${LOGIN_CODE_MAX_PER_HOUR} codes an hour`, async () => {
    const email = uniqueEmail('hourly')
    for (let i = 0; i < LOGIN_CODE_MAX_PER_HOUR; i++) {
      await requestOrganizerLoginCode(email)
      await backdate(email, 61_000)
    }
    await expect(requestOrganizerLoginCode(email)).rejects.toThrow(ORGANIZER_OTP_ERRORS.hourlyLimit)
  })

  it('frees the address to retry immediately when the email could not be sent', async () => {
    const email = uniqueEmail('undeliverable')
    sendSpy.mockRejectedValueOnce(new Error('smtp down'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(requestOrganizerLoginCode(email)).rejects.toThrow(ORGANIZER_OTP_ERRORS.deliveryFailed)
    expect(await latestRow(email)).toBeUndefined()
    errorLog.mockRestore()

    await requestOrganizerLoginCode(email)
    expect(lastCodeSentTo(email)).toMatch(/^\d{6}$/)
  })
})
