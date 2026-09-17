import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  munPaymentSettings,
  munSubmissions,
  muns,
  registrationProducts,
  registrations,
  users,
  verificationLogs,
} from '@/lib/db/schema'
import type { MunStatus, PaymentVerificationState, Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { notifyConferenceCancelled } from './lifecycle-events'
import { canTransition } from './mun-state-machine'
import {
  CANCEL_REASON_MAX_LENGTH,
  LIFECYCLE_ERRORS,
  LifecycleActionError,
  conferenceCompletableAt,
  conferenceStartWindowOpensAt,
  conferenceStartsAt,
  getLifecycleOverview,
  runLifecycleAction,
  runScheduledLifecycleTransitions,
  startOfIstDay,
} from './registration-lifecycle'

vi.mock('./lifecycle-events', () => ({
  notifyConferenceCancelled: vi.fn(async () => {}),
}))

const notifyMock = vi.mocked(notifyConferenceCancelled)

beforeEach(() => {
  notifyMock.mockReset()
  notifyMock.mockImplementation(async () => {})
})

afterAll(async () => {
  await db.$client.end()
})

// 12:00 IST on 1 Oct 2026. Conference dates are stored the way the setup form
// stores them: bare dates at UTC midnight.
const NOW = new Date('2026-10-01T06:30:00Z')
const START = new Date('2026-10-10T00:00:00Z')
const END = new Date('2026-10-12T00:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

async function makeUser(role: Role = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `lifecycle-${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

interface MunOptions {
  status?: MunStatus
  startDate?: Date | null
  endDate?: Date | null
  registrationOpensAt?: Date | null
  registrationDeadline?: Date | null
  /** Passes to create; default one paid active pass. */
  passes?: Array<{ price: number; status?: string; deadline?: Date | null }>
  /** Payment settings state; null = no settings row. Default VERIFIED. */
  payment?: PaymentVerificationState | null
}

async function makeMun(organizerId: string, options: MunOptions = {}) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Lifecycle Test Mun',
      slug: `lifecycle-test-${crypto.randomUUID()}`,
      status: options.status ?? 'PUBLISHED',
      startDate: options.startDate === undefined ? START : options.startDate,
      endDate: options.endDate === undefined ? END : options.endDate,
      registrationOpensAt:
        options.registrationOpensAt === undefined ? new Date(NOW.getTime() - DAY) : options.registrationOpensAt,
      registrationDeadline:
        options.registrationDeadline === undefined
          ? new Date('2026-10-05T00:00:00Z')
          : options.registrationDeadline,
    })
    .returning()

  const passes = options.passes ?? [{ price: 1500 }]
  const createdPasses = []
  for (const pass of passes) {
    const [created] = await db
      .insert(registrationProducts)
      .values({
        munId: mun.id,
        name: `Pass ${pass.price}`,
        price: pass.price,
        capacity: 50,
        status: pass.status ?? 'active',
        deadline: pass.deadline ?? null,
      })
      .returning()
    createdPasses.push(created)
  }

  const payment = options.payment === undefined ? 'VERIFIED' : options.payment
  if (payment) {
    await db.insert(munPaymentSettings).values({
      munId: mun.id,
      legalName: 'Test Org',
      orgType: 'NGO',
      addressLine1: 'Addr',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
      panLast4: '1234',
      panCiphertext: 'ciphertext-not-real',
      authorizedRepName: 'Rep',
      authorizedRepEmail: 'rep@lifecycle.test',
      accountHolderName: 'Test Org',
      bankName: 'Test Bank',
      accountNumberLast4: '5678',
      accountNumberCiphertext: 'ciphertext-not-real',
      ifsc: 'TEST0001234',
      accountType: 'current',
      gateway: 'razorpay',
      verificationState: payment,
    })
  }

  return { mun, passes: createdPasses }
}

async function statusOf(munId: string): Promise<MunStatus> {
  const [row] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId))
  return row.status
}

async function logsOf(munId: string) {
  return db
    .select({ action: verificationLogs.action, notes: verificationLogs.notes, reviewerId: verificationLogs.reviewerId })
    .from(verificationLogs)
    .where(eq(verificationLogs.munId, munId))
    .orderBy(asc(verificationLogs.createdAt))
}

async function expectLifecycleError(promise: Promise<unknown>, status: 400 | 409, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(LifecycleActionError)
  expect((error as LifecycleActionError).status).toBe(status)
  if (typeof message === 'string') expect((error as Error).message).toBe(message)
  else if (message) expect((error as Error).message).toMatch(message)
}

describe('IST day helpers', () => {
  it('treats a bare UTC-midnight date as that calendar day in IST', () => {
    expect(startOfIstDay(START).toISOString()).toBe('2026-10-09T18:30:00.000Z')
  })

  it('rolls a late-evening UTC instant into the next IST day', () => {
    expect(startOfIstDay(new Date('2026-10-09T20:00:00Z')).toISOString()).toBe('2026-10-09T18:30:00.000Z')
    expect(startOfIstDay(new Date('2026-10-09T18:29:59Z')).toISOString()).toBe('2026-10-08T18:30:00.000Z')
  })

  it('derives the start window, scheduled start and completion instants', () => {
    expect(conferenceStartWindowOpensAt(START).toISOString()).toBe('2026-10-08T18:30:00.000Z')
    expect(conferenceStartsAt(START).toISOString()).toBe('2026-10-09T18:30:00.000Z')
    expect(conferenceCompletableAt(END).toISOString()).toBe('2026-10-12T18:30:00.000Z')
  })
})

describe('state machine edges used by the lifecycle controls', () => {
  it('allows CONFERENCE_ACTIVE -> COMPLETED (no results flow)', () => {
    expect(canTransition('CONFERENCE_ACTIVE', 'COMPLETED')).toBe(true)
  })

  it('still does not let RESULTS_PENDING skip results review', () => {
    expect(canTransition('RESULTS_PENDING', 'COMPLETED')).toBe(false)
  })

  it('has no REGISTRATION_OPEN -> CONFERENCE_ACTIVE shortcut', () => {
    expect(canTransition('REGISTRATION_OPEN', 'CONFERENCE_ACTIVE')).toBe(false)
  })
})

describe('permissions', () => {
  it('rejects a missing session', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id)
    await expect(runLifecycleAction(mun.id, 'open-registration', {}, null, NOW)).rejects.toThrow('Forbidden')
  })

  it('rejects another organizer and a student', async () => {
    const owner = await makeUser()
    const other = await makeUser()
    const student = await makeUser('STUDENT')
    const { mun } = await makeMun(owner.id)
    await expect(runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(other), NOW)).rejects.toThrow('Forbidden')
    await expect(runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(student), NOW)).rejects.toThrow('Forbidden')
    expect(await statusOf(mun.id)).toBe('PUBLISHED')
  })

  it('reports an unknown mun as not found', async () => {
    const admin = await makeUser('ADMIN')
    await expect(
      runLifecycleAction(crypto.randomUUID(), 'close-registration', {}, sessionFor(admin), NOW),
    ).rejects.toThrow('Mun not found')
  })

  it('lets OPERATIONS staff run organizer actions on any mun', async () => {
    const owner = await makeUser()
    const ops = await makeUser('OPERATIONS')
    const { mun } = await makeMun(owner.id)
    const result = await runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(ops), NOW)
    expect(result).toEqual({ munId: mun.id, status: 'REGISTRATION_OPEN' })
  })
})

describe('open-registration', () => {
  it('opens a ready published mun and audits it', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id)

    const result = await runLifecycleAction(mun.id, 'open-registration', { reason: '  Early access  ' }, sessionFor(owner), NOW)

    expect(result).toEqual({ munId: mun.id, status: 'REGISTRATION_OPEN' })
    expect(await statusOf(mun.id)).toBe('REGISTRATION_OPEN')
    expect(await logsOf(mun.id)).toEqual([{ action: 'REGISTRATION_OPEN', notes: 'Early access', reviewerId: owner.id }])
  })

  it('needs an active, still-purchasable pass', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, {
      passes: [
        { price: 0, status: 'inactive' },
        { price: 0, deadline: new Date(NOW.getTime() - HOUR) },
      ],
    })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.noActivePass,
    )
    expect(await statusOf(mun.id)).toBe('PUBLISHED')
  })

  it('needs a verified payment account when a pass is paid', async () => {
    const owner = await makeUser()
    const pending = await makeMun(owner.id, { payment: 'PENDING' })
    const missing = await makeMun(owner.id, { payment: null })
    for (const { mun } of [pending, missing]) {
      await expectLifecycleError(
        runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(owner), NOW),
        409,
        LIFECYCLE_ERRORS.paymentNotVerified,
      )
    }
  })

  it('does not need payment verification when every pass is free', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { passes: [{ price: 0 }], payment: null })
    const result = await runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(owner), NOW)
    expect(result.status).toBe('REGISTRATION_OPEN')
  })

  it('needs a registration deadline that has not passed', async () => {
    const owner = await makeUser()
    const noDeadline = await makeMun(owner.id, { registrationDeadline: null })
    await expectLifecycleError(
      runLifecycleAction(noDeadline.mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.deadlineMissing,
    )

    const passed = await makeMun(owner.id, { registrationDeadline: new Date(NOW.getTime() - 1000) })
    await expectLifecycleError(
      runLifecycleAction(passed.mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.deadlinePassed,
    )
  })

  it('refuses to open before the scheduled opening time', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { registrationOpensAt: new Date('2026-10-02T04:30:00Z') })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      /scheduled to open on 2 Oct 2026.*IST/,
    )
  })

  it('refuses once the conference has started', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, {
      startDate: new Date('2026-10-01T00:00:00Z'),
      endDate: new Date('2026-10-03T00:00:00Z'),
      registrationDeadline: new Date(NOW.getTime() + DAY),
    })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.conferenceStarted,
    )
  })

  it('only applies to a published mun', async () => {
    const owner = await makeUser()
    const onboarding = await makeMun(owner.id, { status: 'ONBOARDING' })
    await expectLifecycleError(
      runLifecycleAction(onboarding.mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      /only be opened for a live MUN \(current status: ONBOARDING\)/,
    )
    const open = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    await expectLifecycleError(
      runLifecycleAction(open.mun.id, 'open-registration', {}, sessionFor(owner), NOW),
      409,
      'Registration is already open',
    )
  })
})

describe('close-registration', () => {
  it('closes open registration and leaves seat holds alone', async () => {
    const owner = await makeUser()
    const delegate = await makeUser('STUDENT')
    const { mun, passes } = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    const [hold] = await db
      .insert(registrations)
      .values({
        userId: delegate.id,
        munId: mun.id,
        registrationProductId: passes[0].id,
        status: 'PAYMENT_PENDING',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .returning()

    const result = await runLifecycleAction(mun.id, 'close-registration', {}, sessionFor(owner), NOW)

    expect(result.status).toBe('REGISTRATION_CLOSED')
    const [after] = await db.select().from(registrations).where(eq(registrations.id, hold.id))
    expect(after.status).toBe('PAYMENT_PENDING')
  })

  it('rejects a mun whose registration is not open', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id)
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'close-registration', {}, sessionFor(owner), NOW),
      409,
      /Registration is not open/,
    )
  })
})

describe('start-conference', () => {
  it('is blocked until the day before the start date', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_CLOSED' })
    const justBefore = new Date(conferenceStartWindowOpensAt(START).getTime() - 1000)
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'start-conference', {}, sessionFor(owner), justBefore),
      409,
      'The conference can be started from 9 Oct 2026, the day before it begins',
    )
  })

  it('starts a closed mun from the day before', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_CLOSED' })
    const result = await runLifecycleAction(
      mun.id,
      'start-conference',
      {},
      sessionFor(owner),
      conferenceStartWindowOpensAt(START),
    )
    expect(result.status).toBe('CONFERENCE_ACTIVE')
  })

  it('closes open registration on the way, as two audited transitions', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    const result = await runLifecycleAction(mun.id, 'start-conference', {}, sessionFor(owner), conferenceStartsAt(START))
    expect(result.status).toBe('CONFERENCE_ACTIVE')
    const logs = await logsOf(mun.id)
    expect(logs.map((log) => log.action)).toEqual(['REGISTRATION_CLOSED', 'CONFERENCE_ACTIVE'])
    expect(logs[0].notes).toBe('Registration closed because the conference started')
  })

  it('needs a start date', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_CLOSED', startDate: null })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'start-conference', {}, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.startDateMissing,
    )
  })

  it('rejects a mun that never opened registration', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id)
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'start-conference', {}, sessionFor(owner), conferenceStartsAt(START)),
      409,
      /only be started after registration has opened/,
    )
  })
})

describe('complete', () => {
  it('lets the organizer complete only after the end date is over', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'CONFERENCE_ACTIVE' })
    const lastDayEvening = new Date('2026-10-12T15:00:00Z')
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'complete', {}, sessionFor(owner), lastDayEvening),
      409,
      'The conference can be marked complete once it has ended — from 13 Oct 2026',
    )
    const result = await runLifecycleAction(mun.id, 'complete', {}, sessionFor(owner), conferenceCompletableAt(END))
    expect(result.status).toBe('COMPLETED')
  })

  it('falls back to the start date when there is no end date', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'CONFERENCE_ACTIVE', endDate: null })
    const result = await runLifecycleAction(mun.id, 'complete', {}, sessionFor(owner), conferenceCompletableAt(START))
    expect(result.status).toBe('COMPLETED')
  })

  it('needs an end or start date for the organizer', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'CONFERENCE_ACTIVE', startDate: null, endDate: null })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'complete', {}, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.endDateMissing,
    )
  })

  it('lets staff complete early', async () => {
    const owner = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMun(owner.id, { status: 'CONFERENCE_ACTIVE' })
    const result = await runLifecycleAction(mun.id, 'complete', {}, sessionFor(admin), NOW)
    expect(result.status).toBe('COMPLETED')
  })

  it('leaves completion out of results review to staff', async () => {
    const owner = await makeUser()
    const ops = await makeUser('OPERATIONS')
    const { mun } = await makeMun(owner.id, { status: 'RESULTS_UNDER_REVIEW' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'complete', {}, sessionFor(owner), new Date('2027-01-01T00:00:00Z')),
      409,
      LIFECYCLE_ERRORS.resultsUnderReview,
    )
    const result = await runLifecycleAction(mun.id, 'complete', {}, sessionFor(ops), NOW)
    expect(result.status).toBe('COMPLETED')
  })

  it('rejects a mun that is not in progress', async () => {
    const admin = await makeUser('ADMIN')
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'complete', {}, sessionFor(admin), NOW),
      409,
      /Only a conference in progress can be completed/,
    )
  })
})

describe('archive', () => {
  it('is staff-only', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'COMPLETED' })
    await expect(runLifecycleAction(mun.id, 'archive', {}, sessionFor(owner), NOW)).rejects.toThrow('Forbidden')
  })

  it('archives a completed mun', async () => {
    const owner = await makeUser()
    const ops = await makeUser('OPERATIONS')
    const { mun } = await makeMun(owner.id, { status: 'COMPLETED' })
    const result = await runLifecycleAction(mun.id, 'archive', {}, sessionFor(ops), NOW)
    expect(result.status).toBe('ARCHIVED')
  })

  it('rejects a mun that is not completed', async () => {
    const owner = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMun(owner.id, { status: 'CONFERENCE_ACTIVE' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'archive', {}, sessionFor(admin), NOW),
      409,
      /Only a completed conference can be archived/,
    )
  })
})

describe('cancel', () => {
  it('requires a non-blank reason of bounded length', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'cancel', {}, sessionFor(owner), NOW),
      400,
      LIFECYCLE_ERRORS.reasonRequired,
    )
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'cancel', { reason: '   ' }, sessionFor(owner), NOW),
      400,
      LIFECYCLE_ERRORS.reasonRequired,
    )
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'cancel', { reason: 'x'.repeat(CANCEL_REASON_MAX_LENGTH + 1) }, sessionFor(owner), NOW),
      400,
      LIFECYCLE_ERRORS.reasonTooLong,
    )
    expect(await statusOf(mun.id)).toBe('REGISTRATION_OPEN')
  })

  it('cancels, keeps confirmed registrations, releases holds, withdraws submissions and notifies', async () => {
    const owner = await makeUser()
    const { mun, passes } = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    const delegates = await Promise.all([makeUser('STUDENT'), makeUser('STUDENT'), makeUser('STUDENT')])
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const [confirmed, pending, paymentPending] = await db
      .insert(registrations)
      .values([
        { userId: delegates[0].id, munId: mun.id, registrationProductId: passes[0].id, status: 'CONFIRMED' },
        { userId: delegates[1].id, munId: mun.id, registrationProductId: passes[0].id, status: 'PENDING', expiresAt },
        {
          userId: delegates[2].id,
          munId: mun.id,
          registrationProductId: passes[0].id,
          status: 'PAYMENT_PENDING',
          expiresAt,
        },
      ])
      .returning()
    const [submission] = await db
      .insert(munSubmissions)
      .values({
        munId: mun.id,
        submittedBy: owner.id,
        versionNumber: 1,
        status: 'UNDER_REVIEW',
        slaDeadline: new Date(Date.now() + DAY),
      })
      .returning()

    notifyMock.mockImplementation(async (munId) => {
      // Runs after commit: the cancellation is already visible.
      expect(await statusOf(munId)).toBe('CANCELLED')
    })

    const result = await runLifecycleAction(
      mun.id,
      'cancel',
      { reason: 'Venue unavailable' },
      sessionFor(owner),
      NOW,
    )

    expect(result).toEqual({ munId: mun.id, status: 'CANCELLED' })
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock).toHaveBeenCalledWith(mun.id)

    const rows = await db.select().from(registrations).where(eq(registrations.munId, mun.id))
    const byId = new Map(rows.map((row) => [row.id, row.status]))
    expect(byId.get(confirmed.id)).toBe('CONFIRMED')
    expect(byId.get(pending.id)).toBe('CANCELLED')
    expect(byId.get(paymentPending.id)).toBe('CANCELLED')

    const [withdrawn] = await db.select().from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(withdrawn.status).toBe('WITHDRAWN')

    expect(await logsOf(mun.id)).toEqual([{ action: 'CANCELLED', notes: 'Venue unavailable', reviewerId: owner.id }])
  })

  it('still succeeds when the notification hook throws', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id)
    notifyMock.mockRejectedValue(new Error('mailer down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await runLifecycleAction(mun.id, 'cancel', { reason: 'Organizers withdrew' }, sessionFor(owner), NOW)
      expect(result.status).toBe('CANCELLED')
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('does not notify when the cancellation is rejected', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'COMPLETED' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'cancel', { reason: 'Too late' }, sessionFor(owner), NOW),
      409,
      "A conference in status COMPLETED can't be cancelled",
    )
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('is open to ADMIN but not OPERATIONS', async () => {
    const owner = await makeUser()
    const ops = await makeUser('OPERATIONS')
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMun(owner.id)
    await expect(
      runLifecycleAction(mun.id, 'cancel', { reason: 'Fraud report' }, sessionFor(ops), NOW),
    ).rejects.toThrow('Forbidden')
    const result = await runLifecycleAction(mun.id, 'cancel', { reason: 'Fraud report' }, sessionFor(admin), NOW)
    expect(result.status).toBe('CANCELLED')
  })

  it('leaves a suspended mun to admins', async () => {
    const owner = await makeUser()
    const admin = await makeUser('ADMIN')
    const { mun } = await makeMun(owner.id, { status: 'SUSPENDED' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'cancel', { reason: 'Giving up' }, sessionFor(owner), NOW),
      409,
      LIFECYCLE_ERRORS.suspended,
    )
    const result = await runLifecycleAction(mun.id, 'cancel', { reason: 'Confirmed fraud' }, sessionFor(admin), NOW)
    expect(result.status).toBe('CANCELLED')
  })

  it('rejects an already-cancelled mun', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'CANCELLED' })
    await expectLifecycleError(
      runLifecycleAction(mun.id, 'cancel', { reason: 'Again' }, sessionFor(owner), NOW),
      409,
      'The conference is already cancelled',
    )
  })
})

describe('getLifecycleOverview', () => {
  it('lists the organizer next actions with blocked reasons', async () => {
    const owner = await makeUser()
    const delegate = await makeUser('STUDENT')
    const { mun, passes } = await makeMun(owner.id, { payment: 'PENDING' })
    await db
      .insert(registrations)
      .values({ userId: delegate.id, munId: mun.id, registrationProductId: passes[0].id, status: 'CONFIRMED' })

    const overview = await getLifecycleOverview(mun.id, sessionFor(owner), NOW)

    expect(overview).toMatchObject({
      munId: mun.id,
      name: 'Lifecycle Test Mun',
      status: 'PUBLISHED',
      confirmedRegistrations: 1,
    })
    expect(overview.startDate?.toISOString()).toBe(START.toISOString())
    expect(overview.actions).toEqual([
      {
        action: 'open-registration',
        targetStatus: 'REGISTRATION_OPEN',
        available: false,
        blockedReason: LIFECYCLE_ERRORS.paymentNotVerified,
        requiresReason: false,
      },
      {
        action: 'cancel',
        targetStatus: 'CANCELLED',
        available: true,
        blockedReason: null,
        requiresReason: true,
      },
    ])
  })

  it('shows start-conference for open registration, blocked until the window', async () => {
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })
    const overview = await getLifecycleOverview(mun.id, sessionFor(owner), NOW)
    expect(overview.actions.map((option) => [option.action, option.available])).toEqual([
      ['close-registration', true],
      ['start-conference', false],
      ['cancel', true],
    ])
  })

  it('shows archive to staff only', async () => {
    const owner = await makeUser()
    const ops = await makeUser('OPERATIONS')
    const { mun } = await makeMun(owner.id, { status: 'COMPLETED' })
    expect((await getLifecycleOverview(mun.id, sessionFor(owner), NOW)).actions).toEqual([])
    expect((await getLifecycleOverview(mun.id, sessionFor(ops), NOW)).actions.map((option) => option.action)).toEqual([
      'archive',
    ])
  })

  it('is limited to the owner and staff', async () => {
    const owner = await makeUser()
    const other = await makeUser()
    const { mun } = await makeMun(owner.id)
    await expect(getLifecycleOverview(mun.id, sessionFor(other), NOW)).rejects.toThrow('Forbidden')
    await expect(getLifecycleOverview(mun.id, null, NOW)).rejects.toThrow('Forbidden')
  })
})

describe('runScheduledLifecycleTransitions', () => {
  async function makeSystemActor() {
    return makeUser('ADMIN')
  }

  it('requires a system actor id', async () => {
    await expect(runScheduledLifecycleTransitions(NOW, '', { munIds: [] })).rejects.toThrow(/system actor/)
  })

  it('does nothing for an empty scope', async () => {
    const actor = await makeSystemActor()
    expect(await runScheduledLifecycleTransitions(NOW, actor.id, { munIds: [] })).toEqual({
      opened: [],
      closed: [],
      started: [],
      skipped: [],
    })
  })

  it('opens due muns, reports blocked ones and ignores the rest', async () => {
    const actor = await makeSystemActor()
    const owner = await makeUser()
    const due = await makeMun(owner.id)
    const notYet = await makeMun(owner.id, { registrationOpensAt: new Date(NOW.getTime() + HOUR) })
    const noSchedule = await makeMun(owner.id, { registrationOpensAt: null })
    const blocked = await makeMun(owner.id, { passes: [] })
    const deadlineGone = await makeMun(owner.id, { registrationDeadline: new Date(NOW.getTime() - HOUR) })
    const ids = [due, notYet, noSchedule, blocked, deadlineGone].map(({ mun }) => mun.id)

    const result = await runScheduledLifecycleTransitions(NOW, actor.id, { munIds: ids })

    expect(result.opened).toEqual([due.mun.id])
    expect(result.skipped).toEqual([
      { munId: blocked.mun.id, action: 'open-registration', reason: LIFECYCLE_ERRORS.noActivePass },
    ])
    expect(await statusOf(due.mun.id)).toBe('REGISTRATION_OPEN')
    for (const id of ids.slice(1)) expect(await statusOf(id)).toBe('PUBLISHED')
    expect(await logsOf(due.mun.id)).toEqual([
      { action: 'REGISTRATION_OPEN', notes: 'Automatic: registration opening time reached', reviewerId: actor.id },
    ])
  })

  it('closes registration at the deadline', async () => {
    const actor = await makeSystemActor()
    const owner = await makeUser()
    const pastDeadline = await makeMun(owner.id, {
      status: 'REGISTRATION_OPEN',
      registrationDeadline: new Date(NOW.getTime() - 1000),
    })
    const stillOpen = await makeMun(owner.id, { status: 'REGISTRATION_OPEN' })

    const result = await runScheduledLifecycleTransitions(NOW, actor.id, {
      munIds: [pastDeadline.mun.id, stillOpen.mun.id],
    })

    expect(result).toEqual({ opened: [], closed: [pastDeadline.mun.id], started: [], skipped: [] })
    expect(await statusOf(pastDeadline.mun.id)).toBe('REGISTRATION_CLOSED')
    expect(await statusOf(stillOpen.mun.id)).toBe('REGISTRATION_OPEN')
  })

  it('starts closed muns on their start day, not the day before', async () => {
    const actor = await makeSystemActor()
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id, { status: 'REGISTRATION_CLOSED' })

    const dayBefore = new Date(conferenceStartsAt(START).getTime() - 1000)
    expect(await runScheduledLifecycleTransitions(dayBefore, actor.id, { munIds: [mun.id] })).toEqual({
      opened: [],
      closed: [],
      started: [],
      skipped: [],
    })
    expect(await statusOf(mun.id)).toBe('REGISTRATION_CLOSED')

    const result = await runScheduledLifecycleTransitions(conferenceStartsAt(START), actor.id, { munIds: [mun.id] })
    expect(result.started).toEqual([mun.id])
    expect(await statusOf(mun.id)).toBe('CONFERENCE_ACTIVE')
  })

  it('closes and starts a still-open mun in one run once its start day begins', async () => {
    const actor = await makeSystemActor()
    const owner = await makeUser()
    // Deadline not yet passed, but the conference day has arrived.
    const { mun } = await makeMun(owner.id, {
      status: 'REGISTRATION_OPEN',
      registrationDeadline: new Date('2026-10-11T00:00:00Z'),
    })
    const startDay = new Date('2026-10-10T03:00:00Z')

    const result = await runScheduledLifecycleTransitions(startDay, actor.id, { munIds: [mun.id] })

    expect(result).toEqual({ opened: [], closed: [mun.id], started: [mun.id], skipped: [] })
    expect(await statusOf(mun.id)).toBe('CONFERENCE_ACTIVE')
  })

  it('is idempotent across repeated and concurrent runs', async () => {
    const actor = await makeSystemActor()
    const owner = await makeUser()
    const { mun } = await makeMun(owner.id)

    const [first, second] = await Promise.all([
      runScheduledLifecycleTransitions(NOW, actor.id, { munIds: [mun.id] }),
      runScheduledLifecycleTransitions(NOW, actor.id, { munIds: [mun.id] }),
    ])
    expect([...first.opened, ...second.opened]).toEqual([mun.id])
    expect([...first.skipped, ...second.skipped]).toEqual([])

    const third = await runScheduledLifecycleTransitions(NOW, actor.id, { munIds: [mun.id] })
    expect(third).toEqual({ opened: [], closed: [], started: [], skipped: [] })
    expect((await logsOf(mun.id)).map((log) => log.action)).toEqual(['REGISTRATION_OPEN'])
  })

  it('never completes, archives or cancels', async () => {
    const actor = await makeSystemActor()
    const owner = await makeUser()
    const active = await makeMun(owner.id, { status: 'CONFERENCE_ACTIVE' })
    const completed = await makeMun(owner.id, { status: 'COMPLETED' })
    const farFuture = new Date('2030-01-01T00:00:00Z')
    const result = await runScheduledLifecycleTransitions(farFuture, actor.id, {
      munIds: [active.mun.id, completed.mun.id],
    })
    expect(result).toEqual({ opened: [], closed: [], started: [], skipped: [] })
    expect(await statusOf(active.mun.id)).toBe('CONFERENCE_ACTIVE')
    expect(await statusOf(completed.mun.id)).toBe('COMPLETED')
  })
})
