import { getRuntimeEnv } from '@/lib/runtime-env'

/**
 * Platform fee model (docs: /legal/refunds "Our platform fee").
 *
 * The fee is INCLUDED in the listed price: the delegate pays exactly
 * `amount`; MUN Hub keeps `platformFee` plus GST on that fee
 * (`platformFeeTax`); the organizer is owed the rest (`organizerNet`).
 *
 * Rates are basis points (1 bps = 0.01%): `PLATFORM_FEE_BPS` (default 0)
 * and `PLATFORM_FEE_TAX_BPS` (default 1800 = 18% GST, charged on the fee,
 * not on the ticket).
 */

export interface FeeRates {
  /** Platform fee as basis points of the amount paid. */
  feeBps: number
  /** Tax (GST) as basis points of the platform fee. */
  taxBps: number
}

export interface FeeBreakdown {
  amount: number
  platformFee: number
  platformFeeTax: number
  organizerNet: number
}

export const BPS_DENOMINATOR = 10_000

/**
 * `value * bps / 10000`, rounded half-up to a whole unit, in integer
 * arithmetic (no floating point): floor((value * bps + 5000) / 10000).
 * Amounts are whole currency units (rupees), so the fee and its tax are too.
 *
 * Exported so `fees-additive.ts` (additive fee model) shares this rounding
 * rule instead of duplicating it — the two models differ only in how
 * `platformFee`/`platformFeeTax` combine with the base amount, not in how
 * each individual bps application rounds.
 */
export function applyBps(value: number, bps: number): number {
  return Math.floor((value * bps + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR)
}

/** Exported for the same reason as `applyBps` — shared by `fees-additive.ts`. */
export function assertBps(name: string, bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new Error(`${name} must be a whole number of basis points from 0 to ${BPS_DENOMINATOR}`)
  }
}

/**
 * Pure fee split for one payment.
 *
 * Rounding (documented, deterministic):
 *   platformFee    = roundHalfUp(amount × feeBps / 10000)
 *   platformFeeTax = roundHalfUp(platformFee × taxBps / 10000)
 *   organizerNet   = amount − platformFee − platformFeeTax   (absorbs rounding)
 * e.g. amount 1499, 250 bps, 1800 bps → fee 37 (37.475), tax 7 (6.66), net 1455.
 *
 * Throws if `amount` isn't a non-negative integer, a rate is out of range,
 * or the fee plus its tax would exceed the amount (only possible with a
 * misconfigured fee above ~84.7%).
 */
export function computeFeeBreakdown(amount: number, rates: FeeRates): FeeBreakdown {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('Amount must be a non-negative whole number')
  }
  assertBps('PLATFORM_FEE_BPS', rates.feeBps)
  assertBps('PLATFORM_FEE_TAX_BPS', rates.taxBps)

  const platformFee = applyBps(amount, rates.feeBps)
  const platformFeeTax = applyBps(platformFee, rates.taxBps)
  const organizerNet = amount - platformFee - platformFeeTax
  if (organizerNet < 0) {
    throw new Error('Platform fee and its tax exceed the amount paid')
  }
  return { amount, platformFee, platformFeeTax, organizerNet }
}

function parseBps(name: string, fallback: string): number {
  const raw = (getRuntimeEnv(name) || fallback).trim()
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a whole number of basis points from 0 to ${BPS_DENOMINATOR}`)
  }
  const bps = Number(raw)
  assertBps(name, bps)
  return bps
}

/**
 * Current rates from the environment. Throws on a malformed value rather
 * than silently charging no fee — a bad deploy config should fail loudly at
 * checkout, before any seat is held.
 */
export function getPlatformFeeRates(): FeeRates {
  return {
    feeBps: parseBps('PLATFORM_FEE_BPS', '0'),
    taxBps: parseBps('PLATFORM_FEE_TAX_BPS', '1800'),
  }
}
