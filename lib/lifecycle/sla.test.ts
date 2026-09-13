import { describe, expect, it } from 'vitest'
import {
  addBusinessDays,
  computeSlaState,
  DEFAULT_BUSINESS_CALENDAR,
  type SlaInput,
} from './sla'

describe('addBusinessDays', () => {
  it('adds N business days, clamped into business hours', () => {
    // Wed 2026-09-16 10:00 UTC + 1 business day -> Thu 2026-09-17 10:00 UTC
    const from = new Date('2026-09-16T10:00:00.000Z')
    const result = addBusinessDays(from, 1, DEFAULT_BUSINESS_CALENDAR)
    expect(result.toISOString()).toBe('2026-09-17T10:00:00.000Z')
  })

  it('a Friday submission skips the weekend, landing on Monday', () => {
    // Fri 2026-09-18 18:00 UTC + 1 business day -> Mon 2026-09-21 18:00 UTC, not Saturday
    const from = new Date('2026-09-18T18:00:00.000Z')
    const result = addBusinessDays(from, 1, DEFAULT_BUSINESS_CALENDAR)
    expect(result.toISOString()).toBe('2026-09-21T18:00:00.000Z')
    expect(result.getUTCDay()).toBe(1) // Monday
  })

  it('a Saturday submission (itself a non-workday) still resolves to the correct business day', () => {
    // Sat 2026-09-19 12:00 UTC + 1 business day -> Mon 2026-09-21 12:00 UTC
    const from = new Date('2026-09-19T12:00:00.000Z')
    const result = addBusinessDays(from, 1, DEFAULT_BUSINESS_CALENDAR)
    expect(result.toISOString()).toBe('2026-09-21T12:00:00.000Z')
    expect(result.getUTCDay()).toBe(1)
  })

  it('a Sunday submission also resolves to the correct business day', () => {
    // Sun 2026-09-20 09:00 UTC + 1 business day -> Mon 2026-09-21 09:00 UTC
    const from = new Date('2026-09-20T09:00:00.000Z')
    const result = addBusinessDays(from, 1, DEFAULT_BUSINESS_CALENDAR)
    expect(result.toISOString()).toBe('2026-09-21T09:00:00.000Z')
    expect(result.getUTCDay()).toBe(1)
  })

  it('adding multiple business days skips every weekend in between', () => {
    // Thu 2026-09-17 10:00 UTC + 3 business days -> Tue 2026-09-22 10:00 UTC
    // (Fri, Mon, Tue — skips Sat/Sun)
    const from = new Date('2026-09-17T10:00:00.000Z')
    const result = addBusinessDays(from, 3, DEFAULT_BUSINESS_CALENDAR)
    expect(result.toISOString()).toBe('2026-09-22T10:00:00.000Z')
  })

  it('skips configured holidays as if they were non-workdays', () => {
    // Thu 2026-09-17 10:00 UTC + 1 business day, with Fri 2026-09-18 as a holiday
    // -> Mon 2026-09-21 10:00 UTC (Friday is skipped like a weekend day)
    const cfg = {
      ...DEFAULT_BUSINESS_CALENDAR,
      holidays: [new Date('2026-09-18T00:00:00.000Z')],
    }
    const from = new Date('2026-09-17T10:00:00.000Z')
    const result = addBusinessDays(from, 1, cfg)
    expect(result.toISOString()).toBe('2026-09-21T10:00:00.000Z')
  })

  it('zero business days returns the same instant', () => {
    const from = new Date('2026-09-16T10:00:00.000Z')
    const result = addBusinessDays(from, 0, DEFAULT_BUSINESS_CALENDAR)
    expect(result.toISOString()).toBe(from.toISOString())
  })
})

