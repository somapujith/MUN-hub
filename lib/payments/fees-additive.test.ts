import { describe, expect, it } from 'vitest'
import { computeFeeBreakdownAdditive } from './fees-additive'

describe('computeFeeBreakdownAdditive', () => {
  it('matches the worked example from the spec (₹1,499 at 650/1800 bps)', () => {
    // fee = round(1499 * 650 / 10000) = round(97.435) = 97
    // tax = round(97 * 1800 / 10000) = round(17.46) = 17
    // total = 1499 + 97 + 17 = 1613
    expect(computeFeeBreakdownAdditive(1499, { feeBps: 650, taxBps: 1800 })).toEqual({
      passAmount: 1499,
      platformFee: 97,
      platformFeeTax: 17,
      totalCharge: 1613,
    })
  })

  it('charges no fee at 0 bps — total equals the pass amount', () => {
    expect(computeFeeBreakdownAdditive(1499, { feeBps: 0, taxBps: 1800 })).toEqual({
      passAmount: 1499,
      platformFee: 0,
      platformFeeTax: 0,
      totalCharge: 1499,
    })
  })

  it('never reached in practice (free path bypasses this) but must not throw on zero', () => {
    expect(computeFeeBreakdownAdditive(0, { feeBps: 650, taxBps: 1800 })).toEqual({
      passAmount: 0,
      platformFee: 0,
      platformFeeTax: 0,
      totalCharge: 0,
    })
  })

  it('handles a large amount (big group/delegation registration) without overflow', () => {
    const passAmount = 20_000 * 20 // 20 delegates at ₹20,000 each
    const result = computeFeeBreakdownAdditive(passAmount, { feeBps: 650, taxBps: 1800 })
    expect(result.passAmount).toBe(passAmount)
    // fee = round(400000 * 650/10000) = round(26000) = 26000
    expect(result.platformFee).toBe(26_000)
    // tax = round(26000 * 1800/10000) = round(4680) = 4680
    expect(result.platformFeeTax).toBe(4_680)
    expect(result.totalCharge).toBe(passAmount + result.platformFee + result.platformFeeTax)
  })

  it('additive invariant: totalCharge is always passAmount + fee + tax exactly, by construction', () => {
    for (const passAmount of [0, 1, 7, 99, 100, 999, 1499, 2500, 123457]) {
      for (const feeBps of [0, 1, 199, 250, 500, 650, 1000]) {
        const split = computeFeeBreakdownAdditive(passAmount, { feeBps, taxBps: 1800 })
        expect(split.totalCharge).toBe(split.passAmount + split.platformFee + split.platformFeeTax)
      }
    }
  })

  it('rounds an exact half up, same rule as the subtractive model', () => {
    // 50 x 5% = 2.5 -> 3; 3 x 50% = 1.5 -> 2
    expect(computeFeeBreakdownAdditive(50, { feeBps: 500, taxBps: 5000 })).toMatchObject({
      platformFee: 3,
      platformFeeTax: 2,
    })
  })

  it('throws on a misconfigured rate rather than silently charging nothing', () => {
    expect(() => computeFeeBreakdownAdditive(100, { feeBps: -1, taxBps: 0 })).toThrow(/PLATFORM_FEE_BPS/)
    expect(() => computeFeeBreakdownAdditive(100, { feeBps: 10_001, taxBps: 0 })).toThrow(/PLATFORM_FEE_BPS/)
    expect(() => computeFeeBreakdownAdditive(100, { feeBps: 0, taxBps: 20_000 })).toThrow(/PLATFORM_FEE_TAX_BPS/)
  })

  it('rejects a non-integer or negative pass amount', () => {
    expect(() => computeFeeBreakdownAdditive(10.5, { feeBps: 0, taxBps: 0 })).toThrow(/whole number/)
    expect(() => computeFeeBreakdownAdditive(-1, { feeBps: 0, taxBps: 0 })).toThrow(/whole number/)
  })
})
