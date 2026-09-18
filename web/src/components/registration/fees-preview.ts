/**
 * Display-only mirror of `lib/payments/fees-additive.ts#computeFeeBreakdownAdditive`
 * (same pattern as `pricing.ts`'s mirror of `effectivePassPrice`): shows the
 * delegate a fee-inclusive total that matches what will actually be charged,
 * BEFORE `initiateRegistration`/`initiateGroupRegistration` is ever called.
 * The server remains the sole source of truth for the real charge — this is
 * a preview only, computed from `GET /registrations/fee-rates` (pure,
 * non-sensitive config, see server/routes/registrations.ts).
 *
 * Rounding must match the server exactly (half-up, integer arithmetic) or a
 * displayed total could differ from what's actually charged by a rupee.
 */

export interface FeeRates {
  feeBps: number;
  taxBps: number;
}

export interface FeeBreakdownPreview {
  passAmount: number;
  platformFee: number;
  platformFeeTax: number;
  totalCharge: number;
}

const BPS_DENOMINATOR = 10_000;

/** `value * bps / 10000`, rounded half-up — identical to lib/payments/fees.ts#applyBps. */
function applyBps(value: number, bps: number): number {
  return Math.floor((value * bps + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

/**
 * Additive fee preview for `passAmount` (whole rupees) — mirrors
 * lib/payments/fees-additive.ts#computeFeeBreakdownAdditive exactly.
 * `rates` is null while `GET /registrations/fee-rates` hasn't loaded yet (or
 * failed) — callers should fall back to showing the fee-exclusive amount
 * only in that case, never a wrong/zero fee presented as final.
 */
export function previewFeeBreakdownAdditive(passAmount: number, rates: FeeRates | undefined): FeeBreakdownPreview | null {
  if (!rates || !Number.isInteger(passAmount) || passAmount < 0) return null;
  const platformFee = applyBps(passAmount, rates.feeBps);
  const platformFeeTax = applyBps(platformFee, rates.taxBps);
  return { passAmount, platformFee, platformFeeTax, totalCharge: passAmount + platformFee + platformFeeTax };
}
