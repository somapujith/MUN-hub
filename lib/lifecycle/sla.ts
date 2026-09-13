export interface BusinessCalendar {
  timeZone: string
  /** 0 = Sunday .. 6 = Saturday, per JS Date convention. */
  workdays: number[]
  startHour: number
  endHour: number
  holidays: Date[]
}

export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendar = {
  timeZone: 'Asia/Kolkata',
  workdays: [1, 2, 3, 4, 5],
  startHour: 10,
  endHour: 19,
  holidays: [],
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function isHoliday(date: Date, cfg: BusinessCalendar): boolean {
  return cfg.holidays.some(
    (holiday) =>
      holiday.getUTCFullYear() === date.getUTCFullYear() &&
      holiday.getUTCMonth() === date.getUTCMonth() &&
      holiday.getUTCDate() === date.getUTCDate(),
  )
}

function isWorkday(date: Date, cfg: BusinessCalendar): boolean {
  return cfg.workdays.includes(date.getUTCDay()) && !isHoliday(date, cfg)
}

/**
 * Adds `days` business days to `from`, clamped into business hours per
 * `cfg`. The clock is always a parameter — never reads Date.now(). A
 * Friday 18:00 submission adding 1 business day lands Monday 18:00, not
 * Saturday: the starting instant's time-of-day is preserved, only the
 * calendar date advances across workdays (weekends/holidays don't count).
 */
export function addBusinessDays(from: Date, days: number, cfg: BusinessCalendar): Date {
  if (days === 0) {
    return new Date(from.getTime())
  }

  let remaining = days
  let cursor = new Date(from.getTime())

  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
    if (isWorkday(cursor, cfg)) {
      remaining -= 1
    }
  }

  return cursor
}

export type SlaState = 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'PAUSED' | 'COMPLETED'

export interface SlaInput {
  slaDeadline: Date
  status: string
  slaPausedAt: Date | null
  slaPausedTotalMs: number
  completedStatuses: string[]
}

const DUE_SOON_THRESHOLD = 0.25

/**
 * Pure SLA-state derivation. Precedence: COMPLETED > PAUSED > OVERDUE >
 * DUE_SOON > ON_TRACK. `now` is always a parameter — never reads the
 * system clock. `submittedAt`, when given, is the window start used to
 * compute "less than 25% of the window remains" for DUE_SOON; without it,
 * a percentage-of-window can't be computed and the state falls back to
 * ON_TRACK/OVERDUE only. Pause-duration bookkeeping (shifting slaDeadline
 * by slaPausedTotalMs on resume) happens in the caller — this function
 * only reads an already-adjusted slaDeadline.
 */
export function computeSlaState(input: SlaInput, now: Date, submittedAt?: Date): SlaState {
  if (input.completedStatuses.includes(input.status)) {
    return 'COMPLETED'
  }

  if (input.status === 'CHANGES_REQUESTED') {
    return 'PAUSED'
  }

  if (now.getTime() > input.slaDeadline.getTime()) {
    return 'OVERDUE'
  }

  if (submittedAt) {
    const totalWindowMs = input.slaDeadline.getTime() - submittedAt.getTime()
    const remainingMs = input.slaDeadline.getTime() - now.getTime()
    if (totalWindowMs > 0 && remainingMs / totalWindowMs < DUE_SOON_THRESHOLD) {
      return 'DUE_SOON'
    }
  }

  return 'ON_TRACK'
}
