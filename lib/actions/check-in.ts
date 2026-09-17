import { createHmac } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { assertMunOwnerOrStaff } from '@/lib/actions/mun-access'
import { CHECK_IN_WINDOW_HOURS, ORGANIZER_OPS_ERRORS } from '@/lib/actions/organizer-ops-errors'
import type { Session } from '@/lib/auth/adapter'
import { db } from '@/lib/db/client'
import { achievements, muns, registrations } from '@/lib/db/schema'
import type { MunStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import { getRuntimeEnv } from '@/lib/runtime-env'

// -----------------------------------------------------------------------------
// check-in — delegate pass codes, door check-in, and attendance marking
// -----------------------------------------------------------------------------
//
// A check-in code is derived, not stored: HMAC-SHA256 over the registration
// id, the first 50 bits written as 10 Crockford base32 characters (no I, L,
// O or U, so a code read aloud or typed from a phone screen survives). No
// schema change, and a code can't be guessed from the registration id.
//
// Key: CHECKIN_CODE_SECRET (at least 32 characters). When it isn't set, the
// key is derived from PAYMENT_FIELD_KEY with a fixed domain-separation label,
// so a deployment that already has its payment key works without new config.
// Either way, changing the key re-issues every code: passes shown before the
// change stop scanning. Set CHECKIN_CODE_SECRET before the first conference
// and don't rotate it while one is running.
//
// Verification recomputes the code for every seat-holding registration of
// the MUN and looks the typed code up — a few thousand HMACs at most, and the
// endpoint is owner/staff only, so there's no public oracle to brute-force.
//
// Attendance: check-in moves CONFIRMED (or NO_SHOW — a late arrival) to
// ATTENDED. The roster can also mark ATTENDED / NO_SHOW by hand. There is no
// separate check-in timestamp column; the registration's `updatedAt` at the
// time of the status change is reported as when attendance was recorded.

export const CHECK_IN_CODE_LENGTH = 10
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/
const MIN_SECRET_LENGTH = 32

/** MUN statuses in which a delegate can be checked in at the door. */
export const CHECK_IN_OPEN_STATUSES: readonly MunStatus[] = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CONFERENCE_ACTIVE']

/**
 * MUN statuses in which the roster can mark attendance by hand: while the
 * conference runs and after it ends, until results are submitted for review
 * (attendance is frozen from then on, because awards and certificates build
 * on it).
 */
export const ATTENDANCE_OPEN_STATUSES: readonly MunStatus[] = ['CONFERENCE_ACTIVE', 'RESULTS_PENDING']

/** Registration statuses that hold a seat at the conference — the ones with a valid pass. */
const SEAT_HOLDING_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'ATTENDED', 'NO_SHOW']

function resolveCheckInKey(): string | Buffer {
  const configured = getRuntimeEnv('CHECKIN_CODE_SECRET')?.trim()
  if (configured) {
    if (configured.length < MIN_SECRET_LENGTH) throw new Error(ORGANIZER_OPS_ERRORS.checkInNotConfigured)
    return configured
  }
  const paymentKey = getRuntimeEnv('PAYMENT_FIELD_KEY')?.trim()
  if (paymentKey) {
    return createHmac('sha256', paymentKey).update('munhub:check-in-code-key:v1').digest()
  }
  throw new Error(ORGANIZER_OPS_ERRORS.checkInNotConfigured)
}

function toCrockfordBase32(bytes: Uint8Array, length: number): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < length) {
      out += CROCKFORD_ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
    buffer &= (1 << bits) - 1
    if (out.length >= length) break
  }
  return out
}

/** The canonical (unformatted) check-in code for a registration. */
export function checkInCodeFor(registrationId: string, key: string | Buffer = resolveCheckInKey()): string {
  const digest = createHmac('sha256', key).update(`check-in:v1:${registrationId}`).digest()
  return toCrockfordBase32(digest, CHECK_IN_CODE_LENGTH)
}

/**
 * Canonicalises typed or scanned input: case-insensitive, spaces and hyphens
 * ignored, and the Crockford look-alikes (O → 0, I/L → 1) folded. Returns
 * null for anything that can't be a code.
 */
export function normalizeCheckInCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return CODE_PATTERN.test(cleaned) ? cleaned : null
}

/** Display form, e.g. `7K3QM-X9D2A`. */
export function formatCheckInCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

