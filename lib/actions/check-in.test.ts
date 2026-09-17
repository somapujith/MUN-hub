import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { achievements, registrations } from '@/lib/db/schema'
import {
  checkInCodeFor,
  checkInDelegate,
  formatCheckInCode,
  getRegistrationPass,
  normalizeCheckInCode,
  setDelegateAttendance,
} from './check-in'
import { ORGANIZER_OPS_ERRORS } from './organizer-ops-errors'
import { addDelegate, makeOpsFixture, makeUser, sessionFor } from './test-fixtures/organizer-ops'

async function statusOf(registrationId: string) {
  const [row] = await db
    .select({ status: registrations.status })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
  return row.status
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('check-in codes', () => {
  it('are 10 Crockford base32 characters, stable per registration and distinct across registrations', () => {
    const a = checkInCodeFor('registration-a')
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
    expect(checkInCodeFor('registration-a')).toBe(a)
    expect(checkInCodeFor('registration-b')).not.toBe(a)
  })

  it('depend on the key: CHECKIN_CODE_SECRET overrides the PAYMENT_FIELD_KEY-derived default', () => {
    const derived = checkInCodeFor('registration-a')
    vi.stubEnv('CHECKIN_CODE_SECRET', 'a-dedicated-check-in-secret-of-40-chars!')
    const dedicated = checkInCodeFor('registration-a')
    expect(dedicated).not.toBe(derived)
    expect(dedicated).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
  })

  it('refuse a too-short CHECKIN_CODE_SECRET instead of using a weak key', () => {
    vi.stubEnv('CHECKIN_CODE_SECRET', 'short')
    expect(() => checkInCodeFor('registration-a')).toThrow(ORGANIZER_OPS_ERRORS.checkInNotConfigured)
  })

  it('refuse to issue codes when no key is configured at all', () => {
    vi.stubEnv('CHECKIN_CODE_SECRET', '')
    vi.stubEnv('PAYMENT_FIELD_KEY', '')
    expect(() => checkInCodeFor('registration-a')).toThrow(ORGANIZER_OPS_ERRORS.checkInNotConfigured)
  })

  it('normalise typed input: case, spacing, hyphens and look-alike letters', () => {
    const code = checkInCodeFor('registration-a')
    const typed = formatCheckInCode(code).toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')
    expect(normalizeCheckInCode(` ${typed} `)).toBe(code)
    expect(normalizeCheckInCode('ABC')).toBeNull()
    expect(normalizeCheckInCode('UUUUUUUUUU')).toBeNull()
  })
})

describe('getRegistrationPass', () => {
  it("returns the delegate's own pass with its check-in code", async () => {
    const fixture = await makeOpsFixture()
    const { user, registration } = await addDelegate(fixture, { name: 'Asha Rao', seated: true })

    const pass = await getRegistrationPass(registration.id, sessionFor(user))
    expect(pass).toMatchObject({
      registrationId: registration.id,
      delegateName: 'Asha Rao',
      passName: 'Delegate Pass',
      committee: 'UNSC',
      portfolio: 'France',
      checkedIn: false,
      mun: { name: fixture.mun.name, venue: fixture.mun.venue, city: 'Hyderabad' },
      checkInCode: formatCheckInCode(checkInCodeFor(registration.id)),
    })
  })

  it('is not found for anyone else, including the organizer and admins', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture)
    const admin = await makeUser('ADMIN')
    const stranger = await makeUser('STUDENT')

    for (const session of [fixture.organizerSession, sessionFor(admin), sessionFor(stranger)]) {
      await expect(getRegistrationPass(registration.id, session)).rejects.toThrow('Registration not found')
    }
    await expect(getRegistrationPass(registration.id, null)).rejects.toThrow('Forbidden')
  })

  it('is unavailable until the registration is confirmed', async () => {
    const fixture = await makeOpsFixture()
    const { user, registration } = await addDelegate(fixture, { status: 'PAYMENT_PENDING' })
    await expect(getRegistrationPass(registration.id, sessionFor(user))).rejects.toThrow(
      ORGANIZER_OPS_ERRORS.passUnavailable,
    )
  })
})

