import { applyBps, assertBps, type FeeRates } from './fees'

/**
 * Additive platform fee model, introduced for GuruPay
 * (docs/payments/SPEC.md §4.4/§6/§12) — the OPPOSITE direction from
 * `computeFeeBreakdown` in ./fees.ts.
 *
 * `computeFeeBreakdown` is SUBTRACTIVE: the fee is included in the listed
 * price, the delegate pays exactly the listed amount, and the organizer's net
 * is the remainder after the fee/tax are deducted.
 *
 * `computeFeeBreakdownAdditive` is ADDITIVE: the delegate pays the listed
 * price PLUS the platform fee PLUS GST on that fee; the organizer is owed the
 * full listed price, unchanged, always — never derived by subtracting
 * anything from the total charged.
 *
 * Do NOT change `computeFeeBreakdown`'s signature or subtractive semantics —
 * this is a new, separate function for the additive model, not a
 * replacement. Both share the same half-up bps rounding rule (`applyBps`/
 * `assertBps`, exported from ./fees.ts) so the two models never disagree on
 * how an individual percentage is rounded.
 */

export interface FeeBreakdownAdditive {
  /** The organizer's listed price (unchanged by the fee). */
  passAmount: number
  /** Platform fee as basis points of `passAmount`. */
  platformFee: number
  /** GST on `platformFee`. */
  platformFeeTax: number
  /** What the delegate is actually charged: passAmount + platformFee + platformFeeTax. */
  totalCharge: number
}

/**
 * Pure additive fee split for one payment.
 *
 * Rounding (documented, deterministic — see docs/payments/SPEC.md's edge
 * case table "Rounding"):
 *   platformFee    = roundHalfUp(passAmount × feeBps / 10000)
 *   platformFeeTax = roundHalfUp(platformFee × taxBps / 10000)
 *   totalCharge    = passAmount + platformFee + platformFeeTax   (addition, not subtraction)
 * e.g. passAmount 1499, 650 bps, 1800 bps → fee 97 (97.435), tax 17 (17.46),
 * total 1613. Unlike the subtractive model, there is no remainder-absorption
 * ambiguity: `organizerNetAmount` (set by the caller) always equals
 * `passAmount` exactly, by construction — never computed from `totalCharge`.
 *
 * Throws if `passAmount` isn't a non-negative integer or a rate is out of
 * range. There is no "fee exceeds amount" failure mode here (unlike the
 * subtractive model) since addition can never go negative.
 */
export function computeFeeBreakdownAdditive(passAmount: number, rates: FeeRates): FeeBreakdownAdditive {
  if (!Number.isInteger(passAmount) || passAmount < 0) {
    throw new Error('Amount must be a non-negative whole number')
  }
  assertBps('PLATFORM_FEE_BPS', rates.feeBps)
  assertBps('PLATFORM_FEE_TAX_BPS', rates.taxBps)

  const platformFee = applyBps(passAmount, rates.feeBps)
  const platformFeeTax = applyBps(platformFee, rates.taxBps)
  const totalCharge = passAmount + platformFee + platformFeeTax

  return { passAmount, platformFee, platformFeeTax, totalCharge }
}