// ---------------------------------------------------------------------------
// Delegate pass
// ---------------------------------------------------------------------------

export interface RegistrationPass {
  registrationId: string
  status: RegistrationStatus
  checkedIn: boolean
  delegateName: string
  mun: {
    name: string
    slug: string
    startDate: Date | null
    endDate: Date | null
    venue: string | null
    addressLine1: string | null
    city: string | null
    state: string | null
    country: string | null
  }
  passName: string
  committee: string | null
  portfolio: string | null
  /** Formatted (`XXXXX-XXXXX`). */
  checkInCode: string
}

/**
 * The signed-in delegate's own pass for one registration. Anyone else —
 * including the MUN's organizer and platform staff — gets `Registration not
 * found`, so a registration id alone never reveals a check-in code. Only
 * seat-holding registrations have a pass.
 */
export async function getRegistrationPass(registrationId: string, session: Session | null): Promise<RegistrationPass> {
  if (!session) throw new Error('Forbidden')

  const row = await db.query.registrations.findFirst({
    where: and(eq(registrations.id, registrationId), eq(registrations.userId, session.userId)),
    columns: { id: true, status: true },
    with: {
      user: { columns: { name: true } },
      mun: {
        columns: {
          name: true,
          slug: true,
          startDate: true,
          endDate: true,
          venue: true,
          addressLine1: true,
          city: true,
          addressState: true,
          country: true,
        },
      },
      registrationProduct: { columns: { name: true } },
      committee: { columns: { name: true } },
      portfolio: { columns: { name: true } },
    },
  })
  if (!row) throw new Error('Registration not found')
  if (!SEAT_HOLDING_STATUSES.includes(row.status)) throw new Error(ORGANIZER_OPS_ERRORS.passUnavailable)

  const { addressState, ...mun } = row.mun
  return {
    registrationId: row.id,
    status: row.status,
    checkedIn: row.status === 'ATTENDED',
    delegateName: row.user.name,
    mun: { ...mun, state: addressState },
    passName: row.registrationProduct.name,
    committee: row.committee?.name ?? null,
    portfolio: row.portfolio?.name ?? null,
    checkInCode: formatCheckInCode(checkInCodeFor(row.id)),
  }
}

// ---------------------------------------------------------------------------
// Door check-in
// ---------------------------------------------------------------------------

export interface CheckedInDelegate {
  registrationId: string
  name: string
  institution: string | null
  passName: string
  committee: string | null
  portfolio: string | null
}

export interface CheckInResult {
  outcome: 'CHECKED_IN' | 'ALREADY_CHECKED_IN'
  /** When the delegate was (first) checked in. */
  checkedInAt: Date
  delegate: CheckedInDelegate
}

/**
 * Checks a delegate in by the code on their pass: the code must belong to a
 * seat-holding registration of this MUN, the MUN must be live
 * (`CHECK_IN_OPEN_STATUSES`) and the conference no more than
 * CHECK_IN_WINDOW_HOURS away. Idempotent — scanning the same pass twice
 * reports `ALREADY_CHECKED_IN` with the original time.
 *
 * Owning organizer or platform staff (`assertMunOwnerOrStaff`).
 */