describe('computeSlaState', () => {
  const baseInput: SlaInput = {
    slaDeadline: new Date('2026-09-18T18:00:00.000Z'),
    status: 'UNDER_REVIEW',
    slaPausedAt: null,
    slaPausedTotalMs: 0,
    completedStatuses: ['PUBLISHED'],
  }

  it('returns COMPLETED when status is in completedStatuses, regardless of deadline', () => {
    const now = new Date('2026-09-25T00:00:00.000Z') // well past deadline
    const result = computeSlaState({ ...baseInput, status: 'PUBLISHED' }, now)
    expect(result).toBe('COMPLETED')
  })

  it('returns COMPLETED even before the deadline if status is completed', () => {
    const now = new Date('2026-09-10T00:00:00.000Z') // before deadline
    const result = computeSlaState({ ...baseInput, status: 'PUBLISHED' }, now)
    expect(result).toBe('COMPLETED')
  })

  it('returns PAUSED when status is CHANGES_REQUESTED, regardless of deadline', () => {
    const now = new Date('2026-09-25T00:00:00.000Z') // well past deadline
    const result = computeSlaState({ ...baseInput, status: 'CHANGES_REQUESTED' }, now)
    expect(result).toBe('PAUSED')
  })

  it('PAUSED takes precedence even if the mun is also nominally overdue', () => {
    const now = new Date('2026-09-19T00:00:00.000Z')
    const result = computeSlaState({ ...baseInput, status: 'CHANGES_REQUESTED' }, now)
    expect(result).toBe('PAUSED')
  })

  it('returns OVERDUE when now is strictly past the deadline', () => {
    const now = new Date('2026-09-18T18:00:00.001Z')
    const result = computeSlaState(baseInput, now)
    expect(result).toBe('OVERDUE')
  })

  it('is NOT overdue at exactly the deadline instant', () => {
    const now = new Date('2026-09-18T18:00:00.000Z')
    const result = computeSlaState(baseInput, now)
    expect(result).not.toBe('OVERDUE')
  })

  it('returns DUE_SOON when less than 25% of the window remains', () => {
    // 1-business-day-equivalent window: submitted Fri 18:00, deadline Mon 18:00
    // (72h wall-clock window used here for a simple, unambiguous 25% split)
    const submittedAt = new Date('2026-09-18T18:00:00.000Z')
    const deadline = new Date('2026-09-21T18:00:00.000Z') // 72h window
    const input: SlaInput = { ...baseInput, slaDeadline: deadline }
    // 25% of 72h = 18h remaining -> DUE_SOON boundary is deadline - 18h = Sun 00:00
    const dueSoonNow = new Date('2026-09-21T01:00:00.000Z') // 17h remaining
    const result = computeSlaState(input, dueSoonNow, submittedAt)
    expect(result).toBe('DUE_SOON')
  })

  it('returns ON_TRACK when more than 25% of the window remains', () => {
    const submittedAt = new Date('2026-09-18T18:00:00.000Z')
    const deadline = new Date('2026-09-21T18:00:00.000Z')
    const input: SlaInput = { ...baseInput, slaDeadline: deadline }
    const onTrackNow = new Date('2026-09-19T18:00:00.000Z') // 48h remaining, way more than 25%
    const result = computeSlaState(input, onTrackNow, submittedAt)
    expect(result).toBe('ON_TRACK')
  })

  it('falls back to ON_TRACK when no submittedAt is given (cannot compute a window)', () => {
    const now = new Date('2026-09-18T00:00:00.000Z') // before deadline
    const result = computeSlaState(baseInput, now)
    expect(result).toBe('ON_TRACK')
  })

  it('is a pure function of its arguments — never reads the system clock internally', () => {
    // If computeSlaState called Date.now() internally, this call (with a `now`
    // far in the past relative to the real clock) would still need to return
    // a result consistent with the PASSED-IN `now`, not the real wall clock.
    const now = new Date('2000-01-01T00:00:00.000Z')
    const result = computeSlaState(baseInput, now)
    expect(result).toBe('ON_TRACK')
  })
})
