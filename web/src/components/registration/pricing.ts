import type { RegistrationProduct } from "@/types";

/**
 * Display-only mirror of `lib/payments/pricing.ts#effectivePassPrice`: the
 * early-bird price applies while its deadline is in the future and it is
 * lower than the regular price. The server decides the amount actually
 * charged; this only tells the delegate what to expect.
 *
 * Reads the clock, like `deadline.ts#hasPassed` — a plain function, not
 * part of a component body.
 */
export interface PassPrice {
  /** What the pass costs right now. */
  price: number;
  /** The pass's regular price. */
  regularPrice: number;
  earlyBird: boolean;
  /** When the early-bird price ends (only when `earlyBird`). */
  earlyBirdEndsAt: Date | null;
}

export function currentPassPrice(
  product: Pick<RegistrationProduct, "price" | "earlyBirdPrice" | "earlyBirdDeadline">,
): PassPrice {
  const { price, earlyBirdPrice, earlyBirdDeadline } = product;
  const earlyBird =
    earlyBirdPrice != null &&
    earlyBirdDeadline != null &&
    earlyBirdDeadline.getTime() > Date.now() &&
    earlyBirdPrice < price;
  return {
    price: earlyBird ? earlyBirdPrice : price,
    regularPrice: price,
    earlyBird,
    earlyBirdEndsAt: earlyBird ? earlyBirdDeadline : null,
  };
}

export function formatPriceDeadline(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
