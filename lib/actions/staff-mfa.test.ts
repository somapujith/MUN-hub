import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, mfaPendingChallenges, mfaRecoveryCodes, userMfa, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { totp } from '@/lib/auth/totp'
import type { Session } from '@/lib/auth/adapter'
import type { Role } from '@/lib/db/schema-enums'
import {
  beginMfaChallenge,
  beginMfaEnrollment,
  completeMfaChallenge,
  confirmMfaEnrollment,
  disableMfa,
  getMfaEnrollmentStatus,
  hasConfirmedMfa,
  MFA_ERRORS,
  regenerateMfaRecoveryCodes,
  resetStaffMfa,
} from './staff-mfa'

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

async function makeUser(role: AnyRole) {
  const [user] = await db
    .insert(users)
    .values({ name: `mfa-test ${role}`, email: `mfa-${crypto.randomUUID()}@test.dev`, role, passwordHash: await hashPassword('irrelevant') })
    .returning()
  return user
}

function sess(user: { id: string; role: AnyRole }): Session {
  return { userId: user.id, role: user.role as Role }
}

/** Enrolls and confirms `user`, returning its plaintext secret + recovery codes for the test to use. */
async function enrollAndConfirm(user: { id: string; role: AnyRole }) {
  const { secret } = await beginMfaEnrollment(sess(user))
  const code = totp(secret)
  const { recoveryCodes } = await confirmMfaEnrollment(code, sess(user))
  return { secret, recoveryCodes }
}

describe('beginMfaEnrollment', () => {
  it('rejects a non-staff account', async () => {
    const student = await makeUser('STUDENT')
    await expect(beginMfaEnrollment(sess(student))).rejects.toThrow(MFA_ERRORS.staffOnly)
  })

  it('returns a secret and an otpauth URI, and stores an unconfirmed row', async () => {
    const admin = await makeUser('ADMIN')

    const result = await beginMfaEnrollment(sess(admin))

    expect(result.secret.length).toBeGreaterThan(0)
    expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//)
    expect(result.otpauthUri).toContain(result.secret)

    const [row] = await db.select().from(userMfa).where(eq(userMfa.userId, admin.id))
    expect(row.confirmedAt).toBeNull()
    expect(row.totpSecretCiphertext).not.toContain(result.secret) // stored encrypted, not plaintext
  })

  it('restarting setup before confirming replaces the pending secret', async () => {
    const admin = await makeUser('ADMIN')
    const first = await beginMfaEnrollment(sess(admin))
    const second = await beginMfaEnrollment(sess(admin))

    expect(second.secret).not.toBe(first.secret)
    // The old secret's code no longer confirms setup.
    await expect(confirmMfaEnrollment(totp(first.secret), sess(admin))).rejects.toThrow(MFA_ERRORS.invalidCode)
  })

  it('rejects starting setup again once already confirmed', async () => {
    const admin = await makeUser('OPERATIONS')
    await enrollAndConfirm(admin)

    await expect(beginMfaEnrollment(sess(admin))).rejects.toThrow(MFA_ERRORS.alreadyEnrolled)
  })
})

describe('confirmMfaEnrollment', () => {
  it('rejects when setup was never started', async () => {
    const admin = await makeUser('ADMIN')
    await expect(confirmMfaEnrollment('123456', sess(admin))).rejects.toThrow(MFA_ERRORS.notEnrolled)
  })

  it('rejects a wrong code', async () => {
    const admin = await makeUser('ADMIN')
    await beginMfaEnrollment(sess(admin))

    await expect(confirmMfaEnrollment('000000', sess(admin))).rejects.toThrow(MFA_ERRORS.invalidCode)
  })

  it('confirms with a valid code, sets confirmedAt, and mints 10 unique recovery codes', async () => {
    const admin = await makeUser('SUPER_ADMIN')
    const { secret } = await beginMfaEnrollment(sess(admin))

    const { recoveryCodes } = await confirmMfaEnrollment(totp(secret), sess(admin))

    expect(recoveryCodes).toHaveLength(10)
    expect(new Set(recoveryCodes).size).toBe(10)
    for (const code of recoveryCodes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/)

    const [row] = await db.select().from(userMfa).where(eq(userMfa.userId, admin.id))
    expect(row.confirmedAt).toBeInstanceOf(Date)

    expect(await hasConfirmedMfa(admin.id)).toBe(true)
    expect(await getMfaEnrollmentStatus(sess(admin))).toEqual({ confirmed: true })
  })
})

