import { afterEach, describe, expect, it } from 'vitest'
import { computeFeeBreakdown, getPlatformFeeRates } from './fees'

describe('computeFeeBreakdown', () => {
  it('charges no fee at 0 bps', () => {
    expect(computeFeeBreakdown(1499, { feeBps: 0, taxBps: 1800 })).toEqual({
      amount: 1499,
      platformFee: 0,
      platformFeeTax: 0,
      organizerNet: 1499,
    })
  })

  it('rounds the fee and its tax half-up, and the net absorbs the rounding', () => {
    // 1499 × 2.5% = 37.475 → 37; 37 × 18% = 6.66 → 7; 1499 − 37 − 7 = 1455
    expect(computeFeeBreakdown(1499, { feeBps: 250, taxBps: 1800 })).toEqual({
      amount: 1499,
      platformFee: 37,
      platformFeeTax: 7,
      organizerNet: 1455,
    })
  })

  it('rounds an exact half up', () => {
    // 50 × 5% = 2.5 → 3; 3 × 50% = 1.5 → 2
    expect(computeFeeBreakdown(50, { feeBps: 500, taxBps: 5000 })).toMatchObject({ platformFee: 3, platformFeeTax: 2, organizerNet: 45 })
    // 49 × 5% = 2.45 → 2
    expect(computeFeeBreakdown(49, { feeBps: 500, taxBps: 0 })).toMatchObject({ platformFee: 2, organizerNet: 47 })
  })

  it('always sums back to the amount paid', () => {
    for (const amount of [0, 1, 7, 99, 100, 999, 1499, 2500, 123457]) {
      for (const feeBps of [0, 1, 199, 250, 500, 1000]) {
        const split = computeFeeBreakdown(amount, { feeBps, taxBps: 1800 })
        expect(split.platformFee + split.platformFeeTax + split.organizerNet).toBe(amount)
        expect(split.organizerNet).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('handles a zero amount', () => {
    expect(computeFeeBreakdown(0, { feeBps: 1000, taxBps: 1800 })).toEqual({
      amount: 0,
      platformFee: 0,
      platformFeeTax: 0,
      organizerNet: 0,
    })
  })

  it('rejects out-of-range or fractional rates and amounts', () => {
    expect(() => computeFeeBreakdown(100, { feeBps: -1, taxBps: 0 })).toThrow(/PLATFORM_FEE_BPS/)
    expect(() => computeFeeBreakdown(100, { feeBps: 10_001, taxBps: 0 })).toThrow(/PLATFORM_FEE_BPS/)
    expect(() => computeFeeBreakdown(100, { feeBps: 2.5, taxBps: 0 })).toThrow(/PLATFORM_FEE_BPS/)
    expect(() => computeFeeBreakdown(100, { feeBps: 0, taxBps: 20_000 })).toThrow(/PLATFORM_FEE_TAX_BPS/)
    expect(() => computeFeeBreakdown(10.5, { feeBps: 0, taxBps: 0 })).toThrow(/whole number/)
    expect(() => computeFeeBreakdown(-1, { feeBps: 0, taxBps: 0 })).toThrow(/whole number/)
  })

  it('refuses a fee plus tax larger than the amount', () => {
    expect(() => computeFeeBreakdown(100, { feeBps: 9000, taxBps: 1800 })).toThrow(/exceed/)
  })
})

describe('getPlatformFeeRates', () => {
  const saved = { fee: process.env.PLATFORM_FEE_BPS, tax: process.env.PLATFORM_FEE_TAX_BPS }
  afterEach(() => {
    if (saved.fee === undefined) delete process.env.PLATFORM_FEE_BPS
    else process.env.PLATFORM_FEE_BPS = saved.fee
    if (saved.tax === undefined) delete process.env.PLATFORM_FEE_TAX_BPS
    else process.env.PLATFORM_FEE_TAX_BPS = saved.tax
  })

  it('defaults to no fee and 18% GST', () => {
    delete process.env.PLATFORM_FEE_BPS
    delete process.env.PLATFORM_FEE_TAX_BPS
    expect(getPlatformFeeRates()).toEqual({ feeBps: 0, taxBps: 1800 })
  })

  it('reads configured rates', () => {
    process.env.PLATFORM_FEE_BPS = ' 250 '
    process.env.PLATFORM_FEE_TAX_BPS = '0'
    expect(getPlatformFeeRates()).toEqual({ feeBps: 250, taxBps: 0 })
  })

  it('throws on a malformed rate instead of silently charging nothing', () => {
    process.env.PLATFORM_FEE_BPS = '2.5%'
    expect(() => getPlatformFeeRates()).toThrow(/PLATFORM_FEE_BPS/)
    process.env.PLATFORM_FEE_BPS = '250'
    process.env.PLATFORM_FEE_TAX_BPS = '-5'
    expect(() => getPlatformFeeRates()).toThrow(/PLATFORM_FEE_TAX_BPS/)
  })
})
