import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  adminActions,
  emailLoginCodes,
  passwordResetTokens,
  payments,
  registrations,
  sessions,
  studentProfiles,
  supportTickets,
  userConsents,
  users,
} from '@/lib/db/schema'
import { getSessionByToken } from '@/lib/auth/session'
import type { Session } from '@/lib/auth/adapter'
import { signIn } from './auth'
import {
  ACCOUNT_DELETION_ERRORS,
  DELETED_USER_NAME,
  deleteOwnAccount,
  deletedUserEmail,
  retainsRegistrationAnswers,
} from './account-deletion'
import { DELEGATE_PASSWORD, makeAccount, makeDelegateWithHistory } from './privacy-test-helpers'

const DAY_MS = 24 * 60 * 60 * 1000

async function loadUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  return user
}

describe('retainsRegistrationAnswers', () => {
  const now = new Date('2026-09-17T12:00:00Z')

  it('keeps answers for a CONFIRMED or ATTENDED seat at a conference that has not ended', () => {
    const upcoming = { munStartDate: new Date('2026-10-01'), munEndDate: new Date('2026-10-03') }
    expect(retainsRegistrationAnswers({ status: 'CONFIRMED', ...upcoming }, now)).toBe(true)
    expect(retainsRegistrationAnswers({ status: 'ATTENDED', ...upcoming }, now)).toBe(true)
  })

  it('clears answers for every other status, even at an upcoming conference', () => {
    const upcoming = { munStartDate: new Date('2026-10-01'), munEndDate: new Date('2026-10-03') }
    for (const status of ['PENDING', 'PAYMENT_PENDING', 'CANCELLED', 'REFUNDED', 'NO_SHOW'] as const) {
      expect(retainsRegistrationAnswers({ status, ...upcoming }, now)).toBe(false)
    }
  })

  it('treats a conference as running until a day after its end date', () => {
    const endedToday = { munStartDate: new Date('2026-09-15T00:00:00Z'), munEndDate: new Date('2026-09-17T00:00:00Z') }
    const endedTwoDaysAgo = { munStartDate: new Date('2026-09-13T00:00:00Z'), munEndDate: new Date('2026-09-15T00:00:00Z') }
    expect(retainsRegistrationAnswers({ status: 'CONFIRMED', ...endedToday }, now)).toBe(true)
    expect(retainsRegistrationAnswers({ status: 'CONFIRMED', ...endedTwoDaysAgo }, now)).toBe(false)
  })

  it('falls back to the start date, and keeps answers when the conference has no dates', () => {
    expect(
      retainsRegistrationAnswers({ status: 'CONFIRMED', munStartDate: new Date(now.getTime() - 5 * DAY_MS), munEndDate: null }, now),
    ).toBe(false)
    expect(retainsRegistrationAnswers({ status: 'CONFIRMED', munStartDate: null, munEndDate: null }, now)).toBe(true)
  })
})