describe('beginMfaChallenge / completeMfaChallenge', () => {
  it('signs in with a valid TOTP code', async () => {
    const admin = await makeUser('ADMIN')
    const { secret } = await enrollAndConfirm(admin)

    // confirmMfaEnrollment already consumed the current 30s step as
    // lastUsedStep (replay protection) — generate the sign-in code from the
    // next step so it isn't rejected as a repeat of the confirmation code.
    const { pendingToken } = await beginMfaChallenge(admin.id)
    const result = await completeMfaChallenge(pendingToken, totp(secret, new Date(Date.now() + 30_000)))

    expect(result.userId).toBe(admin.id)
    expect(result.role).toBe('ADMIN')
    expect(typeof result.token).toBe('string')
  })

  it('signs in with an unused recovery code, and that code cannot be reused', async () => {
    const admin = await makeUser('ADMIN')
    const { recoveryCodes } = await enrollAndConfirm(admin)

    const { pendingToken: firstToken } = await beginMfaChallenge(admin.id)
    const result = await completeMfaChallenge(firstToken, recoveryCodes[0])
    expect(result.userId).toBe(admin.id)

    const { pendingToken: secondToken } = await beginMfaChallenge(admin.id)
    await expect(completeMfaChallenge(secondToken, recoveryCodes[0])).rejects.toThrow(MFA_ERRORS.invalidCode)
  })

  it('a wrong code counts against the attempt limit, and locks the challenge after 5', async () => {
    const admin = await makeUser('ADMIN')
    await enrollAndConfirm(admin)
    const { pendingToken } = await beginMfaChallenge(admin.id)

    for (let i = 0; i < 4; i += 1) {
      await expect(completeMfaChallenge(pendingToken, '000000')).rejects.toThrow(MFA_ERRORS.invalidCode)
    }
    await expect(completeMfaChallenge(pendingToken, '000000')).rejects.toThrow(MFA_ERRORS.tooManyAttempts)

    // Even a correct code is now refused — the challenge is dead, not just guess-limited.
    await expect(completeMfaChallenge(pendingToken, '111111')).rejects.toThrow(MFA_ERRORS.tooManyAttempts)
  })

  it('rejects an expired challenge', async () => {
    const admin = await makeUser('ADMIN')
    const { secret } = await enrollAndConfirm(admin)
    const { pendingToken } = await beginMfaChallenge(admin.id)

    await db
      .update(mfaPendingChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mfaPendingChallenges.userId, admin.id))

    await expect(completeMfaChallenge(pendingToken, totp(secret))).rejects.toThrow(MFA_ERRORS.expired)
  })

  it('rejects an unknown pending token', async () => {
    await expect(completeMfaChallenge('not-a-real-token', '123456')).rejects.toThrow(MFA_ERRORS.expired)
  })

  it('replay protection: the same TOTP code cannot be used twice', async () => {
    const admin = await makeUser('ADMIN')
    const { secret } = await enrollAndConfirm(admin)
    // See the step-collision note above — start from a step past confirmation's.
    const code = totp(secret, new Date(Date.now() + 30_000))

    const { pendingToken: first } = await beginMfaChallenge(admin.id)
    await completeMfaChallenge(first, code)

    const { pendingToken: second } = await beginMfaChallenge(admin.id)
    await expect(completeMfaChallenge(second, code)).rejects.toThrow(MFA_ERRORS.invalidCode)
  })
})

describe('resetStaffMfa', () => {
  it('SUPER_ADMIN clears enrollment and recovery codes', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const admin = await makeUser('ADMIN')
    await enrollAndConfirm(admin)

    await resetStaffMfa(admin.id, sess(superAdmin))

    expect(await hasConfirmedMfa(admin.id)).toBe(false)
    const [mfaRow] = await db.select().from(userMfa).where(eq(userMfa.userId, admin.id))
    expect(mfaRow).toBeUndefined()
    const recoveryRows = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, admin.id))
    expect(recoveryRows).toHaveLength(0)
  })

  it('clears an open sign-in challenge too, so the old secret leaves nothing usable behind', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const admin = await makeUser('ADMIN')
    await enrollAndConfirm(admin)
    const { pendingToken } = await beginMfaChallenge(admin.id)

    await resetStaffMfa(admin.id, sess(superAdmin))

    const challenges = await db.select().from(mfaPendingChallenges).where(eq(mfaPendingChallenges.userId, admin.id))
    expect(challenges).toHaveLength(0)
    await expect(completeMfaChallenge(pendingToken, '000000')).rejects.toThrow(MFA_ERRORS.expired)
  })

  it('rejects a non-SUPER_ADMIN caller', async () => {
    const otherAdmin = await makeUser('ADMIN')
    const target = await makeUser('ADMIN')
    await enrollAndConfirm(target)

    await expect(resetStaffMfa(target.id, sess(otherAdmin))).rejects.toThrow('Forbidden')
  })

  // Otherwise this is a second, code-free route to disableMfa — which exists
  // precisely so a stolen session cookie can't take the safety net down.
  it('refuses to clear the caller their own MFA', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    await enrollAndConfirm(superAdmin)

    await expect(resetStaffMfa(superAdmin.id, sess(superAdmin))).rejects.toThrow(
      'You cannot change your own staff account here',
    )
    expect(await hasConfirmedMfa(superAdmin.id)).toBe(true)
  })

  it('refuses a non-staff target and writes no audit row', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const student = await makeUser('STUDENT')

    await expect(resetStaffMfa(student.id, sess(superAdmin))).rejects.toThrow('Staff member not found')
    const actions = await db.select().from(adminActions).where(eq(adminActions.targetId, student.id))
    expect(actions).toHaveLength(0)
  })

  it('refuses an unknown user id', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    await expect(resetStaffMfa(crypto.randomUUID(), sess(superAdmin))).rejects.toThrow('Staff member not found')
  })

  it('refuses a caller whose own SUPER_ADMIN account has been suspended', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const admin = await makeUser('ADMIN')
    await enrollAndConfirm(admin)
    await db.update(users).set({ suspended: true }).where(eq(users.id, superAdmin.id))

    await expect(resetStaffMfa(admin.id, sess(superAdmin))).rejects.toThrow('Forbidden')
    expect(await hasConfirmedMfa(admin.id)).toBe(true)
  })
})

