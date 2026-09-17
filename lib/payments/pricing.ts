/**
 * Which price a registration pass sells at right now.
 *
 * Early-bird applies when the pass has an `earlyBirdPrice`, an
 * `earlyBirdDeadline` that is still in the future, and the early-bird price
 * is actually lower than the regular price (a misconfigured "early bird"
 * that costs more is ignored rather than charged). Decided server-side
 * inside the registration transaction — the client's displayed price is
 * never trusted. `web/src/components/registration/pricing.ts` mirrors this
 * rule for display only.
 */
export interface PassPricing {
  price: number
  earlyBirdPrice: number | null
  earlyBirdDeadline: Date | null
}

export function effectivePassPrice(
  product: PassPricing,
  now: Date,
): { price: number; earlyBird: boolean } {
  const { price, earlyBirdPrice, earlyBirdDeadline } = product
  if (
    earlyBirdPrice !== null &&
    earlyBirdDeadline !== null &&
    now.getTime() < earlyBirdDeadline.getTime() &&
    earlyBirdPrice < price
  ) {
    return { price: earlyBirdPrice, earlyBird: true }
  }
  return { price, earlyBird: false }
}