describe('checkInDelegate', () => {
  it('checks a confirmed delegate in, then reports a repeat scan as already checked in', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture, { name: 'Kabir Shah', institution: 'BITS', seated: true })
    const code = formatCheckInCode(checkInCodeFor(registration.id))

    const first = await checkInDelegate(fixture.mun.id, code, fixture.organizerSession)
    expect(first.outcome).toBe('CHECKED_IN')
    expect(first.delegate).toEqual({
      registrationId: registration.id,
      name: 'Kabir Shah',
      institution: 'BITS',
      passName: 'Delegate Pass',
      committee: 'UNSC',
      portfolio: 'France',
    })
    expect(await statusOf(registration.id)).toBe('ATTENDED')

    const second = await checkInDelegate(fixture.mun.id, code.toLowerCase(), fixture.organizerSession)
    expect(second.outcome).toBe('ALREADY_CHECKED_IN')
    expect(second.checkedInAt.getTime()).toBe(first.checkedInAt.getTime())
  })

  it('lets a delegate marked no-show check in late', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture, { status: 'NO_SHOW' })
    const result = await checkInDelegate(fixture.mun.id, checkInCodeFor(registration.id), fixture.organizerSession)
    expect(result.outcome).toBe('CHECKED_IN')
    expect(await statusOf(registration.id)).toBe('ATTENDED')
  })

  it("rejects another MUN's pass and a non-confirmed registration's code", async () => {
    const fixture = await makeOpsFixture()
    const other = await makeOpsFixture()
    const { registration: foreign } = await addDelegate(other)
    const { registration: unpaid } = await addDelegate(fixture, { status: 'PAYMENT_PENDING' })

    await expect(
      checkInDelegate(fixture.mun.id, checkInCodeFor(foreign.id), fixture.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.checkInCodeUnknown)
    await expect(
      checkInDelegate(fixture.mun.id, checkInCodeFor(unpaid.id), fixture.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.checkInCodeUnknown)
    expect(await statusOf(foreign.id)).toBe('CONFIRMED')
    expect(await statusOf(unpaid.id)).toBe('PAYMENT_PENDING')
  })

  it('rejects malformed input with a helpful message', async () => {
    const fixture = await makeOpsFixture()
    await expect(checkInDelegate(fixture.mun.id, 'hello', fixture.organizerSession)).rejects.toThrow(
      ORGANIZER_OPS_ERRORS.checkInCodeFormat,
    )
  })

  it('is closed before the MUN is live and more than a day before the conference', async () => {
    const onboarding = await makeOpsFixture({ status: 'ONBOARDING' })
    const { registration: early } = await addDelegate(onboarding)
    await expect(
      checkInDelegate(onboarding.mun.id, checkInCodeFor(early.id), onboarding.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.checkInNotOpen)

    const nextWeek = await makeOpsFixture({
      status: 'REGISTRATION_CLOSED',
      startDate: new Date(Date.now() + 7 * 86_400_000),
    })
    const { registration } = await addDelegate(nextWeek)
    await expect(
      checkInDelegate(nextWeek.mun.id, checkInCodeFor(registration.id), nextWeek.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.checkInTooEarly)

    const tomorrowMorning = await makeOpsFixture({
      status: 'REGISTRATION_OPEN',
      startDate: new Date(Date.now() + 12 * 3_600_000),
    })
    const { registration: onTime } = await addDelegate(tomorrowMorning)
    const result = await checkInDelegate(
      tomorrowMorning.mun.id,
      checkInCodeFor(onTime.id),
      tomorrowMorning.organizerSession,
    )
    expect(result.outcome).toBe('CHECKED_IN')
  })

  it('is open to platform staff but not to other organizers or delegates', async () => {
    const fixture = await makeOpsFixture()
    const { user, registration } = await addDelegate(fixture)
    const operations = await makeUser('OPERATIONS')
    const otherOrganizer = await makeUser('ORGANIZER')
    const code = checkInCodeFor(registration.id)

    await expect(checkInDelegate(fixture.mun.id, code, sessionFor(otherOrganizer))).rejects.toThrow('Forbidden')
    await expect(checkInDelegate(fixture.mun.id, code, sessionFor(user))).rejects.toThrow('Forbidden')
    await expect(checkInDelegate(fixture.mun.id, code, null)).rejects.toThrow('Forbidden')
    expect((await checkInDelegate(fixture.mun.id, code, sessionFor(operations))).outcome).toBe('CHECKED_IN')
  })
})

describe('setDelegateAttendance', () => {
  it('marks confirmed delegates attended or no-show while the conference is active, and corrects a mistake', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture)

    const noShow = await setDelegateAttendance(fixture.mun.id, registration.id, 'NO_SHOW', fixture.organizerSession)
    expect(noShow.status).toBe('NO_SHOW')
    expect(await statusOf(registration.id)).toBe('NO_SHOW')

    await setDelegateAttendance(fixture.mun.id, registration.id, 'ATTENDED', fixture.organizerSession)
    expect(await statusOf(registration.id)).toBe('ATTENDED')

    const again = await setDelegateAttendance(fixture.mun.id, registration.id, 'ATTENDED', fixture.organizerSession)
    expect(again.status).toBe('ATTENDED')
  })

  it('is closed before the conference starts and once results are under review', async () => {
    for (const status of ['REGISTRATION_OPEN', 'RESULTS_UNDER_REVIEW', 'COMPLETED'] as const) {
      const fixture = await makeOpsFixture({ status })
      const { registration } = await addDelegate(fixture)
      await expect(
        setDelegateAttendance(fixture.mun.id, registration.id, 'ATTENDED', fixture.organizerSession),
      ).rejects.toThrow(ORGANIZER_OPS_ERRORS.attendanceClosed)
    }
    const pending = await makeOpsFixture({ status: 'RESULTS_PENDING' })
    const { registration } = await addDelegate(pending)
    const result = await setDelegateAttendance(pending.mun.id, registration.id, 'NO_SHOW', pending.organizerSession)
    expect(result.status).toBe('NO_SHOW')
  })

  it('only applies to seat-holding registrations of this MUN', async () => {
    const fixture = await makeOpsFixture()
    const other = await makeOpsFixture()
    const { registration: cancelled } = await addDelegate(fixture, { status: 'CANCELLED' })
    const { registration: foreign } = await addDelegate(other)

    await expect(
      setDelegateAttendance(fixture.mun.id, cancelled.id, 'ATTENDED', fixture.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.attendanceNotConfirmed)
    await expect(
      setDelegateAttendance(fixture.mun.id, foreign.id, 'ATTENDED', fixture.organizerSession),
    ).rejects.toThrow('Registration not found')
    expect(await statusOf(foreign.id)).toBe('CONFIRMED')
  })

  it('refuses to mark an award winner as a no-show', async () => {
    const fixture = await makeOpsFixture()
    const { user, registration } = await addDelegate(fixture, { status: 'ATTENDED' })
    await db
      .insert(achievements)
      .values({ userId: user.id, munId: fixture.mun.id, registrationId: registration.id, award: 'Best Delegate' })

    await expect(
      setDelegateAttendance(fixture.mun.id, registration.id, 'NO_SHOW', fixture.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.attendanceHasAward)
    expect(await statusOf(registration.id)).toBe('ATTENDED')
  })
})