describe('regenerateMfaRecoveryCodes', () => {
  it('rejects an unconfirmed account', async () => {
    const admin = await makeUser('ADMIN')
    await expect(regenerateMfaRecoveryCodes('123456', sess(admin))).rejects.toThrow(MFA_ERRORS.notConfirmed)
  })

  it('rejects a wrong TOTP code', async () => {
    const admin = await makeUser('ADMIN')
    await enrollAndConfirm(admin)
    await expect(regenerateMfaRecoveryCodes('000000', sess(admin))).rejects.toThrow(MFA_ERRORS.invalidCode)
  })

  it('rejects a recovery code where a TOTP code is required', async () => {
    const admin = await makeUser('ADMIN')
    const { recoveryCodes } = await enrollAndConfirm(admin)
    await expect(regenerateMfaRecoveryCodes(recoveryCodes[0], sess(admin))).rejects.toThrow(MFA_ERRORS.invalidCode)
  })

  it('replaces the old codes: old ones stop working, new ones work', async () => {
    const admin = await makeUser('ADMIN')
    const { secret, recoveryCodes: oldCodes } = await enrollAndConfirm(admin)

    const { recoveryCodes: newCodes } = await regenerateMfaRecoveryCodes(totp(secret, new Date(Date.now() + 30_000)), sess(admin))

    expect(newCodes).toHaveLength(10)
    expect(new Set(newCodes)).not.toEqual(new Set(oldCodes))

    const { pendingToken: p1 } = await beginMfaChallenge(admin.id)
    await expect(completeMfaChallenge(p1, oldCodes[0])).rejects.toThrow(MFA_ERRORS.invalidCode)

    const { pendingToken: p2 } = await beginMfaChallenge(admin.id)
    await expect(completeMfaChallenge(p2, newCodes[0])).resolves.toMatchObject({ userId: admin.id })
  })
})

describe('disableMfa', () => {
  it('rejects an unconfirmed account', async () => {
    const admin = await makeUser('ADMIN')
    await expect(disableMfa('123456', sess(admin))).rejects.toThrow(MFA_ERRORS.notConfirmed)
  })

  it('rejects a wrong code', async () => {
    const admin = await makeUser('ADMIN')
    await enrollAndConfirm(admin)
    await expect(disableMfa('000000', sess(admin))).rejects.toThrow(MFA_ERRORS.invalidCode)
  })

  it('disables with a valid TOTP code and clears enrollment + recovery codes', async () => {
    const admin = await makeUser('ADMIN')
    const { secret } = await enrollAndConfirm(admin)

    await disableMfa(totp(secret, new Date(Date.now() + 30_000)), sess(admin))

    expect(await hasConfirmedMfa(admin.id)).toBe(false)
    const recoveryRows = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, admin.id))
    expect(recoveryRows).toHaveLength(0)
  })

  it('disables with a valid recovery code', async () => {
    const admin = await makeUser('ADMIN')
    const { recoveryCodes } = await enrollAndConfirm(admin)

    await disableMfa(recoveryCodes[0], sess(admin))

    expect(await hasConfirmedMfa(admin.id)).toBe(false)
  })
})

describe('beginMfaEnrollment — TOTP_FIELD_KEY unavailable', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws MFA_ERRORS.unavailable instead of the raw field-encryption error when the key is unset', async () => {
    const admin = await makeUser('ADMIN')
    vi.stubEnv('TOTP_FIELD_KEY', '')

    await expect(beginMfaEnrollment(sess(admin))).rejects.toThrow(MFA_ERRORS.unavailable)
  })
})