describe('deleteOwnAccount', () => {
  it('refuses organizer and staff accounts and changes nothing', async () => {
    for (const role of ['ORGANIZER', 'OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const) {
      const account = await makeAccount(role)
      const session: Session = { userId: account.id, role }

      await expect(
        deleteOwnAccount({ confirmation: 'DELETE', password: DELEGATE_PASSWORD }, session),
      ).rejects.toThrow(ACCOUNT_DELETION_ERRORS.notSelfService)

      const after = await loadUser(account.id)
      expect(after.email).toBe(account.email)
      expect(after.passwordHash).toBe(account.passwordHash)
    }
  })

  it('uses the stored role, not the role cached on the session', async () => {
    const organizer = await makeAccount('ORGANIZER')

    await expect(
      deleteOwnAccount(
        { confirmation: 'DELETE', password: DELEGATE_PASSWORD },
        { userId: organizer.id, role: 'STUDENT' },
      ),
    ).rejects.toThrow(ACCOUNT_DELETION_ERRORS.notSelfService)
  })

  it('requires the exact confirmation word and the correct password', async () => {
    const delegate = await makeAccount('STUDENT')
    const session: Session = { userId: delegate.id, role: 'STUDENT' }

    await expect(
      deleteOwnAccount({ confirmation: 'delete', password: DELEGATE_PASSWORD }, session),
    ).rejects.toThrow(ACCOUNT_DELETION_ERRORS.confirmation)
    await expect(
      deleteOwnAccount({ confirmation: 'DELETE', password: 'wrong-password' }, session),
    ).rejects.toThrow(ACCOUNT_DELETION_ERRORS.password)

    const after = await loadUser(delegate.id)
    expect(after.name).toBe(delegate.name)
    expect(after.email).toBe(delegate.email)
  })

  it('refuses an account with no password set', async () => {
    const legacy = await makeAccount('STUDENT', null)

    await expect(
      deleteOwnAccount({ confirmation: 'DELETE', password: 'anything' }, { userId: legacy.id, role: 'STUDENT' }),
    ).rejects.toThrow(ACCOUNT_DELETION_ERRORS.password)
  })

  it('anonymizes the delegate and removes profile, sessions, reset tokens and sign-in codes', async () => {
    const fixture = await makeDelegateWithHistory()
    const { delegate } = fixture
    const session: Session = { userId: delegate.id, role: 'STUDENT' }
    await db.insert(emailLoginCodes).values({
      email: delegate.email.toUpperCase(),
      codeHash: 'irrelevant',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const result = await deleteOwnAccount({ confirmation: 'DELETE', password: DELEGATE_PASSWORD }, session)

    const after = await loadUser(delegate.id)
    expect(after).toMatchObject({
      id: delegate.id,
      role: 'STUDENT',
      name: DELETED_USER_NAME,
      email: deletedUserEmail(delegate.id),
      phone: null,
      institution: null,
      username: null,
      profileImage: null,
      passwordHash: null,
      emailNotificationsEnabled: false,
    })
    expect(after.email).toBe(`deleted+${delegate.id}@deleted.invalid`)

    expect(await db.select().from(studentProfiles).where(eq(studentProfiles.userId, delegate.id))).toEqual([])
    expect(await db.select().from(sessions).where(eq(sessions.userId, delegate.id))).toEqual([])
    expect(await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, delegate.id))).toEqual([])
    expect(
      await db.select().from(emailLoginCodes).where(eq(emailLoginCodes.email, delegate.email.toUpperCase())),
    ).toEqual([])
    expect(await getSessionByToken(fixture.sessionToken)).toBeNull()
    await expect(signIn(delegate.email, DELEGATE_PASSWORD)).rejects.toThrow('Invalid email or password')
    await expect(signIn(deletedUserEmail(delegate.id), DELEGATE_PASSWORD)).rejects.toThrow('Invalid email or password')

    // Consent history and support tickets are kept.
    expect(await db.select().from(userConsents).where(eq(userConsents.userId, delegate.id))).toHaveLength(2)
    expect(await db.select().from(supportTickets).where(eq(supportTickets.createdBy, delegate.id))).toHaveLength(1)

    expect(result).toEqual({
      userId: delegate.id,
      sessionsRevoked: 1,
      unpaidHoldsCancelled: 1,
      registrationsKept: 4,
      registrationAnswersCleared: 3,
      registrationAnswersRetained: 1,
    })

    // One ACCOUNT_DELETED audit row, the account itself as the actor, no personal data.
    const auditRows = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'user'), eq(adminActions.targetId, delegate.id)))
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({ actorId: delegate.id, action: 'ACCOUNT_DELETED', reason: null })
    expect(auditRows[0].metadata).toEqual({
      actor: 'self',
      role: 'STUDENT',
      sessionsRevoked: 1,
      unpaidHoldsCancelled: 1,
      registrationsKept: 4,
      registrationAnswersCleared: 3,
      registrationAnswersRetained: 1,
    })
    expect(JSON.stringify(auditRows[0])).not.toContain(delegate.email)
  })

  it('keeps registrations and payments, clearing answers except on seats the organizer still needs', async () => {
    const fixture = await makeDelegateWithHistory()
    const session: Session = { userId: fixture.delegate.id, role: 'STUDENT' }

    await deleteOwnAccount({ confirmation: 'DELETE', password: DELEGATE_PASSWORD }, session)

    const rows = await db.select().from(registrations).where(eq(registrations.userId, fixture.delegate.id))
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(rows).toHaveLength(4)

    // Confirmed seat at an upcoming conference: answers kept for the organizer.
    expect(byId.get(fixture.registrations.upcomingConfirmed.id)).toMatchObject({
      status: 'CONFIRMED',
      formResponses: { emergency_contact_name: 'Parent Name', dietary: 'Vegetarian' },
      accommodationAnswers: { roommate: 'Friend Name' },
    })
    // Finished conference and cancelled registration: answers cleared.
    expect(byId.get(fixture.registrations.finishedConfirmed.id)).toMatchObject({
      status: 'CONFIRMED',
      formResponses: null,
    })
    expect(byId.get(fixture.registrations.cancelled.id)).toMatchObject({ status: 'CANCELLED', formResponses: null })
    // Unpaid hold: seat released and answers cleared.
    expect(byId.get(fixture.registrations.unpaidHold.id)).toMatchObject({ status: 'CANCELLED', formResponses: null })

    const [paid] = await db.select().from(payments).where(eq(payments.id, fixture.payments.paidPayment.id))
    expect(paid).toMatchObject({
      registrationId: fixture.registrations.upcomingConfirmed.id,
      amount: 200000,
      status: 'PAID',
    })
    const [pending] = await db.select().from(payments).where(eq(payments.id, fixture.payments.pendingPayment.id))
    expect(pending).toMatchObject({ registrationId: fixture.registrations.unpaidHold.id, status: 'CREATED' })
  })

  it("leaves other delegates' data alone", async () => {
    const target = await makeDelegateWithHistory()
    const bystander = await makeDelegateWithHistory()

    await deleteOwnAccount(
      { confirmation: 'DELETE', password: DELEGATE_PASSWORD },
      { userId: target.delegate.id, role: 'STUDENT' },
    )

    const after = await loadUser(bystander.delegate.id)
    expect(after.email).toBe(bystander.delegate.email)
    expect(await getSessionByToken(bystander.sessionToken)).not.toBeNull()
    const [hold] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, bystander.registrations.unpaidHold.id))
    expect(hold.status).toBe('PAYMENT_PENDING')
    expect(hold.formResponses).not.toBeNull()
  })
})

afterAll(async () => {
  await db.$client.end()
})