export async function checkInDelegate(munId: string, rawCode: string, session: Session | null): Promise<CheckInResult> {
  await assertMunOwnerOrStaff(munId, session)

  const code = normalizeCheckInCode(rawCode)
  if (!code) throw new Error(ORGANIZER_OPS_ERRORS.checkInCodeFormat)
  const key = resolveCheckInKey()

  const candidates = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.munId, munId), inArray(registrations.status, SEAT_HOLDING_STATUSES)))
  const match = candidates.find((candidate) => checkInCodeFor(candidate.id, key) === code)

  const outcome = await db.transaction(async (tx) => {
    // Share-lock the mun so a concurrent status change (transitionMun takes
    // FOR UPDATE) can't close check-in between this check and the update.
    const [mun] = await tx
      .select({ status: muns.status, startDate: muns.startDate })
      .from(muns)
      .where(eq(muns.id, munId))
      .for('share')
      .limit(1)
    if (!mun) throw new Error('Mun not found')
    if (!CHECK_IN_OPEN_STATUSES.includes(mun.status)) throw new Error(ORGANIZER_OPS_ERRORS.checkInNotOpen)
    if (mun.startDate && Date.now() < mun.startDate.getTime() - CHECK_IN_WINDOW_HOURS * 3_600_000) {
      throw new Error(ORGANIZER_OPS_ERRORS.checkInTooEarly)
    }
    if (!match) throw new Error(ORGANIZER_OPS_ERRORS.checkInCodeUnknown)

    const [registration] = await tx
      .select({ status: registrations.status, updatedAt: registrations.updatedAt })
      .from(registrations)
      .where(eq(registrations.id, match.id))
      .for('update')
      .limit(1)
    // Re-checked under the row lock: the registration may have been
    // cancelled between the lookup above and here.
    if (!registration || !SEAT_HOLDING_STATUSES.includes(registration.status)) {
      throw new Error(ORGANIZER_OPS_ERRORS.checkInCodeUnknown)
    }
    if (registration.status === 'ATTENDED') {
      return { registrationId: match.id, outcome: 'ALREADY_CHECKED_IN' as const, checkedInAt: registration.updatedAt }
    }
    const [updated] = await tx
      .update(registrations)
      .set({ status: 'ATTENDED', updatedAt: new Date() })
      .where(eq(registrations.id, match.id))
      .returning({ updatedAt: registrations.updatedAt })
    return { registrationId: match.id, outcome: 'CHECKED_IN' as const, checkedInAt: updated.updatedAt }
  })

  const row = await db.query.registrations.findFirst({
    where: eq(registrations.id, outcome.registrationId),
    columns: { id: true },
    with: {
      user: { columns: { name: true, institution: true } },
      registrationProduct: { columns: { name: true } },
      committee: { columns: { name: true } },
      portfolio: { columns: { name: true } },
    },
  })
  if (!row) throw new Error('Registration not found')

  return {
    outcome: outcome.outcome,
    checkedInAt: outcome.checkedInAt,
    delegate: {
      registrationId: row.id,
      name: row.user.name,
      institution: row.user.institution,
      passName: row.registrationProduct.name,
      committee: row.committee?.name ?? null,
      portfolio: row.portfolio?.name ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Manual attendance (roster)
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'ATTENDED' | 'NO_SHOW'

export interface AttendanceUpdate {
  registrationId: string
  status: AttendanceStatus
  updatedAt: Date
}

/**
 * Marks a seat-holding registration ATTENDED or NO_SHOW from the roster —
 * only while `ATTENDANCE_OPEN_STATUSES` allows it. Setting the status it
 * already has is a no-op. A delegate with an award can't be marked a
 * no-show (awards require an attended or confirmed delegate).
 *
 * Owning organizer or platform staff (`assertMunOwnerOrStaff`).
 */
export async function setDelegateAttendance(
  munId: string,
  registrationId: string,
  status: AttendanceStatus,
  session: Session | null,
): Promise<AttendanceUpdate> {
  await assertMunOwnerOrStaff(munId, session)

  return db.transaction(async (tx) => {
    const [mun] = await tx.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).for('share').limit(1)
    if (!mun) throw new Error('Mun not found')
    if (!ATTENDANCE_OPEN_STATUSES.includes(mun.status)) throw new Error(ORGANIZER_OPS_ERRORS.attendanceClosed)

    const [registration] = await tx
      .select({ status: registrations.status, updatedAt: registrations.updatedAt })
      .from(registrations)
      .where(and(eq(registrations.id, registrationId), eq(registrations.munId, munId)))
      .for('update')
      .limit(1)
    if (!registration) throw new Error('Registration not found')
    if (!SEAT_HOLDING_STATUSES.includes(registration.status)) {
      throw new Error(ORGANIZER_OPS_ERRORS.attendanceNotConfirmed)
    }
    if (registration.status === status) {
      return { registrationId, status, updatedAt: registration.updatedAt }
    }
    if (status === 'NO_SHOW') {
      const [award] = await tx
        .select({ id: achievements.id })
        .from(achievements)
        .where(eq(achievements.registrationId, registrationId))
        .limit(1)
      if (award) throw new Error(ORGANIZER_OPS_ERRORS.attendanceHasAward)
    }

    const [updated] = await tx
      .update(registrations)
      .set({ status, updatedAt: new Date() })
      .where(eq(registrations.id, registrationId))
      .returning({ updatedAt: registrations.updatedAt })
    return { registrationId, status, updatedAt: updated.updatedAt }
  })
}
