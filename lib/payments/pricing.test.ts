import { describe, expect, it } from 'vitest'
import { effectivePassPrice } from './pricing'

const now = new Date('2026-09-17T12:00:00Z')
const later = new Date('2026-09-18T00:00:00Z')
const earlier = new Date('2026-09-16T00:00:00Z')

describe('effectivePassPrice', () => {
  it('charges the early-bird price before its deadline', () => {
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 1500, earlyBirdDeadline: later }, now)).toEqual({
      price: 1500,
      earlyBird: true,
    })
  })

  it('charges the regular price once the deadline has passed (or is exactly now)', () => {
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 1500, earlyBirdDeadline: earlier }, now)).toEqual({
      price: 2000,
      earlyBird: false,
    })
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 1500, earlyBirdDeadline: now }, now).price).toBe(2000)
  })

  it('needs both an early-bird price and a deadline', () => {
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 1500, earlyBirdDeadline: null }, now).price).toBe(2000)
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: null, earlyBirdDeadline: later }, now).price).toBe(2000)
  })

  it('ignores an "early bird" that is not cheaper', () => {
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 2500, earlyBirdDeadline: later }, now).price).toBe(2000)
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 2000, earlyBirdDeadline: later }, now).earlyBird).toBe(false)
  })

  it('allows a free early-bird price', () => {
    expect(effectivePassPrice({ price: 2000, earlyBirdPrice: 0, earlyBirdDeadline: later }, now)).toEqual({
      price: 0,
      earlyBird: true,
    })
  })
})
